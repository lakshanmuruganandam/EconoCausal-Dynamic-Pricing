"""
Data drift detection for the causal engine.

Causal effects estimated on last quarter's customers silently go stale when
the population changes. Every incoming scoring batch is compared with the
training reference using:

* Population Stability Index (PSI) on decile bins of the reference
* Two-sample Kolmogorov–Smirnov test (continuous features)
* Prediction drift: PSI of the predicted uplift distribution
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.stats import ks_2samp

from backend import config
from backend.causal.data import FEATURE_LABELS


def psi(ref: np.ndarray, cur: np.ndarray, bins: int = 10) -> float:
    edges = np.unique(np.quantile(ref, np.linspace(0, 1, bins + 1)))
    if len(edges) < 3:                                   # binary / near-constant feature
        cats = np.union1d(np.unique(ref), np.unique(cur))
        r = np.array([(ref == c).mean() for c in cats])
        c = np.array([(cur == c).mean() for c in cats])
    else:
        edges[0], edges[-1] = -np.inf, np.inf
        r = np.histogram(ref, edges)[0] / len(ref)
        c = np.histogram(cur, edges)[0] / len(cur)
    r, c = np.clip(r, 1e-4, None), np.clip(c, 1e-4, None)
    return float(np.sum((c - r) * np.log(c / r)))


def _level(value: float) -> str:
    if value >= config.PSI_ALERT:
        return "alert"
    if value >= config.PSI_WARN:
        return "warn"
    return "ok"


def detect(ref: pd.DataFrame, cur: pd.DataFrame, features: list[str],
           ref_pred: np.ndarray | None = None, cur_pred: np.ndarray | None = None) -> dict:
    rows = []
    for f in features:
        r, c = ref[f].values.astype(float), cur[f].values.astype(float)
        p = psi(r, c)
        binary = set(np.unique(r)) <= {0.0, 1.0}
        ks_p = None if binary else float(ks_2samp(r, c).pvalue)
        rows.append({
            "feature": f,
            "label": FEATURE_LABELS.get(f, f),
            "psi": p,
            "ks_pvalue": ks_p,
            "ref_mean": float(r.mean()),
            "cur_mean": float(c.mean()),
            "mean_shift": float((c.mean() - r.mean()) / (r.std() or 1.0)),
            "level": _level(p),
        })
    rows.sort(key=lambda x: -x["psi"])
    out = {"features": rows,
           "n_reference": len(ref), "n_current": len(cur),
           "drifted": [r["feature"] for r in rows if r["level"] == "alert"],
           "warnings": [r["feature"] for r in rows if r["level"] == "warn"]}
    if ref_pred is not None and cur_pred is not None:
        p = psi(ref_pred, cur_pred)
        bins = np.linspace(min(ref_pred.min(), cur_pred.min()), max(ref_pred.max(), cur_pred.max()), 41)
        out["prediction"] = {
            "psi": p, "level": _level(p),
            "ref_mean": float(ref_pred.mean()), "cur_mean": float(cur_pred.mean()),
            "bins": ((bins[:-1] + bins[1:]) / 2).round(4).tolist(),
            "ref_hist": (np.histogram(ref_pred, bins)[0] / len(ref_pred)).round(4).tolist(),
            "cur_hist": (np.histogram(cur_pred, bins)[0] / len(cur_pred)).round(4).tolist(),
        }
    worst = max([r["psi"] for r in rows] + [out.get("prediction", {}).get("psi", 0)])
    n_alert = len(out["drifted"]) + int(out.get("prediction", {}).get("level") == "alert")
    out["status"] = "alert" if n_alert else ("warn" if out["warnings"] or worst >= config.PSI_WARN else "ok")
    out["recommendation"] = {
        "alert": "Significant drift detected. Causal effects are likely stale – retrain the DML model on fresh campaign data before the next allocation.",
        "warn": "Moderate drift. Allocations remain usable but schedule a retrain and monitor the flagged features.",
        "ok": "Population is stable. The current causal model is safe to use for allocation.",
    }[out["status"]]
    return out
