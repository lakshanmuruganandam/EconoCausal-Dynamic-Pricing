"""
EconoCausal global configuration.

All tunables for the causal pipeline live here so the API, tests and the
offline CLI share one source of truth.
"""
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
ARTIFACT_DIR = BASE_DIR / "backend" / "artifacts"
ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)

API_TITLE = "EconoCausal API"
API_VERSION = "1.0.0"
CORS_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
]

# ── Dataset defaults ────────────────────────────────────────────────────────
DEFAULT_N_CUSTOMERS = 20_000
DEFAULT_SEED = 42
DEFAULT_CONFOUNDING = 1.0          # 0 = randomised trial, >1 = heavy targeting bias
TEST_FRACTION = 0.3

# Discount arms in dollars. 0 is always the control arm.
TREATMENT_LEVELS = [0, 10, 20]
TREATMENT_COL = "discount"
OUTCOME_COL = "purchased"

# ── Business economics ──────────────────────────────────────────────────────
GROSS_MARGIN = 0.40                # fraction of order value that is profit
DEFAULT_BUDGET = 5_000.0
RISK_AVERSION = 1.0                # plan on τ̂ − λ·σ̂ to avoid the winner's curse

# ── Model defaults ──────────────────────────────────────────────────────────
DEFAULT_ESTIMATOR = "auto"                 # champion/challenger across ESTIMATORS
ESTIMATORS = ["causal_forest", "linear_dml", "dr_learner"]
NUISANCE_ESTIMATORS = 150          # LightGBM boosting rounds for nuisance models
CV_FOLDS = 3                       # cross-fitting folds for DML

# ── Refutation ──────────────────────────────────────────────────────────────
REFUTER_SIMULATIONS = 10
REFUTER_SAMPLE = 4_000             # rows sampled for refutation tests (speed)

# ── Drift monitoring ────────────────────────────────────────────────────────
PSI_WARN = 0.10
PSI_ALERT = 0.25
KS_ALPHA = 0.01
