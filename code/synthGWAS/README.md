# SynthGWAS — Synthetic Cohort Generator

SynthGWAS is a browser-based tool that generates **synthetic genetic cohorts** (prospective or retrospective/case–control) driven by Polygenic Scores (PGS) from the [PGS Catalog](https://www.pgscatalog.org/), population demographics from the [World Bank](https://data.worldbank.org/), and real-world, country-specific disease incidence rates.

Everything runs client-side in your browser. There is no backend and nothing to install.

**Live app:** <https://episphere.github.io/synthGWAS/>

---

## Table of contents

- [Quick start](#quick-start)
- [Using the app](#using-the-app)
  - [1. Population-specific parameters](#1-population-specific-parameters)
  - [2. Cohort-specific parameters](#2-cohort-specific-parameters)
  - [3. Generate the cohort](#3-generate-the-cohort)
  - [4. View results and download](#4-view-results-and-download)
- [Output formats](#output-formats)
- [How it works](#how-it-works)
- [Running locally](#running-locally)
- [Project structure](#project-structure)
- [Browser requirements and troubleshooting](#browser-requirements-and-troubleshooting)

---

## Quick start

1. Open <https://episphere.github.io/synthGWAS/> in a recent desktop browser (Chrome, Firefox, Edge or Safari).
2. On the **Cohort Generation** page, choose a **Country**, **Sex**, and **Disease**.
3. Adjust the age, cohort size and follow-up settings if needed (the defaults work).
4. Click **Generate Cohort** and wait for the progress bar to finish.
5. The **Results** page opens. Inspect the charts, then click **Export All Profiles As CSV** or **Export All Profiles As VCF**.

---

## Using the app

The app has three pages, reachable from the top navigation bar:

| Page | File | Purpose |
|------|------|---------|
| **Cohort Generation** | `index.html` | Set parameters and run the simulation |
| **Results** | `results.html` | Charts for the last generated cohort, plus downloads |
| **Tutorial** | `tutorial.html` | In-app guide and methodology |

### 1. Population-specific parameters

Shown in the left panel of the Cohort Generation page.

| Field | Description | Default |
|-------|-------------|---------|
| **Country** | Country whose age/sex distribution (World Bank, 2023) is used to sample ages at study entry, and whose incidence rates are used as the calibration target. | — |
| **Sex** | `Male` or `Female`. | — |
| **Age of Entry Range (years)** | Lower and upper bounds for each individual's age when they enter the study. | 30 to 80 |

Supported countries and ancestries:

| Country | Ancestry |
|---------|----------|
| China | EAS |
| India | SAS |
| Portugal | EUR |
| Spain | EUR |
| United States of America | AMR |
| United States of America | EUR |
| Zimbabwe | AFR |

### 2. Cohort-specific parameters

Shown in the right panel.

| Field | Description | Default |
|-------|-------------|---------|
| **Disease** | Disease and its associated PGS Catalog score. | — |
| **Total Number of Profiles** | *Prospective:* total number of individuals to generate. *Retrospective:* number of **cases** to generate. | 1000 (100 to 10,000) |
| **Follow-Up Period (years)** | Min/max follow-up duration. Each profile's duration is sampled uniformly from this interval. | 15 to 30 |
| **Create Retrospective Cohort?** | Unchecked gives a **prospective** cohort. Checked gives a **retrospective** (case–control) cohort. | Unchecked |
| **Number of Controls per Case** | Only shown for retrospective cohorts. The integer number of controls matched to each case. | 1 |

Supported diseases:

| Disease | PGS ID |
|---------|--------|
| Breast Cancer | [PGS000004](https://www.pgscatalog.org/score/PGS000004/) |
| Epithelial Ovarian Cancer | [PGS003394](https://www.pgscatalog.org/score/PGS003394/) |
| Kidney Cancer | [PGS004908](https://www.pgscatalog.org/score/PGS004908/) |
| Lung Cancer | [PGS000740](https://www.pgscatalog.org/score/PGS000740/) |

> Note: sex-specific diseases (for example breast or ovarian cancer) should be combined with the matching sex, because incidence data for the other sex may be zero or not meaningful.

If a required field is missing or out of range, a red alert appears above that field and generation does not start.

### 3. Generate the cohort

Click **Generate Cohort**. A loading screen with a progress bar appears while the app:

1. Downloads the harmonized PGS scoring file (GRCh38) and retrieves the allele frequencies for each SNP.
2. Simulates **100,000 Polygenic Risk Scores (PRS)** from the SNP data.
3. Fits a **Cox Proportional Hazards** model with a Weibull baseline hazard, optimizing its parameters with **Nelder–Mead** so that the predicted cumulative incidence matches the observed country-specific incidence.
4. Generates the synthetic profiles (age of entry, follow-up, sex, genotypes, PRS, case status, age of onset).
5. For retrospective cohorts, matches each case with the requested number of controls by **age at entry** and **sex**.

Generation can take from a few seconds to a few minutes, depending on the cohort size, the number of SNPs in the score, and your network. **Keep the tab open** until it finishes. When it does, the app opens the **Results** page.

### 4. View results and download

On the **Results** page, use the ‹ / › arrows to move between charts:

- **Observed vs. Predicted Incidence Rates**: the real-world incidence compared with the incidence predicted by the fitted Cox PH model.
- **Kaplan–Meier Curve**: survival estimate (proportion event-free over time) for the synthetic cohort.

Download buttons:

- **Export All Profiles As CSV**
- **Export All Profiles As VCF**

For a prospective cohort, the export contains every generated profile. For a retrospective cohort, it contains the matched cases and controls.

The last generated cohort is stored in your browser (IndexedDB, through localforage), so you can reload the Results page without generating it again.

---

## Output formats

### CSV

One row per individual:

| Column | Meaning |
|--------|---------|
| `id` | Profile identifier |
| `ageOfEntry` | Age at study entry (years) |
| `ageOfExit` | Age at end of follow-up (years) |
| `sex` | `male` / `female` |
| `prs` | Polygenic risk score |
| `case` | Case status (1 = developed the disease during follow-up, 0 = control) |
| `ageOfOnset` | Age at disease onset (cases only) |
| `<SNP id>` … | One column per PGS variant with the allele dosage (0/1/2) |

### VCF

A standard **VCFv4.2** file with one row per variant (`#CHROM POS ID REF ALT …`) and one sample column per profile, with genotypes in the `GT` field. You can use it directly with tools such as PLINK, bcftools or GWAS pipelines.

---

## How it works

| Input | Source |
|-------|--------|
| PGS scoring files (variants, effect alleles, weights) | [PGS Catalog FTP](https://ftp.ebi.ac.uk/pub/databases/spot/pgs/scores/), harmonized GRCh38. Local copies are in `data/disease/` |
| Allele frequencies | [Ensembl REST API](https://rest.ensembl.org/) |
| Country list and population by age/sex | [World Bank API](https://api.worldbank.org/v2/) |
| Disease incidence rates by age, sex and country | Bundled CSVs in `data/incidence-rate/<country>/` (`age,rate`) |

Methodology summary:

- **Age of entry** is sampled from the country's population distribution across age bins for the selected sex, restricted to the chosen age range.
- **Follow-up** duration is sampled uniformly from the chosen interval.
- **Genotypes** are simulated from the allele frequencies. The **PRS** is the weighted sum of effect-allele dosages.
- **Disease onset** comes from a Cox PH model whose baseline hazard and PRS effect are calibrated (Nelder–Mead) against the observed incidence.
- **Retrospective cohorts** generate the requested number of cases first, then draw age- and sex-matched controls (no event during the same follow-up) from the remaining pool.

Heavy computation runs in **Web Workers** (`worker/`), so the page stays responsive.

The **Tutorial** page in the app has the full methodology.

---

## Running locally

The app uses ES modules and Web Workers, so you must serve it over HTTP. Opening `index.html` directly with `file://` does not work.

```bash
git clone https://github.com/episphere/synthGWAS.git
cd synthGWAS

# Any static server works, for example:
python3 -m http.server 8000
# or
npx serve .
```

Then open <http://localhost:8000/>.

You need an internet connection even when running locally. The app loads libraries from CDNs (Chart.js, D3, pako, localforage, Font Awesome) and queries the PGS Catalog, Ensembl and the World Bank.

---

## Project structure

```
synthGWAS/
├── index.html               # Cohort Generation page
├── results.html             # Results page (charts + downloads)
├── tutorial.html            # Tutorial / methodology page
├── index.js                 # Aggregates module exports
├── syntheticDataGenerator.js
├── constants.js             # Shared constants (sex, column indices, chunk size)
├── pages/                   # Page entry points (generator, results, tutorial)
├── ui/                      # UI handlers and chart rendering
├── utils/                   # Parsing, genetics, math, Nelder–Mead, loaders, HTTP
├── worker/                  # Web Workers (model fitting, profiles, Ensembl, case–control)
├── css/                     # Styles and images
└── data/
    ├── disease/             # PGS scoring files
    └── incidence-rate/      # Incidence rates per country / sex / PGS
```

---

## Browser requirements and troubleshooting

- Use a recent desktop browser with support for ES modules, Web Workers and IndexedDB.
- **Countries or diseases stuck on "Loading…"**: check your internet connection and any ad/script blockers. The app needs access to `api.worldbank.org`, `cdn.jsdelivr.net` and `cdnjs.cloudflare.com`.
- **Generation is slow or fails**: large cohorts and scores with many SNPs require many Ensembl requests. Try fewer profiles, or try again later if Ensembl is rate-limiting.
- **Results page is empty**: generate a cohort first. If it still fails, clear the site data in your browser (this removes the stored cohort) and generate again.
- **Private/incognito mode**: some browsers restrict IndexedDB storage, which can prevent results from being saved.
