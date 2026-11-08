self.onmessage = async (e) => {
    const {
        taskId,
        snpsInfo,
        totalProfiles,
        chunkSize,
        sex,
        minAge,
        maxAge,
        minFollow,
        maxFollow,
        k,
        b
    } = e.data;

    try {
        const { processProfiles } = await import('../syntheticDataGenerator.js');
        const {
            compressAndStoreResults,
            reportProgress,
            reportComplete
        } = await import('../utils/workerUtils.js');

        const totalChunks = Math.ceil(totalProfiles / chunkSize);
        let processedCount = 0;

        for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
            const currentChunkSize = Math.min(chunkSize, totalProfiles - processedCount);
            const forageKey = `${taskId}_chunk_${chunkIndex}`;
            const profiles = await processProfiles(
                snpsInfo,
                currentChunkSize,
                sex,
                minAge,
                maxAge,
                minFollow,
                maxFollow,
                k,
                b
            );

            await compressAndStoreResults(forageKey, profiles);
            processedCount += currentChunkSize;
            reportProgress(processedCount, totalProfiles);
        }

        reportComplete();

    } catch (error) {
        const { reportError } = await import('../utils/workerUtils.js');
        reportError(error);
    }
};