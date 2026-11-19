import { generateKaplanMeierData, getCohort } from '../syntheticDataGenerator.js';


/**
 * Display results by rendering incidence and survival charts.
 *
 * @param {Array<{age: string, rate: number}>} observedIncidenceRate - Array of observed incidence rates.
 * @param {Array<{age: string, rate: number}>} predictedIncidenceRate - Array of predicted incidence rates.
 *
 * @throws {Error} If input validation fails or rendering fails.
 *
 * @returns {Promise<void>} Resolves when results are displayed.
 */
export async function displayResults(observedIncidenceRate, predictedIncidenceRate) {
    if (!Array.isArray(observedIncidenceRate) || !observedIncidenceRate.length) {
        throw new Error('Missing observed data');
    }

    if (!Array.isArray(predictedIncidenceRate) || !predictedIncidenceRate.length) {
        throw new Error('Missing predicted data');
    }

    try {
        renderIncidenceChart(observedIncidenceRate, predictedIncidenceRate);
        await processCohortAndRenderKaplanMeier();
    } catch (error) {
        console.error('displayResults failed: ', error);
        throw error;
    }
}

/**
 * Process cohort profiles and render the Kaplan-Meier survival chart.
 *
 * Loads up to MAX_PROFILES cohort profiles, generates Kaplan-Meier survival data,
 * and renders the Kaplan-Meier chart. Throws errors if no profiles are available
 * or data generation fails.
 *
 * @throws {Error} If no cohort profiles are loaded or Kaplan-Meier data generation fails.
 * @throws {Error} If rendering the Kaplan-Meier chart fails.
 *
 * @returns {Promise<void>} Resolves when the Kaplan-Meier chart has been rendered.
 */
async function processCohortAndRenderKaplanMeier() {
    const MAX_PROFILES = 50_000;
    const cohort = await loadCohortProfiles(MAX_PROFILES);

    if (cohort.length === 0) {
        throw new Error('No cohort profiles available for Kaplan-Meier analysis');
    }

    const kmData = await generateKaplanMeierData(cohort);

    if (!kmData || kmData.length === 0) {
        throw new Error('Kaplan-Meier data generation failed');
    }

    try {
        await renderKaplanMeierChart(kmData);
        cohort.splice(0, cohort.length);

    } catch (error) {
        console.error('Failed to render chart: ', error);
        throw error;
    }
}


/**
 * Load a specified maximum number of cohort profiles asynchronously.
 *
 * @param {number} maxProfiles - Maximum number of profiles to load.
 *
 * @throws {Error} If maxProfiles is not a valid number or cohort iterator is invalid.
 *
 * @returns {Promise<Object[]>} Resolves with an array of loaded cohort profiles.
 */
async function loadCohortProfiles(maxProfiles) {
    if (typeof maxProfiles != 'number' || isNaN(maxProfiles)) {
        throw new Error('Max profiles must be number');
    }

    const cohort = [];
    let profileCount = 0;
    const cohortIterator = getCohort({ prefix: 'task_', remapIds: true });

    if (!cohortIterator || typeof cohortIterator[Symbol.asyncIterator] !== 'function') {
        throw new Error('Cohort iterator is not an async iterable');
    }

    try {
        for await (const profile of cohortIterator) {
            cohort.push(profile);
            profileCount++;

            if (profileCount >= maxProfiles) break;
        }

        return cohort;
    } catch (error) {
        console.error('Failed to load cohort profiles: ', error);
        throw error;
    }
}


/**
 * Render a Kaplan-Meier survival curve chart with confidence intervals.
 *
 * @param {Object[]} kmCurveData - Array of data points with `time`, `survival`, `lower`, and `upper` properties.
 *
 * @throws {TypeError} If kmCurveData is missing or not an array.
 * @throws {Error} If required HTML elements or tooltip are not found.
 * @throws {Error} If the tooltip was not correctly generated.
 *
 * @returns {void}
 */
function renderKaplanMeierChart(kmCurveData) {
    if (!kmCurveData || !Array.isArray(kmCurveData)) {
        throw new TypeError('Missing or invalid input');
    }

    kmCurveData = kmCurveData.filter(d =>
        !isNaN(d.time) && !isNaN(d.lower) && !isNaN(d.upper)
    );

    // Get the container dimensions from CSS
    const htmlElement = d3.select('#kaplanMeierCurve');

    if (!htmlElement) {
        throw new Error('HTML not found');
    }

    const currentChart = document.querySelector('#kaplanMeierCurve svg');

    if (currentChart) {
        currentChart.remove();  // or clear the parent div, which you already do
    }

    const container = d3.select('#expectedIncidenceChartProspective').node();
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;

    // Calculate responsive margins (percentage-based)
    const margin = {
        top: Math.min(100, containerHeight * 0.2),    // 10% or 70px max
        right: Math.min(300, containerWidth * 0.1),  // 20% or 280px max
        bottom: Math.min(110, containerHeight * 0.2), // 10% or 80px max
        left: Math.min(70, containerWidth * 0.1)     // 10% or 60px max
    };
    const width = containerWidth - margin.left - margin.right;
    const height = containerHeight - margin.top - margin.bottom;

    // Clear previous chart
    htmlElement.html('');
    const svg = htmlElement
        .append('svg').attr('viewBox', `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`)
        .attr('preserveAspectRatio', 'xMidYMid meet')
        .style('font-family', 'sans-serif')
        .append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);


    // Scales
    const x = d3.scaleLinear()
        .domain(d3.extent(kmCurveData, d => d.time))
        .range([0, width]);
    const yMin = d3.min(kmCurveData, d => d.lower);
    const yMax = d3.max(kmCurveData, d => d.upper);
    const y = d3.scaleLinear()
        .domain([Math.max(0, yMin - 0.05), Math.min(1, yMax + 0.05)])  // small padding
        .range([height, 0]);

    // Axes
    const xAxis = d3.axisBottom(x).ticks(5);
    const yAxis = d3.axisLeft(y).ticks(6).tickFormat(d3.format('.0%'));

    svg.append('g')
        .attr('transform', `translate(0,${height})`)
        .call(xAxis)
        .append('text')
        .attr('class', 'axis-label')
        .attr('x', width / 2)
        .attr('y', 40)
        .attr('fill', 'black')
        .text('Time (years)');

    svg.append('g')
        .call(yAxis)
        .append('text')
        .attr('class', 'axis-label')
        .attr('x', -height / 2)
        .attr('y', -50)
        .attr('transform', 'rotate(-90)')
        .attr('fill', 'black')
        .attr('text-anchor', 'middle')
        .text('Percent survival');

    // Step-after line generator for survival
    const lineSurvival = d3.line()
        .x(d => x(d.time))
        .y(d => y(d.survival))
        .curve(d3.curveStepAfter);

    // Step-after line generator for upper CI
    const lineUpper = d3.line()
        .x(d => x(d.time))
        .y(d => y(d.upper))
        .curve(d3.curveStepAfter);

    // Step-after line generator for lower CI
    const lineLower = d3.line()
        .x(d => x(d.time))
        .y(d => y(d.lower))
        .curve(d3.curveStepAfter);

    // Draw confidence interval area
    svg.append('path')
        .datum(kmCurveData)
        .attr('fill', 'red')
        .attr('opacity', 0.15)
        .attr('stroke', 'none')
        .attr('d', d3.area()
            .x(d => x(d.time))
            .y0(d => y(d.lower))
            .y1(d => y(d.upper))
            .curve(d3.curveStepAfter)
        );

    // Draw survival line
    svg.append('path')
        .datum(kmCurveData)
        .attr('fill', 'none')
        .attr('stroke', 'red')
        .attr('stroke-width', 3)
        .attr('d', lineSurvival);

    // Tooltip setup
    const tooltip = d3.select('#tooltip');

    if (!tooltip) {
        throw new Error('No tooltip provided');
    }

    // Draw points for tooltip interaction
    svg.selectAll('circle')
        .data(kmCurveData)
        .join('circle')
        .attr('cx', d => x(d.time))
        .attr('cy', d => y(d.survival))
        .attr('r', 5)
        .attr('fill', 'red')
        .attr('opacity', 0)
        .on('mouseover', (event, d) => {
            tooltip.style('opacity', 1)
                .html(
                    `Time: ${d.time.toFixed(2)}<br>` +
                    `Survival probability: ${(d.survival * 100).toFixed(1)}%<br>` +
                    `95% CI: (${(d.lower * 100).toFixed(1)}%, ${(d.upper * 100).toFixed(1)}%)`
                )
                .style('left', (event.pageX + 10) + 'px')
                .style('top', (event.pageY - 28) + 'px');
            d3.select(event.currentTarget).attr('opacity', 1);
        })
        .on('mousemove', (event) => {
            tooltip.style('left', (event.pageX + 10) + 'px')
                .style('top', (event.pageY - 28) + 'px');
        })
        .on('mouseout', (event) => {
            tooltip.style('opacity', 0);
            d3.select(event.currentTarget).attr('opacity', 0);
        });
}


/**
 * Renders a line chart comparing observed and predicted incidence rates by age.
 *
 * @param {Array<{age: string, rate: number}>} observedIncidenceRate - Array of observed incidence rates by age.
 * @param {Array<{age: string, rate: number}>} predictedIncidenceRate - Array of predicted incidence rates by age.
 *
 * @throws {Error} If Input data is missing
 * @throws {Error} If non-numeric rates are found in data
 * @throws {Error} If Chart canvas element is not found
 * @throws {Error} If Chart creation fails
 *
 * @returns {void}
 */
export async function renderIncidenceChart(observedIncidenceRate, predictedIncidenceRate) {
    /* global Chart */
    if (!observedIncidenceRate || !predictedIncidenceRate) {
        throw new Error('Missing input');
    }

    const observedRates = observedIncidenceRate.map(entry => entry.rate);
    const predictedRates = predictedIncidenceRate.map(entry => entry.rate);

    if (observedRates.some(rate => isNaN(rate)) || predictedRates.some(rate => isNaN(rate))) {
        throw new Error('Non-numeric rate found in observedData');
    }

    const labels = observedIncidenceRate.map(entry => entry.age);

    const config = {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Observed Incidence',
                    data: observedRates,
                    borderColor: 'red',
                    borderWidth: 2,
                    fill: false,
                    pointRadius: 0,
                    borderDash: [2, 2]
                },
                {
                    label: 'Predicted Incidence',
                    data: predictedRates,
                    borderColor: 'blue',
                    borderWidth: 2,
                    fill: false,
                    pointRadius: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function(tooltipItem) {
                            const datasetLabel = tooltipItem.dataset.label;
                            const value = tooltipItem.raw.toFixed(4);

                            return `${datasetLabel} - Age ${tooltipItem.label}: ${value}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    title: { display: true, text: 'Age →' }
                },
                y: {
                    title: { display: true, text: '↑ Incidence Rate' },
                    beginAtZero: true,
                    min: 0,
                }
            }
        }
    };

    const ctx = document.getElementById('expectedIncidenceChartProspective').getContext('2d');

    if (!ctx) {
        throw new Error('HTML element not found');
    }

    const chartExists = Chart?.getChart('expectedIncidenceChartProspective');

    if (chartExists) {
        chartExists.destroy();
    }

    try {
        new Chart(ctx, config);
    }
    catch (error) {
        console.error("Failed to create chart: ", error);
        ctx.canvas.parentElement.innerHTML = '<p class="chart-error">Chart could not be displayed</p>';

        throw error;
    }
}
