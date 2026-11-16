export function zeros(x) {
    let r = new Array(x);

    for (let i = 0; i < x; ++i) {
        r[i] = 0;
    }

    return r;
}

export function zerosM(x, y) {
    return zeros(x).map(function() {
        return zeros(y);
    });
}

export function dot(a, b) {
    let ret = 0;

    for (let i = 0; i < a.length; ++i) {
        ret += a[i] * b[i];
    }

    return ret;
}

export function norm2(a) {
    return Math.sqrt(dot(a, a));
}

export function scale(ret, value, c) {
    for (let i = 0; i < value.length; ++i) {
        ret[i] = value[i] * c;
    }
}

export function weightedSum(ret, w1, v1, w2, v2) {
    for (let j = 0; j < ret.length; ++j) {
        ret[j] = w1 * v1[j] + w2 * v2[j];
    }
}

export function empiricalCdf(incidenceRates) {
    console.log("EMPI", incidenceRates)
    let cumulativeHazard = 0;

    const cdfArray = incidenceRates.map((ageRate) => {
        cumulativeHazard += ageRate.rate;

        const cdf = 1 - Math.exp(-cumulativeHazard);

        return { age: ageRate.age, cdf };
    });

    console.log(cdfArray)
    return cdfArray;
}

export function calculateRates(timePoints, timeOfOnset) {
    return timePoints.map(t => {
        let count = timeOfOnset.filter(time => time < t).length;

        return count / timeOfOnset.length;
    });
}
