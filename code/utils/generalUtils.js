import { INDEX } from '../constants.js';
import {
    hideLoading,
    showLoading, showLoadingText
} from '../syntheticDataGenerator.js';

export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


export function countOccurrences(snpIndex, profiles) {
    const counts = { 0: 0, 1: 0, 2: 0 }; // Initialize counts for 0, 1, and 2

    profiles.forEach(profile => {
        // Use the dynamic key access to get the value of the specified snpId
        const value = profile.allelesDosage[snpIndex];
        if (value in counts) { // Check if the value is a key in counts
            counts[value]++;
        }
    });

    return counts;
}


export function dataToProfilesBlob(info) {
    const { header, data } = info;
    const blobParts = [];

    // Add header
    blobParts.push(header.join(',') + '\n');

    for (const row of data) {
        const values = header.map((_, index) => {
            const value = row[index];

            if (typeof value === 'string') {
                return `"${value.replace(/"/g, '""')}"`;
            }

            if (typeof value === 'number') {
                return header[index].toLowerCase().includes('prs')
                    ? value
                    : Math.round(value);
            }

            return value !== undefined ? value : '';
        });

        blobParts.push(values.join(',') + '\n');
    }

    return new Blob(blobParts, { type: 'text/csv' });
}


export async function* getCohort({ prefix, remapIds = true }) {
    /* global localforage */
    const allChunks = [];

    await localforage.iterate((value, key) => {
        if (key.startsWith(prefix)) {
            allChunks.push({ key, compressedData: value });
        }
    });

    allChunks.sort((a, b) => {
        const extractNumbers = (k) => k.match(/\d+/g).map(Number);
        const [wA, cA] = extractNumbers(a.key);
        const [wB, cB] = extractNumbers(b.key);
        return wA - wB || cA - cB;
    });

    let newId = 1;

    for (const entry of allChunks) {
        const decompressed = pako.inflate(new Uint8Array(entry.compressedData), { to: 'string' });
        const parsedChunk = JSON.parse(decompressed);

        for (const profile of parsedChunk) {
            if (remapIds) profile[0] = newId++;
            yield profile;
        }
    }
}


export async function downloadVcfFromChunks({ header, prefix, filename }) {
    if (!header) {
        throw new Error('Header missing');
    }

    const profiles = [];

    for await (const profile of getCohort({ prefix })) {
        profiles.push(profile);
    }

    if (profiles.length === 0) {
        throw new Error('Profiles missing');
    }

    const profilesId = profiles.map(row => 'NA' + String(row[INDEX.ID]).padStart(7, '0')); // Convert to NA0000000, NA0000001, etc.
    const headerLines = [
        '##fileformat=VCFv4.2',
        '##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">',
        `#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\t${profilesId.join('\t')}`
    ];
    const variants = header.slice(INDEX.ONSET + 1);
    const vcfLines = [...headerLines];
    const profilesGenetic = profiles.map(row => row.slice(INDEX.ONSET + 1));

    for (let variantIdx = 0; variantIdx < variants.length; variantIdx++) {
        const variantIdStr = variants[variantIdx];
        const chrom = variantIdStr.split(':')[0];
        const pos_ref_alt = variantIdStr.slice(variantIdStr.indexOf(':') + 1);
        const [pos, ref, alt] = pos_ref_alt.split(':');

        // Create variant info columns
        const vcfLineVariant = [
            chrom, pos, '.', ref, alt,    // CHROM to ALT
            '.', 'PASS', '.', 'GT'       // QUAL to FORMAT
        ];

        // Generate genotype calls for all profiles
        const genotypeProfiles = profilesId.map((_, profileIdx) => {
            const alleleDosage = profilesGenetic[profileIdx][variantIdx];

            if (isNaN(alleleDosage)) return './.';
            switch (alleleDosage) {
                case 0:
                    return '0/0';
                case 1:
                    return '0/1';
                case 2:
                    return '1/1';
                default:
                    return './.';
            }
        });

        // Combine into full VCF line
        const vcfLine = [...vcfLineVariant, ...genotypeProfiles].join('\t');
        vcfLines.push(vcfLine);
    }

    const vcfContent = vcfLines.join('\n');
    const blob = new Blob([vcfContent], { type: 'text/vcf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}


export async function dataToVCF(info) {
    const { header, data } = info;
    const ageOfOnsetIdx = header.indexOf('ageOfOnset');
    const variants = header.slice(INDEX.ONSET + 1);
    const profilesId = data.map(row => 'NA' + String(row[0]).padStart(7, '0')); // Convert to NA0000000, NA0000001, etc.
    const profilesGenetic = data.map(row => row.slice(INDEX.ONSET + 1));
    const headerLines = [
        '##fileformat=VCFv4.2',
        '##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">',
        `#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\t${profilesId.join('\t')}`
    ];
    const vcfLines = [...headerLines];

    // Process each variant
    for (let variantIdx = 0; variantIdx < variants.length; variantIdx++) {
        const variant_id_str = variants[variantIdx];
        const chrom = variant_id_str.split(':')[0];
        const pos_ref_alt = variant_id_str.slice(variant_id_str.indexOf(':') + 1);
        const [pos, ref, alt] = pos_ref_alt.split(':');

        // Create variant info columns
        const vcfLineVariant = [
            chrom, pos, '.', ref, alt,    // CHROM to ALT
            '.', 'PASS', '.', 'GT'       // QUAL to FORMAT
        ];

        // Generate genotype calls for all profiles
        const genotypeProfiles = profilesId.map((_, profileIdx) => {
            const alleleDosage = profilesGenetic[profileIdx][variantIdx];

            if (isNaN(alleleDosage)) return './.';
            switch (alleleDosage) {
                case 0:
                    return '0/0';
                case 1:
                    return '0/1';
                case 2:
                    return '1/1';
                default:
                    return './.';
            }
        });

        // Combine into full VCF line
        const vcfLine = [...vcfLineVariant, ...genotypeProfiles].join('\t');
        vcfLines.push(vcfLine);
    }

    // Return complete VCF file content
    return vcfLines.join('\n');
}


export async function downloadCohortFromChunks({prefix, filename, splitDataset, remapIds = true, flushEvery = 50_000}) {
    showLoading('spinner');
    const CASE_IDX = 5;
    /* global localforage */
    const header = await localforage.getItem('header');
    if (!header) throw new Error('Header missing');

    let parts = [header.join(',') + '\n'];
    let casesParts = [header.join(',') + '\n'];
    let controlsParts = [header.join(',') + '\n'];
    let count = 0;

    const flush = (arr) => {
        const blob = new Blob(arr, { type: 'text/csv' });
        arr.length = 0; // clear array
        return blob;
    };

    const blobs = [];
    const caseBlobs = [];
    const controlBlobs = [];

    for await (const profile of getCohort({ prefix, remapIds })) {
        const row = profile.join(',') + '\n';
        parts.push(row);
        if (splitDataset) {
            (profile[CASE_IDX] === 1 || profile[CASE_IDX] === '1' ? casesParts : controlsParts).push(row);
        }
        if (++count % flushEvery === 0) {
            blobs.push(flush(parts));
            if (splitDataset) {
                caseBlobs.push(flush(casesParts));
                controlBlobs.push(flush(controlsParts));
            }
        }
    }

    // final flush
    if (parts.length) blobs.push(new Blob(parts, { type: 'text/csv' }));
    const url = URL.createObjectURL(new Blob(blobs, { type: 'text/csv' }));
    triggerDownload(url, filename);
    URL.revokeObjectURL(url);

    if (splitDataset) {
        if (casesParts.length) caseBlobs.push(new Blob(casesParts, { type: 'text/csv' }));
        if (controlsParts.length) controlBlobs.push(new Blob(controlsParts, { type: 'text/csv' }));
        const casesUrl = URL.createObjectURL(new Blob(caseBlobs, { type: 'text/csv' }));
        const controlsUrl = URL.createObjectURL(new Blob(controlBlobs, { type: 'text/csv' }));
        triggerDownload(casesUrl, 'cases.csv');
        triggerDownload(controlsUrl, 'controls.csv');
        URL.revokeObjectURL(casesUrl);
        URL.revokeObjectURL(controlsUrl);
    }

    function triggerDownload(url, name) {
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }
    hideLoading();
}
