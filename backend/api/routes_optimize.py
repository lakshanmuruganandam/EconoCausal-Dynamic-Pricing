"""Budget optimisation, prescription table, drift monitoring and executive report."""
import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from backend import config
from backend.api.deps import state_or_409
from backend.api.schemas import DriftRequest, OptimiseRequest
from backend.causal import narrative
from backend.causal.data import DRIFT_SCENARIOS
from backend.causal.engine import State, engine

router = APIRouter(prefix="/api", tags=["optimise"])


def _opt_payload(st: State) -> dict:
    o = st.optimisation
    return {
        "params": st.opt_params, "status": o["status"], "solve_seconds": o["solve_seconds"],
        "candidates": o["candidates"], "strategies": o["strategies"], "frontier": o["frontier"],
        "narrative": narrative.optimiser_story(o["strategies"], st.opt_params["budget"], st.uplift["segments"]),
        "oracle": st.oracle,
    }


@router.get("/optimize")
def get_optimisation():
    return _opt_payload(state_or_409())


@router.post("/optimize")
def optimise(req: OptimiseRequest):
    st = state_or_409()
    engine.reoptimise(**req.model_dump())
    return _opt_payload(st)


def _allocation_frame(st: State) -> pd.DataFrame:
    o = st.optimisation
    choice = o["choice"]
    rows = np.arange(len(choice))
    j = np.maximum(choice - 1, 0)
    treated = choice > 0
    arms = np.array(config.TREATMENT_LEVELS)
    ite = np.column_stack([st.cate.ite[10], st.cate.ite[20]])
    lo = np.column_stack([st.cate.lower[10], st.cate.lower[20]])
    best_arm = np.where(ite[:, 1] > ite[:, 0], 20, 10)
    return pd.DataFrame({
        "customer_id": st.df["customer_id"].values,
        "segment": st.segments,
        "discount": arms[choice],
        "baseline_prob": st.p0_hat,
        "uplift_10": st.cate.ite[10],
        "uplift_20": st.cate.ite[20],
        "uplift": np.where(treated, ite[rows, j], ite[rows, (best_arm == 20).astype(int)]),
        "uplift_lower": np.where(treated, lo[rows, j], np.nan),
        "expected_cost": np.where(treated, o["cost"][rows, j], 0.0),
        "expected_profit": np.where(treated, o["value"][rows, j], 0.0),
        "avg_order_value": st.df["avg_order_value"].values,
    })


@router.get("/optimize/allocation")
def allocation(page: int = Query(1, ge=1), size: int = Query(25, ge=5, le=200), search: str = "",
               discount: str = "all", segment: str = "all", sort: str = "expected_profit", order: str = "desc"):
    st = state_or_409()
    df = _allocation_frame(st)
    if search:
        df = df[df["customer_id"].str.contains(search, case=False, regex=False)]
    if discount != "all":
        df = df[df["discount"] == int(discount)]
    if segment != "all":
        df = df[df["segment"] == segment]
    if sort not in df.columns:
        raise HTTPException(422, f"cannot sort by {sort}")
    df = df.sort_values(sort, ascending=order == "asc", na_position="last")
    total = len(df)
    chunk = df.iloc[(page - 1) * size: page * size]
    return {"total": total, "page": page, "size": size,
            "rows": chunk.round(4).replace({np.nan: None}).to_dict(orient="records")}


@router.get("/optimize/allocation.csv")
def allocation_csv():
    st = state_or_409()
    df = _allocation_frame(st)
    df = df[df["discount"] > 0].sort_values("expected_profit", ascending=False)
    return Response(df.round(5).to_csv(index=False), media_type="text/csv",
                    headers={"Content-Disposition": "attachment; filename=econocausal_prescription.csv"})


@router.get("/drift/scenarios")
def drift_scenarios():
    return {"scenarios": [{"key": k, "label": v["label"], "description": v["description"]}
                          for k, v in DRIFT_SCENARIOS.items()]}


@router.post("/drift")
def run_drift(req: DriftRequest):
    state_or_409()
    return engine.score_drift(req.scenario, req.n, req.seed)


@router.get("/drift")
def last_drift():
    st = state_or_409()
    return st.drift or {}


@router.get("/report")
def report():
    st = state_or_409()
    effects = engine.effects()
    opt = st.optimisation
    by_key = {s["key"]: s for s in opt["strategies"]}
    metric = "true_profit" if st.oracle else "predicted_profit"
    best = by_key["causal_optimizer"]
    persuadable = next(s for s in st.uplift["segments"]["segments"] if s["segment"] == "Persuadables")
    q10 = st.uplift["arms"][10]
    return {
        "kpis": {
            "customers": len(st.df),
            "conversion_rate": float(st.y.mean()),
            "ate_10": st.cate.ate[10],
            "ate_20": st.cate.ate[20],
            "persuadable_share": persuadable["share"],
            "optimised_profit": best[metric],
            "uplift_vs_blanket": best[metric] - by_key["blanket_10"][metric],
            "uplift_vs_response": best[metric] - by_key["response_model"][metric],
            "roi": best["true_roi" if st.oracle else "predicted_roi"],
            "budget": st.opt_params["budget"],
            "qini_10": q10["qini_coefficient"],
            "normalized_qini_10": q10.get("normalized_qini"),
            "refutation": (st.refutation or {}).get("verdict"),
            "drift": (st.drift or {}).get("status"),
        },
        "effects": effects,
        "narrative": narrative.optimiser_story(opt["strategies"], st.opt_params["budget"], st.uplift["segments"]),
        "segments": st.uplift["segments"]["segments"],
        "metric_basis": "oracle" if st.oracle else "predicted",
    }
