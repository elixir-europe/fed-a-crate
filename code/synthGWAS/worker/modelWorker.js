importScripts('https://cdn.jsdelivr.net/npm/localforage@1.10.0/dist/localforage.js');
importScripts('https://cdnjs.cloudflare.com/ajax/libs/pako/1.0.11/pako.min.js');


self.onmessage = async (e) => {
    /* global localforage */
    const {
        pgsModelFile,
        ancestry,
        incidenceRateFile,
    } = e.data;

    try {
        const {
            parseCsv, getSnpsInfo, processHeader, processPRS, generateWeibullIncidenceCurve, estimateWeibullParameters, empiricalCdf, getCountrySnpFrequency
        } = await import('../syntheticDataGenerator.js');

        const start = performance.now()
        const snpsInfo = await getSnpsInfo(pgsModelFile, ancestry);
        let count = 0;
        const test = snpsInfo.forEach(snp=>{
            if (!snp.rsID) count++
        })
        console.log("COUNT for no rsIDs", count)

        const end = performance.now()
        console.log("SNPS INFO processing time: ", end-start)
        const header = await processHeader(snpsInfo);
        const observedIncidenceRate = await parseCsv(incidenceRateFile, { delimiter: ',' });
        console.log("OBSERVED ", observedIncidenceRate)
        const trainingLP = processPRS(snpsInfo);
        const [k, b] = estimateWeibullParameters(empiricalCdf(observedIncidenceRate), trainingLP);
        const exp_b = Math.exp(b);
        const predictedIncidenceRate = generateWeibullIncidenceCurve(k, exp_b, trainingLP, observedIncidenceRate.length);

        await localforage.setItem('header', header);

        // Send metadata and initialization signal
        self.postMessage({
            type: 'meta',
            snpsInfo: snpsInfo,
            observedIncidenceRate,
            predictedIncidenceRate,
            k: k,
            b: exp_b
        });
    } catch (error) {
        self.postMessage({ type: 'error', error: error.message });
    }
};
