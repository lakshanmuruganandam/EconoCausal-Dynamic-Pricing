"""
Uplift evaluation: Qini curves, AUUC, decile calibration and segmentation.

Because the historical data is observational, a plain Qini curve would be
biased by the targeting policy. Every observed curve here is
inverse-propensity weighted, which turns the hold-out set into a
pseudo-randomised experiment. On synthetic data we additionally draw the
noise-free "true" curve from the oracle effects.
"""
from __future__ import annotations

import numpy as np

from backend.causal.data import SEGMENTS, true_segment

GRID = np.linspace(0, 1, 51)


def _ipw_gain(order: np.ndarray, y: np.ndarray, is_t: np.ndarray, e: np.ndarray) -> np.ndarray:
    """Incremental conversions from treating the top φ fraction in `order`, IPW-adjusted."""
    n = len(order)
    y_o, t_o, e_o = y[order], is_t[order], e[order]
    wt = np.where(t_o, 1 / e_o, 0.0)
    wc = np.where(~t_o, 1 / (1 - e_o), 0.0)
    cwt, cwc = np.cumsum(wt), np.cumsum(wc)
    cyt, cyc = np.cumsum(wt * y_o), np.cumsum(wc * y_o)
    gains = []
    for phi in GRID:
        k = int(round(phi * n))
        if k == 0 or cwt[k - 1] == 0 or cwc[k - 1] == 0:
            gains.append(0.0)
            continue
        gains.append((cyt[k - 1] / cwt[k - 1] - cyc[k - 1] / cwc[k - 1]) * k)
    return np.array(gains)


def _true_gain(order: np.ndarray, tau_true: np.ndarray) -> np.ndarray:
    c = np.concatenate([[0.0], np.cumsum(tau_true[order])])
    return np.array([c[int(round(phi * len(order)))] for phi in GRID])


def _area(curve: np.ndarray, baseline: np.ndarray, n: int) -> float:
    return float(np.trapezoid(curve - baseline, GRID) / max(n, 1))


def qini(arm: int, tau_hat: np.ndarray, response_score: np.ndarray, y: np.ndarray, t: np.ndarray,
         e_cond: np.ndarray, tau_true: np.ndarray | None = None) -> dict:
    """Qini analysis for one arm vs control on the hold-out set."""
    mask = (t == 0) | (t == arm)
    th, rs, ys, ts, es = tau_hat[mask], response_score[mask], y[mask], t[mask] == arm, e_cond[mask]
    n = int(mask.sum())

    by_model = np.argsort(-th)
    by_response = np.argsort(-rs)

    model = _ipw_gain(by_model, ys, ts, es)
    response = _ipw_gain(by_response, ys, ts, es)
    overall = model[-1]
    random = GRID * overall

    out = {
        "arm": arm,
        "n": n,
        "fraction": GRID.round(3).tolist(),
        "curves": {
            "causal_model": model.round(3).tolist(),
            "response_model": response.round(3).tolist(),
            "random": random.round(3).tolist(),
        },
        "qini_coefficient": _area(model, random, n),
        "qini_response": _area(response, random, n),
        "total_incremental": float(overall),
    }
    if tau_true is not None:
        tt = tau_true[mask]
        perfect = _true_gain(np.argsort(-tt), tt)
        true_model = _true_gain(by_model, tt)
        true_resp = _true_gain(by_response, tt)
        true_rand = GRID * tt.sum()
        out["true_curves"] = {
            "causal_model": true_model.round(3).tolist(),
            "response_model": true_resp.round(3).tolist(),
            "perfect": perfect.round(3).tolist(),
            "random": true_rand.round(3).tolist(),
        }
        denom = _area(perfect, true_rand, n) or 1e-9
        out["normalized_qini"] = _area(true_model, true_rand, n) / denom
        out["normalized_qini_response"] = _area(true_resp, true_rand, n) / denom
    return out


def deciles(arm: int, tau_hat: np.ndarray, y: np.ndarray, t: np.ndarray, e_cond: np.ndarray,
            tau_true: np.ndarray | None = None) -> list[dict]:
    """Predicted vs IPW-observed (vs true) uplift per decile of predicted effect."""
    mask = (t == 0) | (t == arm)
    th, ys, ts, es = tau_hat[mask], y[mask], t[mask] == arm, e_cond[mask]
    tt = tau_true[mask] if tau_true is not None else None
    edges = np.quantile(th, np.linspace(0, 1, 11))
    idx = np.clip(np.searchsorted(edges, th, side="right") - 1, 0, 9)
    rows = []
    for d in range(10):
        m = idx == d
        wt = np.where(ts[m], 1 / es[m], 0)
        wc = np.where(~ts[m], 1 / (1 - es[m]), 0)
        obs = None
        if wt.sum() > 0 and wc.sum() > 0:
            obs = float((wt * ys[m]).sum() / wt.sum() - (wc * ys[m]).sum() / wc.sum())
        rows.append({
            "decile": 10 - d,
            "predicted": float(th[m].mean()) if m.any() else 0.0,
            "observed": obs,
            "true": float(tt[m].mean()) if tt is not None and m.any() else None,
            "n": int(m.sum()),
        })
    return sorted(rows, key=lambda r: r["decile"])


def segment_customers(p0_hat: np.ndarray, tau_hat: np.ndarray) -> np.ndarray:
    return true_segment(p0_hat, tau_hat)


def segment_summary(seg_pred: np.ndarray, tau_hat: np.ndarray, p0_hat: np.ndarray,
                    seg_true: np.ndarray | None = None) -> dict:
    rows = []
    for s in SEGMENTS:
        m = seg_pred == s
        rows.append({
            "segment": s,
            "count": int(m.sum()),
            "share": float(m.mean()),
            "avg_uplift": float(tau_hat[m].mean()) if m.any() else 0.0,
            "avg_baseline": float(p0_hat[m].mean()) if m.any() else 0.0,
        })
    out = {"segments": rows}
    if seg_true is not None:
        matrix = [[int(((seg_true == a) & (seg_pred == b)).sum()) for b in SEGMENTS] for a in SEGMENTS]
        out["confusion"] = {"labels": SEGMENTS, "matrix": matrix,
                            "accuracy": float((seg_true == seg_pred).mean())}
    return out
