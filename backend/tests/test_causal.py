"""Unit tests for the causal building blocks."""
import numpy as np
import pandas as pd

from backend import config
from backend.causal import drift, optimizer, propensity, uplift
from backend.causal.data import FEATURES, SEGMENTS, generate_dataset, validate_upload


def test_dataset_schema_and_oracle(small_df):
    assert len(small_df) == 4000
    assert set(small_df[config.TREATMENT_COL].unique()) <= set(config.TREATMENT_LEVELS)
    assert set(small_df[config.OUTCOME_COL].unique()) <= {0, 1}
    assert np.allclose(small_df["true_ite_10"], small_df["true_p10"] - small_df["true_p0"])
    assert set(small_df["true_segment"].unique()) <= set(SEGMENTS)
    assert validate_upload(small_df) == []


def test_dataset_is_deterministic():
    a = generate_dataset(500, seed=3)
    b = generate_dataset(500, seed=3)
    pd.testing.assert_frame_equal(a, b)


def test_targeting_bias_makes_naive_estimate_wrong():
    df = generate_dataset(20_000, seed=5, confounding=1.5)
    naive = df.loc[df.discount == 20, "purchased"].mean() - df.loc[df.discount == 0, "purchased"].mean()
    assert df["true_ite_20"].mean() - naive > 0.05


def test_randomised_trial_removes_bias():
    df = generate_dataset(30_000, seed=5, confounding=0.0)
    naive = df.loc[df.discount == 10, "purchased"].mean() - df.loc[df.discount == 0, "purchased"].mean()
    assert abs(df["true_ite_10"].mean() - naive) < 0.03


def test_upload_validation_reports_problems(small_df):
    bad = small_df.drop(columns=["purchased"]).head(100)
    assert any("purchased" in p for p in validate_upload(bad))
    bad2 = small_df.copy()
    bad2.loc[0, "discount"] = 15
    assert any("discount" in p for p in validate_upload(bad2))


def test_ipw_improves_balance(small_df):
    X = small_df[FEATURES].astype(float)
    t = small_df.discount.values
    y = small_df.purchased.values
    proba, _ = propensity.fit_propensity(X, t)
    assert np.allclose(proba.sum(axis=1), 1)
    res = propensity.analyse_contrast(X, t, y, proba, 20)
    assert res["max_abs_smd_weighted"] < res["max_abs_smd_raw"]
    assert res["max_abs_smd_weighted"] < 0.1
    assert 0 < res["match_rate"] <= 1


def test_qini_perfect_ranking_beats_random(small_df):
    df = small_df
    t, y = df.discount.values, df.purchased.values
    e = np.full(len(df), 0.5)
    q = uplift.qini(10, df.true_ite_10.values, df.true_p0.values, y, t, e, df.true_ite_10.values)
    assert q["normalized_qini"] > 0.99
    assert len(q["fraction"]) == len(q["curves"]["causal_model"])


def test_milp_respects_budget_and_one_offer():
    rng = np.random.default_rng(0)
    n = 500
    p0 = rng.uniform(0.1, 0.6, n)
    tau = {10: rng.normal(0.08, 0.05, n), 20: rng.normal(0.12, 0.07, n)}
    aov = rng.uniform(30, 150, n)
    value, cost = optimizer.option_table(p0, tau, aov, 0.4)
    sol = optimizer.solve_milp(value, cost, budget=300)
    ch = sol["choice"]
    spend = sum(cost[i, ch[i] - 1] for i in range(n) if ch[i] > 0)
    assert spend <= 300 + 1e-6
    assert set(np.unique(ch)) <= {0, 1, 2}
    assert all(value[i, ch[i] - 1] > 0 for i in range(n) if ch[i] > 0)


def test_milp_matches_frontier_upper_bound():
    rng = np.random.default_rng(1)
    n = 300
    p0 = rng.uniform(0.1, 0.6, n)
    tau = {10: rng.normal(0.1, 0.05, n), 20: rng.normal(0.15, 0.06, n)}
    aov = rng.uniform(30, 150, n)
    value, cost = optimizer.option_table(p0, tau, aov, 0.4)
    sol = optimizer.solve_milp(value, cost, budget=200)
    milp_value = sum(value[i, c - 1] for i, c in enumerate(sol["choice"]) if c > 0)
    lp_bound = optimizer.frontier(value, cost, np.array([200.0]))[0]["value"]
    assert milp_value <= lp_bound + 1e-6
    assert milp_value >= 0.97 * lp_bound                 # LP relaxation is nearly tight


def test_psi_flags_shift_but_not_noise():
    rng = np.random.default_rng(0)
    ref = rng.normal(0, 1, 5000)
    assert drift.psi(ref, rng.normal(0, 1, 5000)) < config.PSI_WARN
    assert drift.psi(ref, rng.normal(0.8, 1, 5000)) > config.PSI_ALERT


def test_drift_scenarios(small_df):
    shifted = generate_dataset(4000, seed=99, scenario="price_war")
    res = drift.detect(small_df, shifted, FEATURES)
    assert res["status"] == "alert"
    assert "cart_abandons_90d" in res["drifted"]
    stable = drift.detect(small_df, generate_dataset(4000, seed=98), FEATURES)
    assert stable["status"] in {"ok", "warn"}
    assert not stable["drifted"]
