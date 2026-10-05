export async function httpRequest(url) {
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
    }

    return response;
}

export async function asyncPool(poolLimit, array, iteratorFn) {
    const ret = [];

    for (let i = 0; i < array.length; i += poolLimit) {
        const batch = array.slice(i, i + poolLimit);
        const batchPromises = batch.map(item => iteratorFn(item));
        const batchResults = await Promise.all(batchPromises);
        ret.push(...batchResults);
    }

    return ret;
}
