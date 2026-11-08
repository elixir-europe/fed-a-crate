export function parseFile(file) {
    const data = file.split('\n').map(line => line.trim().split('\t')).filter(line => line[0] && !line[0].startsWith('#'));

    return { headers: data[0], values: data.slice(1) };
}

export async function parseCsv(filePath, options) {
    if (!options) options = {};
    if (!options.lineSeparator) options.lineSeparator = ['\n', '\r\n', '\r'];
    if (!options.delimiter) options.delimiter = ',';
    if (!options.skip) options.skip = ['data'];
    if (!options.nLines) options.nLines = undefined;

    let response = await fetch(filePath);
    if (!response.ok) {
        throw Error(`File Path: ${filePath} does not exist`);
    }

    const text = await response.text();
    let data;

    for (const separator of options.lineSeparator) {
        data = text.split(separator);
        if (data.length > 1) break;
    }

    // Strip extra quotes or spaces from headers
    const header = data[0].split(options.delimiter).map(h => h.replace(/"|\s+/g, '').trim());

    if (options.nLines !== undefined) {
        data = data.slice(1, options.nLines + 1);
    }
    else {
        data = data.slice(1);
    }

    // Process data rows
    data = data.map((d) => {
        if (d.trim() === '') return null;
        let elements = d.split(options.delimiter).map(e => e.replace(/^"|"$/g, '').trim());

        return header.reduce((obj, k, i) => {
            let value = elements[i];

            // Convert "age" to an integer
            if (k === 'age') value = parseInt(value, 10);

            // Handle the "rate" field with validation
            if (k === 'rate') {
                value = parseFloat(value);

                // If the rate is NaN or empty, set it to 0
                if (isNaN(value) || value === '') {
                    value = 0;
                }
            }

            return { ...obj, [k]: value };
        }, {});
    });

    return data.filter((row) => row !== null);
}
