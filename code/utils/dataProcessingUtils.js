import { generateAlleleDosage, getRsIdsAndFrequency } from '../syntheticDataGenerator.js';
import { SEX } from '../constants.js';


export function processPRS(snpsInfo) {
    console.log(snpsInfo)
    // Validate SNP data
    if (!snpsInfo.length) {
        throw new Error('No SNPs available for profile generation.');
    }

    snpsInfo.forEach((snp, index) => {
        if (!snp.weight) {
            throw new Error(`Missing weight for SNP at index ${index}`);
        }
    });

    const populationSize = 100000;
    let linearPredictors = [];

    // Generate profiles
    for (let i = 0; i < populationSize; i++) {
        let prs = 0;
        const allelesDosage = snpsInfo.map(({ weight, maf }) => {
            const dosage = generateAlleleDosage(maf);
            prs += weight * dosage;

            return dosage;
        });

        linearPredictors.push(prs);
    }

    const max = linearPredictors.reduce((a, b) => Math.max(a, b), -Infinity);

    linearPredictors = linearPredictors.map(pred => pred / max);

    return Float64Array.from(linearPredictors);
}


export async function processSnpData(snpData, ancestry) {
    // Validate and extract relevant indices from headers
    const { headers, values } = snpData;
    let indices = {
        hmChromosome: headers.indexOf('hm_chr'),
        hmPosition: headers.indexOf('hm_pos'),
        hmRsId: headers.indexOf('hm_rsID'),
        rsId: headers.indexOf('rsID'),
        hmOther: headers.indexOf('hm_inferOtherAllele'),
        effect: headers.indexOf('effect_allele'),
        other: headers.indexOf('other_allele'),
        weight: headers.indexOf('effect_weight'),
        maf: headers.indexOf('allelefrequency_effect')
    }

    if (indices.hmChromosome === -1 || indices.hmPosition === -1 || indices.hmRsId === -1) {
        alert('Fatal Error: Some or all allele data are missing in the PGS file.');
        throw new Error('Some or all allele data are missing in the PGS file.');
    }

    // Extract SNP data
    let snpsInfo = values.map(row => {
        const other = row[indices.hmOther] === "" ? row[indices.hmOther] : row[indices.other];
        const id = `${row[indices.hmChromosome]}:${row[indices.hmPosition]}:${row[indices.effect]}:${other}`;
        const rsID = row[indices.hmRsId] === "" ? row[indices.rsId] === "" ? null : row[indices.rsId] : row[indices.hmRsId];

        return {
            id: id,
            rsID: rsID,
            weight: row[indices.weight],
            maf: parseFloat(row[indices.maf])
        };
    });

    // Add rsIDs and validate SNP data
    snpsInfo = await getRsIdsAndFrequency(snpsInfo, ancestry);

    if (!snpsInfo.length) {
        throw new Error('No valid SNPs processed. Check the input PGS file or SNP lookup results.');
    }

    // Calculate allele dosage frequencies for SNPs with valid rsIDs
    snpsInfo.forEach(snp => {
        if (!snp.rsID) {
            // TODO: Currently RS Id is not used, so this warning is turned off
            console.warn('Missing SNP ID for:', snp);
        }
    });

    snpsInfo = snpsInfo.filter(snp => snp.maf !== null && !isNaN(snp.maf));

    return snpsInfo;
}


export async function processHeader(snpsInfo) {
    // Validate SNP data
    if (!snpsInfo.length) {
        throw new Error('No SNPs available for profile generation.');
    }

    // Generate header structure
    const baseHeader = ['id', 'ageOfEntry', 'ageOfExit', 'sex', 'prs', 'case', 'ageOfOnset'];
    const snpHeaders = snpsInfo.map(snp => snp.id);

    return [...baseHeader, ...snpHeaders];
}


export async function processProfiles(snpsInfo, numberOfProfiles, sex, minAge, maxAge, minFollowUp, maxFollowUp, k, b) {
    if (!snpsInfo.length) {
        throw new Error('No SNPs available for profile generation.');
    }

    // Helper functions
    let avgU = 0;
    const getRandomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

    function calculateTimeDiseaseOnset(ageEntry, prs, k, b) {
        const u = Math.random();  // Should be between 0 and 1
        const ageTerm = Math.pow(ageEntry, k);
        const denominator = b * Math.exp(prs); // <-- must use actual PRS here
        const logArgument = ageTerm - Math.log(u) / denominator;

        return logArgument > 0 ? Math.pow(logArgument, 1 / k) : Infinity;
    }

    // Generate profiles data
    const data = [];
    let numberOfCases = 0;

    // Stats
    let ages = {};
    for (let i = minAge; i <= maxAge; i++) {
        ages[i] = 0;
    }
    let maxPrs = 0;
    let maxIsCase = false;
    let minPrs = 0;
    let minIsCase = false;
    let totalAvg = 0;
    let caseAvg = 0;
    let controlAvg = 0;
    let maxDosage = { 0: 0, 1: 0, 2: 0 };

    while (data.length < numberOfProfiles) {
        let prs = 0.0;
        const snpDosages = snpsInfo.map(({ weight, maf }) => {
            const dosage = generateAlleleDosage(maf);
            prs += parseFloat(weight) * dosage;

            maxDosage[dosage] += 1;

            return dosage;
        });
        const ageOfEntry = getRandomInt(minAge, maxAge);
        ages[ageOfEntry] += 1;
        const ageOfExit = ageOfEntry + getRandomInt(minFollowUp, maxFollowUp);
        const rawOnset = calculateTimeDiseaseOnset(ageOfEntry, prs, k, b);
        const isCase = Number.isFinite(rawOnset) &&
        rawOnset >= ageOfEntry &&
        rawOnset <= ageOfExit ? 1 : 0;

        // Create profile array
        const profileArray = [
            0, // The correct ID will be given at download
            ageOfEntry,
            ageOfExit,
            sex === SEX.FEMALE ? 2 : 1,
            prs,
            isCase,
            rawOnset < ageOfExit ? Math.round(rawOnset) : Infinity,
            ...snpDosages
        ];

        // STATS
        if (isCase === 1) {
            numberOfCases++;
            caseAvg += prs;
            totalAvg += prs;
        }
        else if (isCase === 0) {
            controlAvg += prs;
            totalAvg += prs;
        }

        if (prs > maxPrs) {
            maxPrs = prs;
            maxIsCase = isCase;
        }
        else if (prs < minPrs) {
            minPrs = prs;
            minIsCase = isCase;
        }

        data.push(profileArray);
    }

    // console.log(
    //     `Profiles creation complete:\n` +
    //     `   - Average total prs: ${totalAvg / numberOfProfiles}\n` +
    //     `   - Max Dosage: ${maxDosage[0] + maxDosage[1] + maxDosage[2]}: \n\t0: ${maxDosage[0]} \n\t1: ${maxDosage[1]} \n\t2: ${maxDosage[2]}\n` +
    //     `   - Cases created: ${numberOfCases}\n` +
    //     `   - Controls created: ${data.length - numberOfCases}\n` +
    //     `   - Case to Control ratio: ${(numberOfCases / (data.length - numberOfCases)).toFixed(2) * 100}%\n` +
    //     `   - Max PRS: ${maxPrs.toFixed(4)} (Is case: ${maxIsCase})\n` +
    //     `   - Min PRS: ${minPrs.toFixed(4)} (Is case: ${minIsCase})\n` +
    //     `   - Case Average PRS: ${(caseAvg / numberOfCases).toFixed(4)}\n` +
    //     `   - Control Average PRS: ${(controlAvg / (data.length - numberOfCases)).toFixed(4)}\n`
    // );
    //console.log('Worker created cohort batch');

    return data;
}


export function getAgeGroupsBetween(minAge, maxAge, populationAgePercentages) {
    const allGroups = Object.keys(populationAgePercentages);
    const parsedGroups = allGroups.map(group => {
        const start = parseInt(group.substring(0, 2));
        const end = parseInt(group.substring(2));

        return { group, start, end };
    });

    return parsedGroups
        .filter(({ start, end }) => start <= maxAge && end >= minAge)
        .map(({ group }) => group);
}

export function distributeProfilesByAgeGroups(totalProfiles, minAge, maxAge, populationData, sex = SEX.MALE, selectedAgeGroups) {
    const profilesByAgeGroup = { [SEX.MALE]: {}, [SEX.FEMALE]: {} };

    // Compute total population by sex
    let totalFemalePercentage = 0;
    let totalMalePercentage = 0;

    let totalFemalePopulation = populationData.totalFemalePopulation;
    let totalMalePopulation = populationData.totalMalePopulation;

    selectedAgeGroups.forEach(group => {
        totalFemalePercentage += populationData.ageSexPercentages[group]?.[SEX.FEMALE] || 0;
        totalMalePercentage += populationData.ageSexPercentages[group]?.[SEX.MALE] || 0;
    });

    if (sex === SEX.FEMALE || sex === SEX.MALE) {
        const sexKey = sex;
        let totalSexPercent = 0;

        selectedAgeGroups.forEach(group => {
            totalSexPercent += populationData.ageSexPercentages[group]?.[sexKey] || 0;
        });

        if (totalSexPercent === 0) {
            const uniformCount = Math.floor(totalProfiles / selectedAgeGroups.length);
            selectedAgeGroups.forEach(group => {
                profilesByAgeGroup[sex][group] = uniformCount;
            });

            return profilesByAgeGroup;
        }

        let totalAssigned = 0;

        selectedAgeGroups.forEach(group => {
            const groupPercent = populationData.ageSexPercentages[group]?.[sexKey] || 0;
            const count = Math.round(totalProfiles * (groupPercent / totalSexPercent));
            profilesByAgeGroup[sex][group] = count;
            totalAssigned += count;
        });

        const diff = totalProfiles - totalAssigned;

        if (diff !== 0) {
            const lastGroup = selectedAgeGroups[selectedAgeGroups.length - 1];
            profilesByAgeGroup[sex][lastGroup] += diff;
        }

        return profilesByAgeGroup;
    }
}
