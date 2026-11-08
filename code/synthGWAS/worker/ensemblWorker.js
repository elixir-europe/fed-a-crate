importScripts('https://cdn.jsdelivr.net/npm/localforage@1.10.0/dist/localforage.js');
importScripts('https://cdnjs.cloudflare.com/ajax/libs/pako/1.0.11/pako.min.js');


self.onmessage = async (e) => {
    /* global localforage */
    const {
        rsId,
        ancestry,
    } = e.data;

    try {
        const { getEnsemblFrequency
        } = await import('../syntheticDataGenerator.js');

        const frequency = await getEnsemblFrequency();

        self.postMessage({
            frequency: frequency
        });
    } catch (error) {
        self.postMessage({ type: 'error', error: error.message });
    }
};
