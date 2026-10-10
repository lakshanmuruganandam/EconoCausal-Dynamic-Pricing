"""Individual treatment effect model, uplift evaluation and model comparison."""
import numpy as np
from fastapi import APIRouter, HTTPException, Query

from backend.api.deps import state_or_409
from backend.causal import dml
from backend.causal.data import FEATURE_LABELS, FEATURES
from backend.causal.engine import engine

router = APIRouter(prefix="/api", tags=["model"])


@router.get("/model/summary")
def model_summary():
    st = state_or_409()
    c = st.cate
    out = {
        "estimator": c.name, **dml.ESTIMATOR_INFO[c.name], "fit_seconds": c.fit_seconds,
        "ate": {str(k): v for k, v in c.ate.items()},
        "importance": c.importance, "coefficients": c.coefficients,
        "rules": {str(arm): dml.cate_rules(st.X, c.ite[arm]) for arm in dml.ARMS},
        "oracle": None,
    }
    if st.oracle:
        ti = st.test_idx
        out["oracle"] = {str(arm): dml.oracle_metrics(c.ite[arm][ti], st.df[f"true_ite_{arm}"].values[ti],
                                                      c.lower[arm][ti], c.upper[arm][ti]) for arm in dml.ARMS}
    return out


@router.get("/model/distribution")
def ite_distribution():
    st = state_or_409()
    allv = np.concatenate([st.cate.ite[a] for a in dml.ARMS])
    edges = np.linspace(np.quantile(allv, 0.002), np.quantile(allv, 0.998), 51)
    out = {"bins": ((edges[:-1] + edges[1:]) / 2).round(4).tolist(), "arms": {}}
    for arm in dml.ARMS:
        tau = st.cate.ite[arm]
        sig = (st.cate.lower[arm] > 0).mean()
        out["arms"][str(arm)] = {
            "hist": np.histogram(np.clip(tau, edges[0], edges[-1]), edges)[0].tolist(),
            "mean": float(tau.mean()), "median": float(np.median(tau)),
            "p10": float(np.quantile(tau, 0.1)), "p90": float(np.quantile(tau, 0.9)),
            "share_positive": float((tau > 0).mean()), "share_significant": float(sig),
            "share_negative": float((st.cate.upper[arm] < 0).mean()),
        }
    return out


@router.get("/model/scatter")
def ite_scatter(feature: str = Query("cart_abandons_90d"), arm: int = 10, n: int = Query(1500, le=5000)):
    st = state_or_409()
    if feature not in FEATURES or arm not in dml.ARMS:
        raise HTTPException(422, "unknown feature or arm")
    rng = np.random.default_rng(0)
    idx = rng.choice(len(st.df), size=min(n, len(st.df)), replace=False)
    out = {"feature": feature, "label": FEATURE_LABELS[feature], "arm": arm,
           "x": st.X[feature].values[idx].round(3).tolist(),
           "ite": st.cate.ite[arm][idx].round(4).tolist(),
           "lower": st.cate.lower[arm][idx].round(4).tolist(),
           "upper": st.cate.upper[arm][idx].round(4).tolist(),
           "segment": st.segments[idx].tolist(),
           "p0": st.p0_hat[idx].round(4).tolist()}
    if st.oracle:
        out["true"] = st.df[f"true_ite_{arm}"].values[idx].round(4).tolist()
    return out


@router.get("/model/compare")
def compare():
    st = state_or_409()
    return {"status": engine.status["comparison"], "result": st.comparison, "active": st.cate.name}


@router.post("/model/compare", status_code=202)
def run_compare():
    state_or_409()
    if engine.status["comparison"] == "running":
        raise HTTPException(409, "comparison already running")
    engine.run_comparison(background=True)
    return {"accepted": True}


@router.get("/uplift")
def uplift():
    st = state_or_409()
    return {"arms": {str(k): v for k, v in st.uplift["arms"].items()},
            "deciles": {str(k): v for k, v in st.uplift["deciles"].items()},
            "segments": st.uplift["segments"], "oracle": st.oracle}
