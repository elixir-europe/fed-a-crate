importScripts('https://cdn.jsdelivr.net/npm/localforage@1.10.0/dist/localforage.js');
importScripts('https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js');


export async function compressAndStoreResults(key, results) {
    /* global localforage, pako */
    const compressed = pako.deflate(JSON.stringify(results));
    await localforage.setItem(key, compressed);
}


export function reportProgress(current, total) {
    const progress = Math.min(100, Math.floor((current / total) * 100));
    self.postMessage({ type: 'progress', progress });
}


export function reportComplete() {
    self.postMessage({ type: 'complete' });
}


export function reportError(error) {
    self.postMessage({ type: 'error', error: error.message || error.toString() });
}
