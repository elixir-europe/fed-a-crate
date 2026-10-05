/* TODO: Currently, SNP is not displayed
export function displaySNP(snp) {
    document.getElementById('snpDisplay').textContent = `SNP: rs${snp}`;
}*/


export function updateLoadingProgress(percentage) {
    try {
        setTimeout(() => {
            const bar = document.getElementById('progressFill');

            if (bar) {
                bar.style.width = `${percentage}%`;
            }
        }, 5);
    } catch (error) {
        console.error('HTML element not found: ', error);
    }
}


export function showAlert(inputId) {
    const alertDiv = document.querySelector(`#alert-${inputId}`);

    if (alertDiv) {
        alertDiv.classList.remove('hidden');
    }
}


export function hideAlert(inputId) {
    const alertDiv = document.querySelector(`#alert-${inputId}`);

    if (alertDiv) {
        alertDiv.classList.add('hidden');
    }
}


export function getHomePage() {
    return window.location.hash.substring(1) || 'generation';
}


export function showLoading(type = 'bar') {
    const screen = document.getElementById('loadingScreen');
    const bar = document.getElementById('progressContainer');
    const spinner = document.getElementById('progressSpinner');

    screen.style.display = 'flex';

    if (type === 'bar') {
        bar.style.display = 'block';
        spinner.style.display = 'none';
    } else if (type === 'spinner') {
        spinner.style.display = 'block';
        bar.style.display = 'none';
    }
}


export function hideLoading() {
    document.getElementById('loadingScreen').style.display = 'none';
    document.getElementById('progressBar').style.display = 'none';
    document.getElementById('progressSpinner').style.display = 'none';
}


export function showLoadingText(text) {
    const loadingText = document.getElementById('loadingText');

    if (!loadingText) {
        console.error('HTML element not found');
    }

    loadingText.textContent = text;
}
