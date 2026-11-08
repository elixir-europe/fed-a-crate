self.onmessage = async (e) => {
    const {
        taskId, snpsInfo, numberOfCases, controlsPerCase, chunkSize, sex,
        minAge, maxAge, minFollow, maxFollow, k, b
    } = e.data;

    try {
        const { processProfiles, matchCasesControls } = await import('../syntheticDataGenerator.js');
        const { INDEX } = await import('../constants.js');
        const {
            compressAndStoreResults,
            reportComplete
        } = await import('../utils/workerUtils.js');

        let generatedCases = 0;
        let chunkIndex = 0;

        while (generatedCases < numberOfCases) {
            let batchProfiles = await processProfiles(
                snpsInfo,
                chunkSize,
                sex,
                minAge,
                maxAge,
                minFollow,
                maxFollow,
                k,
                b
            );

            let casesPool = batchProfiles.filter(p => p[INDEX.CASE] === 1);
            const remainingCases = numberOfCases - generatedCases;

            casesPool = casesPool.slice(0, remainingCases);

            if (casesPool.length === 0) continue;

            const onsetAges = casesPool.map(p => p[INDEX.ONSET]);
            const minOnset = Math.min(...onsetAges);
            const maxOnset = Math.max(...onsetAges);

            let controlProfiles = await processProfiles(
                snpsInfo,
                chunkSize * 2,
                sex,
                minOnset,
                maxOnset,
                minFollow,
                maxFollow,
                k,
                b
            );

            const controlsPool = controlProfiles.filter(p => p[INDEX.CASE] === 0);

            if (controlsPool.length === 0) continue;

            let { casesMatched, results } = matchCasesControls(casesPool, controlsPool, controlsPerCase);

            if (casesMatched === 0) continue;

            const remainingToStore = numberOfCases - generatedCases;

            if (casesMatched > remainingToStore) {
                results = results.slice(0, remainingToStore * (1 + controlsPerCase));
                casesMatched = remainingToStore;
            }

            const forageKey = `${taskId}_chunk_${chunkIndex}`;
            await compressAndStoreResults(forageKey, results);
            generatedCases += casesMatched;
            console.log("Matched ", generatedCases, " cases/controls.");
            chunkIndex++;
            batchProfiles = null;
            controlProfiles = null;
        }

        reportComplete();

    } catch (error) {
        const { reportError } = await import('../utils/workerUtils.js');
        reportError(error);
    }
};
