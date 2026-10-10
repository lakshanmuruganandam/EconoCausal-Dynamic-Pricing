"""
Interactive endpoints: the counterfactual What-If Lab, the Double ML
residualisation explainer and the budget flow (Sankey) data.
"""
import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sklearn.model_selection import cross_val_predict

from backend import config
from backend.api.deps import state_or_409
from backend.causal import dml, optimizer, uplift
from backend.causal.data import FEATURE_LABELS, FEATURES, NUMERIC_FEATURES, REGIONS, SEGMENTS
from backend.causal.engine import State, _sigma

router = APIRouter(prefix="/api", tags=["lab"])


# ── What-If Lab ─────────────────────────────────────────────────────────────
def _feature_meta(st: State) -> list[dict]:
    meta = []
    for f in NUMERIC_FEATURES:
        v = st.X[f].values
        binary = set(np.unique(v)) <= {0.0, 1.0}
        lo, hi = (0.0, 1.0) if binary else (float(np.quantile(v, 0.005)), float(np.quantile(v, 0.995)))
        step = 1.0 if binary or f in {"age", "tenure_months", "recency_days", "frequency", "sessions_30d",
                                      "cart_abandons_90d"} else (0.01 if f == "email_open_rate" else 1.0)
        meta.append({"feature": f, "label": FEATURE_LABELS[f], "min": round(lo, 2), "max": round(hi, 2),
                     "step": step, "binary": binary, "median": float(np.median(v))})
    return meta


def _profile_from_row(row: pd.Series) -> dict:
    prof = {f: float(row[f]) for f in NUMERIC_FEATURES}
    prof["region"] = next((r for r in REGIONS if row.get(f"region_{r}", 0) == 1), "north")
    return prof


def _to_frame(profiles: list[dict]) -> pd.DataFrame:
    rows = []
    for p in profiles:
        r = {f: float(p[f]) for f in NUMERIC_FEATURES}
        for reg in REGIONS:
            r[f"region_{reg}"] = 1.0 if p.get("region") == reg else 0.0
        rows.append(r)
    return pd.DataFrame(rows)[FEATURES]


@router.get("/lab/profile")
def lab_profile(customer_id: str | None = None, persona: str | None = None, seed: int | None = None):
    """Return a starting profile: a named customer, a segment persona, or a random customer."""
    st = state_or_409()
    df = st.df
    if customer_id:
        hit = df.index[df["customer_id"] == customer_id]
        if not len(hit):
            raise HTTPException(404, f"customer '{customer_id}' not found")
        i = int(hit[0])
    elif persona in SEGMENTS:
        idx = np.where(st.segments == persona)[0]
        if not len(idx):
            raise HTTPException(404, f"no {persona} in this run")
        # Persuadables: a typical *targeted* member (median expected profit among those the
        # optimiser chose); other segments: the member closest to the median uplift.
        targeted = idx[st.optimisation["choice"][idx] > 0] if persona == "Persuadables" else idx[:0]
        if len(targeted):
            rows = np.arange(len(st.df))[targeted]
            prof = st.optimisation["value"][rows, st.optimisation["choice"][targeted] - 1]
            i = int(targeted[np.argmin(np.abs(prof - np.median(prof)))])
        else:
            tau = st.cate.ite[10][idx]
            i = int(idx[np.argmin(np.abs(tau - np.median(tau)))])
    else:
        i = int(np.random.default_rng(seed).integers(len(df)))
    row = df.iloc[i]
    return {"customer_id": row["customer_id"], "profile": _profile_from_row(row),
            "segment": str(st.segments[i]), "features": _feature_meta(st), "regions": REGIONS,
            "actual": {"discount": int(row[config.TREATMENT_COL]), "purchased": int(row[config.OUTCOME_COL])}}


class PredictRequest(BaseModel):
    profile: dict
    sweep: str = Field("cart_abandons_90d", description="Feature to sweep for the response curve")
    margin: float = Field(config.GROSS_MARGIN, gt=0, le=1)
    risk_aversion: float = Field(config.RISK_AVERSION, ge=0, le=3)


@router.post("/lab/predict")
def lab_predict(req: PredictRequest):
    st = state_or_409()
    missing = [f for f in NUMERIC_FEATURES if f not in req.profile]
    if missing:
        raise HTTPException(422, f"profile missing: {missing}")
    if req.sweep not in NUMERIC_FEATURES:
        raise HTTPException(422, f"unknown sweep feature '{req.sweep}'")
    est = st.cate.estimator
    base = dict(req.profile)

    # 1. point prediction with intervals
    X0 = _to_frame([base])
    p0 = float(st.p0_model.predict(X0)[0])
    arms = {}
    for arm in dml.ARMS:
        tau = float(np.ravel(est.effect(X0.values, T0=0, T1=arm))[0])
        try:
            lo, hi = (float(np.ravel(v)[0]) for v in est.effect_interval(X0.values, T0=0, T1=arm, alpha=0.05))
        except Exception:
            lo = hi = tau
        arms[arm] = {"tau": tau, "lower": lo, "upper": hi, "p_with": float(np.clip(p0 + tau, 0, 1))}

    # 2. economics + recommendation (same objective as the MILP, one customer)
    tau_d = {a: np.array([arms[a]["tau"]]) for a in dml.ARMS}
    sig = {a: np.array([(arms[a]["upper"] - arms[a]["lower"]) / 3.92]) for a in dml.ARMS}
    aov = np.array([base["avg_order_value"]])
    value, cost = optimizer.option_table(np.array([p0]), tau_d, aov, req.margin)
    robust = {a: tau_d[a] - req.risk_aversion * sig[a] for a in dml.ARMS}
    plan_value, _ = optimizer.option_table(np.array([p0]), robust, aov, req.margin)
    best = int(np.argmax(plan_value[0])) if plan_value[0].max() > 0 else -1
    for j, arm in enumerate(dml.ARMS):
        arms[arm].update({"expected_profit": float(value[0, j]), "expected_cost": float(cost[0, j]),
                          "risk_adjusted_profit": float(plan_value[0, j])})

    # 3. response curve: sweep one feature across its range
    meta = {m["feature"]: m for m in _feature_meta(st)}
    m = meta[req.sweep]
    grid = np.array([0.0, 1.0]) if m["binary"] else np.linspace(m["min"], m["max"], 30)
    profiles = [{**base, req.sweep: float(g)} for g in grid]
    Xs = _to_frame(profiles)
    curve = {"x": grid.round(3).tolist(), "p0": st.p0_model.predict(Xs).round(4).tolist()}
    for arm in dml.ARMS:
        curve[str(arm)] = np.ravel(est.effect(Xs.values, T0=0, T1=arm)).round(4).tolist()

    # 4. local attribution: how much of τ($10) each feature explains vs the median customer
    contrib = []
    profiles = []
    for f in NUMERIC_FEATURES:
        profiles.append({**base, f: meta[f]["median"]})
    Xa = _to_frame(profiles)
    tau_med = np.ravel(est.effect(Xa.values, T0=0, T1=10))
    for f, tm in zip(NUMERIC_FEATURES, tau_med):
        contrib.append({"feature": f, "label": FEATURE_LABELS[f], "value": float(base[f]),
                        "median": meta[f]["median"], "delta": float(arms[10]["tau"] - tm)})
    contrib.sort(key=lambda r: -abs(r["delta"]))

    seg = str(uplift.segment_customers(np.array([p0]), np.array([arms[10]["tau"]]))[0])
    pct = float((st.cate.ite[10] < arms[10]["tau"]).mean())
    return {
        "p0": p0, "arms": {str(k): v for k, v in arms.items()},
        "recommendation": 0 if best < 0 else dml.ARMS[best], "segment": seg,
        "uplift_percentile": pct, "curve": curve, "sweep": req.sweep, "sweep_label": m["label"],
        "attribution": contrib, "model": st.cate.name,
    }


# ── DML explainer ───────────────────────────────────────────────────────────
@router.get("/model/residuals")
def residuals(arm: int = 10, n: int = Query(450, ge=100, le=2000)):
    """
    Sample data for the animated 'how Double ML works' diagram:
    raw (T, Y) → residualised (T − ê(X), Y − m̂(X)) with cross-fitted LightGBM.
    """
    st = state_or_409()
    if arm not in dml.ARMS:
        raise HTTPException(422, "unknown arm")
    key = ("residuals", arm)
    if key not in st.cache:
        mask = np.isin(st.t, [0, arm])
        X, t, y = st.X[mask].values, (st.t[mask] == arm).astype(float), st.y[mask].astype(float)
        m_hat = cross_val_predict(dml._lgbm_reg(0), X, y, cv=3)
        e_hat = cross_val_predict(dml._lgbm_clf(0), X, t.astype(int), cv=3, method="predict_proba")[:, 1]
        e_hat = np.clip(e_hat, 0.01, 0.99)
        y_res, t_res = y - m_hat, t - e_hat
        theta = float((t_res * y_res).sum() / (t_res ** 2).sum())
        naive = float(y[t == 1].mean() - y[t == 0].mean())
        rng = np.random.default_rng(1)
        idx = rng.choice(len(y), size=min(2000, len(y)), replace=False)
        rec = st.df["recency_days"].values[mask]
        st.cache[key] = {"t": t[idx], "y": y[idx], "m": m_hat[idx], "e": e_hat[idx], "t_res": t_res[idx],
                         "y_res": y_res[idx], "recency": rec[idx], "theta": theta, "naive": naive,
                         "n_total": int(mask.sum())}
    c = st.cache[key]
    k = slice(0, n)
    rng = np.random.default_rng(2)
    jit_t = rng.uniform(-0.18, 0.18, n)
    jit_y = rng.uniform(-0.18, 0.18, n)
    return {
        "arm": arm, "theta": c["theta"], "naive": c["naive"], "n_total": c["n_total"],
        "dml_ate": st.cate.ate[arm]["value"],
        "points": {
            "t": c["t"][k].round(3).tolist(), "y": c["y"][k].round(3).tolist(),
            "jt": jit_t.round(3).tolist(), "jy": jit_y.round(3).tolist(),
            "m": c["m"][k].round(4).tolist(), "e": c["e"][k].round(4).tolist(),
            "t_res": c["t_res"][k].round(4).tolist(), "y_res": c["y_res"][k].round(4).tolist(),
            "recency": c["recency"][k].round(1).tolist(),
        },
    }


# ── Budget flow (Sankey) ────────────────────────────────────────────────────
@router.get("/optimize/flow")
def flow():
    st = state_or_409()
    o = st.optimisation
    choice = o["choice"]
    offers = ["No offer", "$10 offer", "$20 offer"]
    links = []
    rows = np.arange(len(choice))
    j = np.maximum(choice - 1, 0)
    spend = np.where(choice > 0, o["cost"][rows, j], 0.0)
    profit = np.where(choice > 0, o["value"][rows, j], 0.0)
    for s in SEGMENTS:
        for k, off in enumerate(offers):
            m = (st.segments == s) & (choice == k)
            if m.sum():
                links.append({"source": s, "target": off, "customers": int(m.sum()),
                              "spend": float(spend[m].sum()), "profit": float(profit[m].sum())})
    seg_counts = {s: int((st.segments == s).sum()) for s in SEGMENTS}
    return {"segments": SEGMENTS, "offers": offers, "links": links, "segment_counts": seg_counts,
            "budget": st.opt_params["budget"], "spend": float(spend.sum()), "profit": float(profit.sum()),
            "sigma_mean": {str(a): float(_sigma(st.cate)[a].mean()) for a in dml.ARMS}}
