# 💸 EconoCausal — Dynamic Pricing via Double Machine Learning

[![Live demo](https://img.shields.io/badge/live%20demo-GitHub%20Pages-0d9488?style=for-the-badge)](https://lakshanmuruganandam.github.io/EconoCausal-Dynamic-Pricing/)
![Python](https://img.shields.io/badge/Python-3.13-3776AB?style=flat-square&logo=python&logoColor=white)
![EconML](https://img.shields.io/badge/EconML-0.17-7c3aed?style=flat-square)
![DoWhy](https://img.shields.io/badge/DoWhy-0.14-e11d48?style=flat-square)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=flat-square&logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)

### 🔗 Live demo: **https://lakshanmuruganandam.github.io/EconoCausal-Dynamic-Pricing/**

The live demo is a static build. A full 20,000-customer pipeline run is snapshotted to JSON, and the **budget optimiser, allocation table, budget Sankey and What-If Lab run live in your browser** (TypeScript ports of the solver and the Linear DML model). Retraining and CSV upload need the Python backend; see [Quick Start](#-quick-start).

**EconoCausal** is a causal-AI platform for promotion planning. Standard ML predicts *who will buy*; EconoCausal estimates **how much a discount changes each customer's probability of buying**, the Individual Treatment Effect (ITE). It then allocates a fixed marketing budget only to the customers a coupon actually persuades.

> A user with a 90% churn probability might churn anyway, so a $20 discount is wasted on them.
> EconoCausal answers the counterfactual question: *would this customer buy **if and only if** we gave them the discount?*

---

## 🌟 Key Capabilities

| Module | Implementation | What it does |
| :--- | :--- | :--- |
| **Synthetic campaign SCM** | `backend/causal/data.py` | Structural causal model of a retail promotion with realistic targeting bias. It keeps the hidden counterfactuals (`true_*`) so every estimator can be audited against an oracle. |
| **Causal graph & identification** | `backend/causal/dag.py` (DoWhy) | DAG of confounders, effect modifiers and a latent trait. DoWhy derives the back-door adjustment set. |
| **Propensity score pipelines** | `backend/causal/propensity.py` | Multinomial generalised propensity score, IPW (Hájek), 1:1 caliper matching, love plot (SMD) and overlap diagnostics. |
| **Double ML engine** | `backend/causal/dml.py` (EconML) | `CausalForestDML`, `LinearDML` and `ForestDRLearner` with cross-fitted LightGBM nuisance models. Per-customer ITEs come with 95% CIs. |
| **Champion / challenger** | `backend/causal/engine.py` | Trains all three estimators and promotes the one with the best **hold-out IPW Qini**. Selection uses observed data only, so it works on real logs. |
| **Uplift evaluation** | `backend/causal/uplift.py` | IPW-adjusted Qini curves, normalised Qini, decile calibration, and Persuadables / Sure Things / Lost Causes / Sleeping Dogs segmentation. |
| **Refutation audit** | `backend/causal/dag.py` | Placebo treatment, random common cause, data subset, bootstrap and unobserved-confounder sensitivity. |
| **Prescriptive optimiser** | `backend/causal/optimizer.py` (SciPy HiGHS MILP) | Picks the profit-maximising offer ($0 / $10 / $20) per customer under a hard budget. It plans on risk-adjusted effects (τ̂ − λσ̂) to avoid the winner's curse. An exact LP frontier is computed via convex-hull greedy. |
| **Drift detector** | `backend/causal/drift.py` | PSI and KS tests per feature, plus drift in the predicted uplift. Four market-shift scenarios. |
| **Narratives** | `backend/causal/narrative.py` | Plain-English summaries, e.g. *"This strategy earns $6,551 more than blanket $10 targeting."* |
| **What-If Lab** | `backend/api/routes_lab.py` | Counterfactual simulator: edit any customer's traits and see P(buy) under $0 / $10 / $20, the recommended offer, response curves and local attribution, live. |
| **Experimentation UI** | `frontend/` (React 19, Vite, Tailwind v4, Plotly) | Ten-page dashboard with **Dawn** (warm paper, ink sidebar, editorial serif) and **Midnight** themes. Includes an animated pipeline flow, an animated Double ML residualisation explainer, a causal graph with particle flow and a back-door blocking toggle, an uplift quadrant map, a budget Sankey, live MILP re-solving, a ⌘K command palette and toasts. |

---

## 📊 Results (default run: 20,000 customers, seed 42)

| Metric | Naive | Double ML | Ground truth |
| :--- | :---: | :---: | :---: |
| Effect of $10 discount on P(purchase) | +6.0 pts | **+11.7 pts** | +10.0 pts |
| Effect of $20 discount on P(purchase) | +6.0 pts | **+19.1 pts** | +16.4 pts |

The naive estimate understates the $20 effect by about 69%, because marketing historically sent the largest coupons to lapsing customers.

**Budget allocation, $5,000 budget (profit measured against the oracle):**

| Strategy | True incremental profit |
| :--- | ---: |
| **Causal optimiser (MILP, λ = 1σ)** | **+$4,247** |
| Uplift ranking, $10 only | +$4,012 |
| Blanket $10 (random) | −$2,304 |
| Blanket $20 (random) | −$2,949 |
| Traditional ML (target highest purchase propensity) | −$4,518 |

**Audit and model quality:**
- The refutation battery passes 10/10 tests.
- Normalised Qini on the hold-out set is 80–90% of a perfect ranking.
- After IPW, covariate balance is max |SMD| ≤ 0.05.

---

## 🚀 Quick Start

### Prerequisites
- Python 3.10+ (tested on 3.13)
- Node.js 18+

### 1. Backend
```bash
git clone https://github.com/lakshanmuruganandam/EconoCausal-Dynamic-Pricing.git
cd EconoCausal-Dynamic-Pricing
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
.venv/bin/uvicorn backend.main:app --port 8000
```
On startup the default campaign is simulated and the full pipeline trains in the background (about 60 s). The refutation audit follows (about 30 s).
Interactive API docs: http://localhost:8000/docs

### 2. Frontend
```bash
cd frontend
npm install
npm run dev          # http://localhost:5173  (proxies /api → :8000)
```

### 3. Tests
```bash
.venv/bin/python -m pytest backend/tests -q
```
24 tests cover the SCM, balancing, Qini, MILP feasibility and optimality bounds, PSI, and every API endpoint end to end.

To try the engine on your own data, download the 1,000-row example from **Data Studio** (or `GET /api/data/template.csv`), edit it, and upload it back. The whole pipeline retrains on the uploaded campaign.

### 4. Refresh the static demo (GitHub Pages)
```bash
.venv/bin/python -m backend.export_static      # runs the pipeline, writes frontend/public/demo/*.json
git add frontend/public/demo && git commit -m "Refresh demo snapshot" && git push
```
Every push to `main` triggers `.github/workflows/deploy-pages.yml`. It builds the frontend with `VITE_DEMO=1` and deploys it to GitHub Pages. In demo mode, `src/demo/engine.ts` serves every API call: snapshotted JSON for read-only endpoints, and in-browser computation for the optimiser and the Lab.

---

## 🧭 Dashboard Tour

| Page | Week | Highlights |
| :--- | :---: | :--- |
| **Overview** | — | Animated live pipeline (click any stage), count-up KPIs, naive vs. IPW vs. PSM vs. DML vs. truth, narrative, model health |
| **What-If Lab** | — | Persona presets or a customer ID; sliders for every trait; three "parallel worlds"; decision card; response curve; "why this customer" attribution |
| **Data Studio** | 1 | Generate a synthetic campaign (size, seed, confounding strength) or upload a CSV. Feature explorer shows the targeting bias. |
| **Causal Graph** | 1 | Interactive SVG DAG. Particles flow along causal and back-door paths; the "Adjusted" toggle cuts the back-doors and animates the estimate from naive to DML. |
| **Propensity & Balance** | 1–2 | Love plot (raw / matched / IPW), propensity overlap, effective sample sizes |
| **Treatment Effects** | 2 | Animated "how Double ML works" explainer on real residuals, champion/challenger table, ITE distribution, CATE-vs-feature scatter, interpretable segment rules, linear coefficients with CIs |
| **Uplift & Segments** | 2 | IPW Qini curves (observed or oracle), decile calibration, uplift quadrant map, segment confusion matrix |
| **Causal Audit** | Mid | DoWhy refutation battery, PASS/FAIL per test |
| **Budget Optimizer** | 3 | Sliders for budget, margin and risk aversion re-solve the MILP live. Strategy comparison, profit frontier, budget Sankey and gauge, allocation matrix, CSV export. |
| **Drift Monitor** | 4 | Market-shift scenarios, PSI chart, KS table, predicted-uplift drift, retrain recommendation |

---

## 🔌 API Reference (selection)

| Method | Endpoint | Purpose |
| :--- | :--- | :--- |
| `GET` | `/api/status` | Pipeline progress and run metadata |
| `POST` | `/api/pipeline/run` | Re-run with `{n, seed, confounding, estimator, budget}` |
| `POST` | `/api/data/upload` | Run on your own CSV (`/api/data/template.csv` for the schema) |
| `GET` | `/api/causal/graph` · `/identification` · `/effects` · `/propensity` · `/refutation` | Causal inference outputs |
| `GET` | `/api/model/summary` · `/distribution` · `/scatter` · `/compare` | ITE model outputs |
| `GET` | `/api/uplift` | Qini, deciles, segments |
| `POST` | `/api/optimize` | Re-solve with `{budget, margin, objective, cost_basis, risk_aversion}` |
| `GET` | `/api/optimize/allocation` · `/allocation.csv` | Prescription table (filter / sort / paginate) and export |
| `POST` | `/api/drift` | Score a drifted batch `{scenario, n}` |
| `GET` | `/api/report` | Executive KPIs and narrative |
| `GET`/`POST` | `/api/lab/profile` · `/api/lab/predict` | What-If Lab: load a persona or customer, predict counterfactuals |
| `GET` | `/api/model/residuals` · `/api/optimize/flow` | DML explainer data · budget Sankey |

---

## 📁 Structure
```
EconoCausal-Dynamic-Pricing/
├── .github/workflows/       GitHub Pages deploy (static demo)
├── backend/
│   ├── main.py              FastAPI app (auto-runs the pipeline on startup)
│   ├── export_static.py     Snapshot every API response for the static demo
│   ├── config.py            All tunables
│   ├── causal/              data · dag · propensity · dml · uplift · optimizer · drift · narrative · engine
│   ├── api/                 routes_pipeline · routes_causal · routes_model · routes_optimize
│   └── tests/               test_causal.py · test_api.py
├── frontend/src/
│   ├── pages/               10 dashboard pages (incl. What-If Lab)
│   ├── components/          Shell, Plot (themed Plotly), animated diagrams, UI kit
│   ├── demo/engine.ts       In-browser API for the static demo (LP optimiser, Lab model)
│   └── api/                 typed client + useApi hook
└── docs/PROJECT_REPORT.md   Methodology & week-by-week report
```

See [`docs/PROJECT_REPORT.md`](docs/PROJECT_REPORT.md) for the methodology.
