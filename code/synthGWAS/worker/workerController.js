import {
    distributeProfilesByAgeGroups,
    getAgeGroupsBetween,
    updateLoadingProgress,
} from '../syntheticDataGenerator.js';


export async function handleModelSetup(pgsModelFile, ancestry, incidenceRateFile) {
    return new Promise((resolve, reject) => {
        const snpWorker = new Worker('worker/modelWorker.js');

        snpWorker.postMessage({
            pgsModelFile,
            ancestry,
            incidenceRateFile,
        });

        snpWorker.onmessage = (e) => {
            const { type, snpsInfo, observedIncidenceRate, predictedIncidenceRate, k, b } = e.data;

            if (type === 'meta') {
                snpWorker.terminate();
                resolve({ snpsInfo, observedIncidenceRate, predictedIncidenceRate, k, b });
            }
            else if (e.data.type === 'error') {
                console.error(`Snp Worker error:`, e.data.error);
            }
        };

        snpWorker.onerror = (error) => {
            snpWorker.terminate();
            reject(new Error(`SNP Worker error: ${error.message}`));
        };
    });
}


export async function handleProfileRetrieval(config, snpsInfo, k, b) {
    const {
        totalProfiles, minAge, maxAge, minFollowUp, maxFollowUp, populationData, sex
    } = config;

    let start = performance.now();
    const selectedAgeGroups = getAgeGroupsBetween(minAge, maxAge, populationData.ageSexPercentages);
    const profilesByAgeGroup = distributeProfilesByAgeGroups(totalProfiles, minAge, maxAge, populationData, sex, selectedAgeGroups);
    const tasks = [];
    let taskId = 0;

    Object.entries(profilesByAgeGroup).forEach(([currentSex, groupMap]) => {
        Object.entries(groupMap).forEach(([ageGroup, count]) => {
            if (count <= 0) return;

            const startAge = parseInt(ageGroup.substring(0, 2));
            const endAge = parseInt(ageGroup.substring(2));
            const chunkSize = 25_000;
            const numChunks = Math.ceil(count / chunkSize);

            for (let i = 0; i < numChunks; i++) {
                const profilesInTask = Math.min(chunkSize, count - i * chunkSize);

                tasks.push({
                    taskId: `task_${taskId++}`,
                    snpsInfo,
                    totalProfiles: profilesInTask,
                    chunkSize,
                    sex: currentSex,
                    minAge: startAge,
                    maxAge: endAge,
                    minFollow: minFollowUp,
                    maxFollow: maxFollowUp,
                    k,
                    b
                });
            }
        });
    });

    await startWorkerPool('worker/profilesWorker.js', tasks);
    let end = performance.now();
    console.log("GENERATION:", end-start)
}

export async function handleCaseControlRetrieval(
    config, controlsPerCase, snpsInfo, k, b, incidenceRateFile, pgsModelFile
) {
    const {
        totalProfiles, chunkSize, minAge, maxAge, minFollowUp, maxFollowUp, populationData, sex
    } = config;

    const selectedAgeGroups = getAgeGroupsBetween(minAge, maxAge, populationData.ageSexPercentages);
    const profilesByAgeGroup = distributeProfilesByAgeGroups(totalProfiles, minAge, maxAge, populationData, sex, selectedAgeGroups);
    const tasks = [];
    let taskId = 0;

    Object.entries(profilesByAgeGroup).forEach(([currentSex, groupMap]) => {
        Object.entries(groupMap).forEach(([ageGroup, totalCases]) => {
            if (totalCases <= 0) return;

            let startAge = parseInt(ageGroup.substring(0, 2));
            let endAge = parseInt(ageGroup.substring(2));
            const totalControls = totalCases * controlsPerCase;
            const totalInGroup = totalCases + totalControls;

            if (minAge > startAge) startAge = minAge;
            if (maxAge < endAge) endAge = maxAge;

            // Calculate how many chunks we need for this age group
            const numChunks = Math.ceil(totalInGroup / chunkSize);

            // Split cases and controls evenly across chunks
            const casesPerChunk = Math.ceil(totalCases / numChunks);
            const controlsPerChunk = Math.ceil(totalControls / numChunks);

            for (let i = 0; i < numChunks; i++) {
                // Calculate remaining cases for the last chunk
                const remainingCases = totalCases - (i * casesPerChunk);
                const remainingControls = totalControls - (i * controlsPerChunk);

                const chunkCases = Math.min(casesPerChunk, remainingCases);
                const chunkControls = Math.min(controlsPerChunk, remainingControls);

                // Skip empty chunks
                if (chunkCases <= 0 && chunkControls <= 0) continue;

                tasks.push({
                    taskId: `task_${taskId++}`,
                    snpsInfo,
                    numberOfCases: chunkCases,  // Only assign portion of cases
                    controlsPerCase: Math.ceil(chunkControls / Math.max(1, chunkCases)),
                    chunkSize: Math.min(chunkSize, chunkCases + chunkControls),
                    sex: currentSex,
                    minAge: startAge,
                    maxAge: endAge,
                    minFollow: minFollowUp,
                    maxFollow: maxFollowUp,
                    k,
                    b
                });
            }

            console.log(`Age group ${ageGroup}: ${totalCases} cases split into ${numChunks} chunks`);
        });
    });

    console.log(`Total tasks created: ${tasks.length}`);
    await startWorkerPool('worker/caseControlWorker.js', tasks);
}

function startWorkerPool(workerScript, tasks) {
    return new Promise((resolve, reject) => {
        const maxConcurrentWorkers = 2;
        const workers = [];
        let activeWorkers = 0;
        let completedTasks = 0;
        const totalTasks = tasks.length;
        let hasError = false;

        const processNextTask = () => {
            // Don't start new tasks if we have errors or no more tasks
            if (hasError || tasks.length === 0 || activeWorkers >= maxConcurrentWorkers) {
                return;
            }

            const task = tasks.shift();
            const worker = new Worker(workerScript);
            activeWorkers++;

            worker.postMessage(task);

            worker.onmessage = (e) => {
                if (e.data.type === 'complete') {
                    worker.terminate();
                    activeWorkers--;
                    completedTasks++;

                    console.log(`Completed ${completedTasks}/${totalTasks} tasks`);
                    updateLoadingProgress((completedTasks/totalTasks) * 100);

                    if (completedTasks === totalTasks) {
                        resolve();
                    } else {
                        processNextTask(); // Start next task
                    }
                } else if (e.data.type === 'error') {
                    console.error('Worker error:', e.data.error);
                    hasError = true;
                    worker.terminate();
                    reject(new Error(e.data.error));
                }
            };

            worker.onerror = (error) => {
                console.error('Worker error:', error);
                hasError = true;
                worker.terminate();
                reject(error);
            };
        };

        // Start initial batch of workers
        for (let i = 0; i < Math.min(maxConcurrentWorkers, tasks.length); i++) {
            processNextTask();
        }

        // If no tasks, resolve immediately
        if (totalTasks === 0) {
            resolve();
        }
    });
}
