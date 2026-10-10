"""
Propensity modelling, overlap diagnostics and covariate balancing.

The historical campaign was *not* randomised, so treated and control
customers differ systematically. This module estimates the generalised
propensity score e_k(x) = P(T = k | X = x) for every discount arm and uses it
to make observational data behave like an A/B test:

* Inverse probability weighting (IPW / Hajek estimator)
* 1:1 nearest-neighbour propensity score matching with a caliper
* Standardised mean difference (SMD) "love plot" before / after adjustment
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.neighbors import NearestNeighbors
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from backend import config

CLIP = 0.01


def fit_propensity(X: pd.DataFrame, t: np.ndarray) -> tuple[np.ndarray, object]:
    """Multinomial logistic generalised propensity score. Returns (n, k) matrix."""
    model = make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000, C=1.0))
    model.fit(X.values, t)
    proba = model.predict_proba(X.values)
    order = [list(model.classes_).index(k) for k in config.TREATMENT_LEVELS]
    proba = np.clip(proba[:, order], CLIP, 1 - CLIP)
    proba /= proba.sum(axis=1, keepdims=True)
    return proba, model


def _smd(x_t: np.ndarray, x_c: np.ndarray, w_t=None, w_c=None) -> float:
    m_t = np.average(x_t, weights=w_t)
    m_c = np.average(x_c, weights=w_c)
    v_t = np.average((x_t - m_t) ** 2, weights=w_t)
    v_c = np.average((x_c - m_c) ** 2, weights=w_c)
    denom = np.sqrt((v_t + v_c) / 2)
    return float((m_t - m_c) / denom) if denom > 1e-12 else 0.0


def _match(e_cond: np.ndarray, is_t: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """1:1 nearest neighbour matching (with replacement) on the logit propensity."""
    logit = np.log(e_cond / (1 - e_cond))
    caliper = 0.2 * logit.std()
    t_idx = np.where(is_t)[0]
    c_idx = np.where(~is_t)[0]
    nn = NearestNeighbors(n_neighbors=1).fit(logit[c_idx, None])
    dist, pos = nn.kneighbors(logit[t_idx, None])
    keep = dist[:, 0] <= caliper
    return t_idx[keep], c_idx[pos[keep, 0]]


def analyse_contrast(X: pd.DataFrame, t: np.ndarray, y: np.ndarray, proba: np.ndarray, arm: int) -> dict:
    """Balance + effect diagnostics for one treatment arm against control."""
    k = config.TREATMENT_LEVELS.index(arm)
    mask = (t == 0) | (t == arm)
    Xs, ts, ys = X[mask], t[mask], y[mask]
    is_t = ts == arm
    # Conditional propensity of receiving `arm` given the unit is in {0, arm}
    e = proba[mask, k] / (proba[mask, k] + proba[mask, 0])
    e = np.clip(e, CLIP, 1 - CLIP)

    w = np.where(is_t, 1 / e, 1 / (1 - e))
    t_m, c_m = _match(e, is_t)

    balance = []
    for col in X.columns:
        v = Xs[col].values
        if v.std() == 0:
            continue
        balance.append({
            "feature": col,
            "raw": _smd(v[is_t], v[~is_t]),
            "weighted": _smd(v[is_t], v[~is_t], w[is_t], w[~is_t]),
            "matched": _smd(v[t_m], v[c_m]) if len(t_m) > 10 else None,
        })

    naive = float(ys[is_t].mean() - ys[~is_t].mean())
    ipw = float(np.average(ys[is_t], weights=w[is_t]) - np.average(ys[~is_t], weights=w[~is_t]))
    att = float((ys[t_m] - ys[c_m]).mean()) if len(t_m) else float("nan")

    bins = np.linspace(0, 1, 41)
    hist_t, _ = np.histogram(e[is_t], bins=bins, density=True)
    hist_c, _ = np.histogram(e[~is_t], bins=bins, density=True)
    ess_t = w[is_t].sum() ** 2 / (w[is_t] ** 2).sum()
    ess_c = w[~is_t].sum() ** 2 / (w[~is_t] ** 2).sum()

    return {
        "arm": arm,
        "n_treated": int(is_t.sum()),
        "n_control": int((~is_t).sum()),
        "n_matched": int(len(t_m)),
        "match_rate": float(len(t_m) / max(is_t.sum(), 1)),
        "naive_effect": naive,
        "ipw_effect": ipw,
        "psm_att": att,
        "effective_sample_size": {"treated": float(ess_t), "control": float(ess_c)},
        "overlap": {
            "bins": ((bins[:-1] + bins[1:]) / 2).round(4).tolist(),
            "treated": hist_t.round(4).tolist(),
            "control": hist_c.round(4).tolist(),
            "share_extreme": float(((e < 0.05) | (e > 0.95)).mean()),
        },
        "balance": balance,
        "max_abs_smd_raw": float(max(abs(b["raw"]) for b in balance)),
        "max_abs_smd_weighted": float(max(abs(b["weighted"]) for b in balance)),
    }
