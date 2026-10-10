"""
Synthetic retail promotion dataset with known ground-truth causal effects.

Why synthetic?  Real observational campaign logs never reveal the
counterfactual ("would this customer have bought without the coupon?").
A structural causal model lets us (a) inject realistic targeting bias so the
naive estimate is wrong, and (b) keep the true individual treatment effects
hidden in `true_*` columns to audit every estimator against the oracle.

Structural causal model
-----------------------
    X  (customer covariates)  ──► T  (historical discount: $0 / $10 / $20)
    X  ──► Y  (purchase within 14 days)
    T  ──► Y

Marketing historically gave larger discounts to *lapsing* customers and cart
abandoners, who are exactly the people least likely to buy. Treatment
assignment therefore depends on X (confounding), and a naive
difference-in-means badly under-estimates the discount's effect.

Four latent behavioural segments emerge naturally from the effect function:
    Persuadables  – price sensitive, engaged: buy only because of a discount
    Sure Things   – loyal, frequent: buy anyway, discount is wasted
    Lost Causes   – dormant: won't buy regardless
    Sleeping Dogs – premium shoppers: a discount cheapens the brand (τ < 0)
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from backend import config

NUMERIC_FEATURES = [
    "age",
    "tenure_months",
    "recency_days",
    "frequency",
    "avg_order_value",
    "sessions_30d",
    "email_open_rate",
    "cart_abandons_90d",
    "loyalty_member",
    "mobile_user",
]
REGIONS = ["north", "south", "east", "west"]
REGION_FEATURES = [f"region_{r}" for r in REGIONS]
FEATURES = NUMERIC_FEATURES + REGION_FEATURES

FEATURE_LABELS = {
    "age": "Age",
    "tenure_months": "Tenure (months)",
    "recency_days": "Days since last order",
    "frequency": "Orders / year",
    "avg_order_value": "Avg order value ($)",
    "sessions_30d": "Sessions (30d)",
    "email_open_rate": "Email open rate",
    "cart_abandons_90d": "Cart abandons (90d)",
    "loyalty_member": "Loyalty member",
    "mobile_user": "Mobile user",
    "region_north": "Region: North",
    "region_south": "Region: South",
    "region_east": "Region: East",
    "region_west": "Region: West",
}

SEGMENTS = ["Persuadables", "Sure Things", "Lost Causes", "Sleeping Dogs"]


def _sigmoid(x: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-x))


def _z(x: np.ndarray, mu: float, sd: float) -> np.ndarray:
    return (x - mu) / sd


@dataclass
class Shift:
    """Population shift applied when generating a drifted scoring batch."""

    age: float = 0.0
    recency_mult: float = 1.0
    frequency_mult: float = 1.0
    aov_mult: float = 1.0
    sessions_mult: float = 1.0
    email_delta: float = 0.0
    cart_mult: float = 1.0
    mobile_delta: float = 0.0
    loyalty_delta: float = 0.0
    region_probs: list[float] = field(default_factory=lambda: [0.3, 0.25, 0.25, 0.2])


DRIFT_SCENARIOS: dict[str, dict] = {
    "stable": {
        "label": "Stable market",
        "description": "Same customer population as training. No alerts expected.",
        "shift": Shift(),
    },
    "price_war": {
        "label": "Competitor price war",
        "description": "A rival slashes prices: basket sizes shrink and cart abandonment spikes.",
        "shift": Shift(aov_mult=0.72, cart_mult=1.9, sessions_mult=1.15),
    },
    "churn_wave": {
        "label": "Churn wave",
        "description": "Customers go quiet: longer gaps between orders and falling email engagement.",
        "shift": Shift(recency_mult=1.8, frequency_mult=0.7, email_delta=-0.12),
    },
    "new_market": {
        "label": "New market launch",
        "description": "Expansion brings younger, mobile-first customers from a new region mix.",
        "shift": Shift(age=-9, mobile_delta=0.25, loyalty_delta=-0.2,
                       region_probs=[0.1, 0.15, 0.25, 0.5]),
    },
}


def _covariates(n: int, rng: np.random.Generator, s: Shift) -> pd.DataFrame:
    age = np.clip(rng.normal(41 + s.age, 12, n), 18, 80).round()
    tenure = np.clip(rng.gamma(2.0, 14.0, n), 1, 144).round()
    recency = np.clip(rng.exponential(55 * s.recency_mult, n), 1, 365).round()
    frequency = rng.poisson(np.clip(6.0 * s.frequency_mult * np.exp(-recency / 300), 0.3, None)).astype(float)
    aov = np.clip(rng.lognormal(np.log(62 * s.aov_mult), 0.45, n), 8, 600).round(2)
    sessions = rng.poisson(9 * s.sessions_mult * np.exp(-recency / 160)).astype(float)
    email = np.clip(rng.beta(2.2, 4.5, n) + s.email_delta, 0, 1).round(3)
    cart = rng.poisson(1.2 * s.cart_mult + 0.08 * sessions).astype(float)
    loyalty = (rng.random(n) < np.clip(_sigmoid(-1.4 + tenure / 30 + frequency / 8) + s.loyalty_delta, 0, 1)).astype(float)
    mobile = (rng.random(n) < np.clip(0.75 - (age - 18) / 110 + s.mobile_delta, 0.05, 0.98)).astype(float)
    region = rng.choice(REGIONS, size=n, p=s.region_probs)

    df = pd.DataFrame({
        "age": age,
        "tenure_months": tenure,
        "recency_days": recency,
        "frequency": frequency,
        "avg_order_value": aov,
        "sessions_30d": sessions,
        "email_open_rate": email,
        "cart_abandons_90d": cart,
        "loyalty_member": loyalty,
        "mobile_user": mobile,
    })
    for r in REGIONS:
        df[f"region_{r}"] = (region == r).astype(float)
    return df


def _potential_outcomes(df: pd.DataFrame, rng: np.random.Generator) -> dict[str, np.ndarray]:
    """Return true purchase probabilities under each discount arm."""
    rec_z = _z(df["recency_days"].values, 55, 50)
    freq_z = _z(df["frequency"].values, 5, 3)
    sess_z = _z(df["sessions_30d"].values, 6, 4)
    aov = df["avg_order_value"].values
    email = df["email_open_rate"].values
    loyalty = df["loyalty_member"].values
    cart = df["cart_abandons_90d"].values
    age = df["age"].values

    # Baseline purchase propensity without any discount
    base_logit = (-1.25 + 0.75 * freq_z + 2.2 * (email - 0.33) - 0.65 * rec_z
                  + 0.55 * loyalty + 0.25 * sess_z + 0.15 * df["region_west"].values)
    p0 = _sigmoid(base_logit)

    # Latent price sensitivity: mostly explained by observables + idiosyncratic noise
    sens = _sigmoid(-0.4 + 0.55 * cart - 0.012 * (aov - 62) - 0.9 * loyalty
                    - 0.025 * (age - 41) + 0.35 * df["mobile_user"].values
                    + rng.normal(0, 0.35, len(df)))
    active = _sigmoid(9 * (email - 0.12))                       # dormant users ignore offers
    premium = _sigmoid((aov - 110) / 18) * (0.4 + 0.6 * loyalty)  # brand-sensitive shoppers

    tau10 = 0.60 * sens ** 1.8 * active * (1 - p0) - 0.10 * premium
    tau20 = tau10 * (1.45 + 0.35 * sens) - 0.05 * premium       # diminishing returns

    p10 = np.clip(p0 + tau10, 0.001, 0.999)
    p20 = np.clip(p0 + tau20, 0.001, 0.999)
    return {"p0": p0, "p10": p10, "p20": p20, "sensitivity": sens}


def _assign_treatment(df: pd.DataFrame, rng: np.random.Generator, gamma: float) -> np.ndarray:
    """Historical (biased) marketing policy. gamma scales the targeting bias."""
    rec_z = _z(df["recency_days"].values, 55, 50)
    freq_z = _z(df["frequency"].values, 5, 3)
    cart_z = _z(df["cart_abandons_90d"].values, 1.7, 1.4)
    loyalty = df["loyalty_member"].values

    logits = np.column_stack([
        np.zeros(len(df)),
        -0.35 + gamma * (0.7 * rec_z + 0.6 * loyalty + 0.45 * cart_z),
        -1.0 + gamma * (1.3 * rec_z + 0.8 * cart_z - 0.6 * freq_z),
    ])
    probs = np.exp(logits - logits.max(axis=1, keepdims=True))
    probs /= probs.sum(axis=1, keepdims=True)
    u = rng.random(len(df))[:, None]
    arm = (u > probs.cumsum(axis=1)).sum(axis=1)
    return np.array(config.TREATMENT_LEVELS)[arm]


def true_segment(p0: np.ndarray, tau: np.ndarray) -> np.ndarray:
    """Label each customer with the classic uplift quadrant from p(Y|T=0) and τ."""
    seg = np.where(tau < -0.01, "Sleeping Dogs",
          np.where(tau >= 0.07, "Persuadables",
          np.where(p0 >= 0.45, "Sure Things", "Lost Causes")))
    return seg


def generate_dataset(
    n: int = config.DEFAULT_N_CUSTOMERS,
    seed: int = config.DEFAULT_SEED,
    confounding: float = config.DEFAULT_CONFOUNDING,
    scenario: str = "stable",
) -> pd.DataFrame:
    """
    Generate a historical campaign log.

    Observed columns: customer_id, FEATURES, discount, purchased, order_value.
    Oracle columns (hidden from models): true_p0/10/20, true_ite_10/20, true_segment.
    """
    rng = np.random.default_rng(seed)
    shift = DRIFT_SCENARIOS.get(scenario, DRIFT_SCENARIOS["stable"])["shift"]
    df = _covariates(n, rng, shift)
    po = _potential_outcomes(df, rng)
    t = _assign_treatment(df, rng, confounding)

    p_obs = np.select([t == 0, t == 10, t == 20], [po["p0"], po["p10"], po["p20"]])
    y = (rng.random(n) < p_obs).astype(int)

    df.insert(0, "customer_id", [f"C{seed % 1000:03d}-{i:06d}" for i in range(n)])
    df[config.TREATMENT_COL] = t
    df[config.OUTCOME_COL] = y
    df["order_value"] = np.where(y == 1, (df["avg_order_value"] * rng.lognormal(0, 0.15, n)).round(2), 0.0)

    df["true_p0"] = po["p0"]
    df["true_p10"] = po["p10"]
    df["true_p20"] = po["p20"]
    df["true_ite_10"] = po["p10"] - po["p0"]
    df["true_ite_20"] = po["p20"] - po["p0"]
    df["true_segment"] = true_segment(po["p0"], df["true_ite_10"].values)
    return df


def has_oracle(df: pd.DataFrame) -> bool:
    return {"true_ite_10", "true_ite_20", "true_p0"}.issubset(df.columns)


def validate_upload(df: pd.DataFrame) -> list[str]:
    """Return a list of human-readable schema problems (empty list = valid)."""
    problems = []
    for col in [config.TREATMENT_COL, config.OUTCOME_COL]:
        if col not in df.columns:
            problems.append(f"missing required column '{col}'")
    if problems:
        return problems
    bad_t = set(pd.unique(df[config.TREATMENT_COL])) - set(config.TREATMENT_LEVELS)
    if bad_t:
        problems.append(f"'{config.TREATMENT_COL}' must only contain {config.TREATMENT_LEVELS}; found {sorted(bad_t)}")
    if not set(pd.unique(df[config.OUTCOME_COL])).issubset({0, 1}):
        problems.append(f"'{config.OUTCOME_COL}' must be binary 0/1")
    missing = [f for f in FEATURES if f not in df.columns]
    if missing:
        problems.append(f"missing feature columns: {', '.join(missing)}")
    if len(df) < 500:
        problems.append("need at least 500 rows for reliable causal estimation")
    return problems
