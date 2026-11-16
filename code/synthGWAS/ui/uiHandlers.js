import {
    handleCaseControlRetrieval,
    handleProfileRetrieval,
    handleModelSetup,
    downloadVcfFromChunks,
    downloadCohortFromChunks,
    loadPopulation, showAlert, hideAlert, updateLoadingProgress,
    showLoading, showLoadingText, hideLoading, getCountrySnpFrequency
} from '../syntheticDataGenerator.js';
import { SEX, DEFAULT_CHUNK_SIZE } from '../constants.js';


/* global localforage */
async function handleDataGeneration(params) {
    const {
        isRetrospective = false,
        countryISO,
        ancestry,
        sex = 'male',
        pgsIdInput,
        numberOfProfiles,
        minAge,
        maxAge,
        minFollowUp,
        maxFollowUp,
        controlsPerCase = 1,
    } = params;
    showLoading('spinner');
    showLoadingText('Modeling Hazard Rates...')

    let snpsInfo, observedIncidenceRate, predictedIncidenceRate, k, b;
    const disease = pgsIdInput;
    let incidenceRateFile = `../data/incidence-rate/${countryISO.toLowerCase()}/${disease}_${sex}_${countryISO.toLowerCase()}.csv`;

    if (countryISO.toLowerCase() === "usa") {
        incidenceRateFile = `../data/incidence-rate/${countryISO.toLowerCase()}/${ancestry.toLowerCase()}/${disease}_${sex}_${countryISO.toLowerCase()}.csv`;
    }

    const pgsModelFile = `../data/disease/${disease}.txt`;

    try {
        ({ snpsInfo, observedIncidenceRate, predictedIncidenceRate, k, b } = await handleModelSetup(
            pgsModelFile,
            ancestry,
            incidenceRateFile,
        ));
    } catch (error) {
        console.error('Failed to load SNPs info: ', error);
        alert('Error loading SNPs information, please reload the page and try again');

        throw error;
    }

    const populationData = await localforage.getItem('populationData');

    if (!populationData) {
        throw new Error('Could not find population data');
    }

    try {
        setTimeout(() => {
            updateLoadingProgress(0);
            showLoading('bar');
            showLoadingText('Generating Synthetic Cohort...')
        }, 10);

        let config = {
            totalProfiles: Number(numberOfProfiles),
            chunkSize: 0,
            minAge: Number(minAge),
            maxAge: Number(maxAge),
            minFollowUp: Number(minFollowUp),
            maxFollowUp: Number(maxFollowUp),
            populationData: populationData,
            sex: sex
        };

        if (isRetrospective) {
            config.chunkSize = DEFAULT_CHUNK_SIZE;
            await handleCaseControlRetrieval(config, controlsPerCase, snpsInfo, k, b, incidenceRateFile, pgsModelFile);
        }
        else {
            config.chunkSize = Math.min(DEFAULT_CHUNK_SIZE, Number(numberOfProfiles));
            await handleProfileRetrieval(config, snpsInfo, k, b, incidenceRateFile, pgsModelFile);
        }
        hideLoading();

        return { observedIncidenceRate, predictedIncidenceRate };
    } catch (error) {
        console.error('Error during profile generation: ', error.message);
        alert('Error during profile generation, please reload the page and try again');
        throw error;
    }
}


export function setupSlideshow() {
    let slideIndex = 1;

    function showSlides(n) {
        const charts = document.getElementsByClassName("charts");
        const dots = document.getElementsByClassName("dot");

        if (charts.length === 0) return;

        if (n > charts.length) slideIndex = 1;
        if (n < 1) slideIndex = charts.length;

        for (let i = 0; i < charts.length; i++) {
            charts[i].style.display = "none";
        }

        for (let i = 0; i < dots.length; i++) {
            dots[i].classList.remove("active");
        }

        charts[slideIndex - 1].style.display = "block";
        if (dots[slideIndex - 1]) {
            dots[slideIndex - 1].classList.add("active");
        }
    }

    function plusSlides(n) {
        showSlides(slideIndex += n);
    }

    function currentSlide(n) {
        showSlides(slideIndex = n);
    }

    // Attach event listeners
    const prevBtn = document.getElementById("prevSlide");
    const nextBtn = document.getElementById("nextSlide");

    if (prevBtn) prevBtn.addEventListener("click", () => plusSlides(-1));
    if (nextBtn) nextBtn.addEventListener("click", () => plusSlides(1));

    const dots = document.querySelectorAll(".dot");
    dots.forEach((dot, index) => {
        dot.addEventListener("click", () => currentSlide(index + 1));
    });

    // Initialize slideshow
    showSlides(slideIndex);
}


export function setupDownloadBtns() {
    // Download profiles
    /* global localforage, pako */
    try {
        document.getElementById('downloadProspective')?.addEventListener('click', async () => {
            await downloadCohortFromChunks({
                prefix: 'task_',
                filename: 'all_profiles.csv',
                splitDataset: false
            });
        });

        document.getElementById('downloadRetrospective')?.addEventListener('click', async () => {
            await downloadCohortFromChunks({
                prefix: 'task_',
                filename: 'case_controls.csv',
                splitDataset: true
            });
        });

        // Download VCF
        document.getElementById('downloadProspectiveVCF')?.addEventListener('click', async () => {
            const header = await localforage.getItem('header');

            await downloadVcfFromChunks({
                header: header,
                prefix: 'task_',
                filename: 'profiles.vcf'
            });
        });
    }
    catch (error) {
        console.error('Error setting download buttons: ', error);
        throw error;
    }
}


/* global localforage */
export function setupInput() {
    try {
        document.getElementById('countrySelect').addEventListener('change', async (e) => {
            const countryISO = e.target.value.split(',')[0];

            if (countryISO) {
                const ageData = await loadPopulation(countryISO);

                await localforage.setItem('populationData', ageData);
            }
        });

        document.getElementById('sexSelect').innerHTML = `
            <option value="${SEX.MALE}">Male</option>
            <option value="${SEX.FEMALE}">Female</option>
        `;

        //<option value="${'PGS002265'}">Colorectal Cancer (PGS002265)</option>
        document.getElementById('diseaseSelect').innerHTML = `
            <option value="${'PGS000004'}">Breast Cancer (PGS000004)</option>
            <option value="${'PGS003394'}">Epithelial Ovarian Cancer (PGS003394)</option>
            <option value="${'PGS004908'}">Kidney Cancer (PGS004908)</option>
            <option value="${'PGS000740'}">Lung Cancer (PGS000740)</option>
        `;

        const checkbox = document.getElementById('retrospectiveToggle');
        const advancedSection = document.getElementById('retrospectiveZone');

        checkbox.addEventListener('change', () => {
            advancedSection.style.display = checkbox.checked ? 'block' : 'none';
        });
    } catch (error) {
        console.error('Error setting input parameters: ', error);
    }
}


export async function setupCohortGeneration() {
    const generateBtn = document.getElementById('generateZone');

    try {
        generateBtn.style.display = 'flex';
        generateBtn.addEventListener('click', async () => {
            const params = getParams();

            if (!validateParams(params)) {
                console.warn("Some parameters are missing");

                return;
            }

            await generateAndDisplay(params);
        });
    }
    catch (error) {
        console.error('Error setting generate button: ', error);
    }
}


function getParams() {
    try {
        return {
            isRetrospective: document.getElementById('retrospectiveToggle').checked,
            countryISO: document.getElementById('countrySelect').value.trim().split(',')[0],
            ancestry: document.getElementById('countrySelect').value.trim().split(',')[1],
            sex: document.getElementById('sexSelect').value.trim(),
            pgsIdInput: document.getElementById('diseaseSelect').value.trim(),
            numberOfProfiles: document.getElementById('numberOfProfiles').value.trim(),
            minAge: document.getElementById('minAge').value.trim(),
            maxAge: document.getElementById('maxAge').value.trim(),
            minFollowUp: document.getElementById('minFollowUp').value.trim(),
            maxFollowUp: document.getElementById('maxFollowUp').value.trim(),
            controlsPerCase: document.getElementById('retrospectiveInput').value.trim(),
            loadingScreen: document.getElementById('loadingScreen'),
        };
    }
    catch (error) {
        console.error('Error finding parameters: ', error);
    }
}


function validateParams(params) {
    if (!params) {
        throw new Error('Parameters is required');
    }

    let hasError = false;

    hideAlert('country');
    hideAlert('pgs');
    hideAlert('profiles');
    hideAlert('cases');
    hideAlert('age-range');
    hideAlert('age-follow');
    hideAlert('controls');

    if (!params.countryISO) {
        showAlert('country');
        hasError = true;
    }

    if (!/^(PGS\d{6}|\d{1,6})$/.test(params.pgsIdInput)) {
        showAlert('pgs');
        hasError = true;
    }

    if (!params.numberOfProfiles || isNaN(params.numberOfProfiles) || Number(params.numberOfProfiles) <= 0) {
        if (params.isRetrospective) showAlert('cases');
        else showAlert('profiles');
        hasError = true;
    }

    if (!params.minAge || isNaN(params.minAge) || !params.maxAge || isNaN(params.maxAge) ||
        Number(params.minAge) < 0 || Number(params.maxAge) < Number(params.minAge)) {
        showAlert('age-range');
        hasError = true;
    }

    if (!params.minFollowUp || isNaN(params.minFollowUp) || !params.maxFollowUp || isNaN(params.maxFollowUp) ||
        Number(params.minFollowUp) < 0 || Number(params.maxFollowUp) < Number(params.minFollowUp)) {
        showAlert('age-follow');
        hasError = true;
    }

    if (params.isRetrospective && (!params.controlsPerCase || isNaN(params.controlsPerCase))) {
        showAlert('controls');
        hasError = true;
    }

    return !hasError;
}


async function generateAndDisplay(params) {
    try {
        const { observedIncidenceRate, predictedIncidenceRate } = await handleDataGeneration(params);

        await localforage.setItem('observedIncidenceRate', observedIncidenceRate);
        await localforage.setItem('predictedIncidenceRate', predictedIncidenceRate);
        window.location.href = 'results.html';
    } catch (error) {
        console.error('Error generating cohort:', error);
        alert('Failed to generate cohort. Please check your input or try again.');
    }
}
