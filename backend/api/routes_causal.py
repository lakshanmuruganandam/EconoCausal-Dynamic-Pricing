"""Causal graph, identification, effect estimates, balance and refutation."""
from fastapi import APIRouter, HTTPException

from backend.api.deps import state_or_409
from backend.causal import dag
from backend.causal.data import FEATURE_LABELS
from backend.causal.engine import engine

router = APIRouter(prefix="/api/causal", tags=["causal"])


@router.get("/graph")
def graph():
    return dag.graph_payload()


@router.get("/identification")
def identification():
    return state_or_409().identification


@router.get("/effects")
def effects():
    state_or_409()
    return {"effects": engine.effects()}


@router.get("/propensity")
def propensity():
    st = state_or_409()
    out = []
    for arm, b in st.balance.items():
        b = dict(b)
        b["balance"] = [{**r, "label": FEATURE_LABELS.get(r["feature"], r["feature"])} for r in b["balance"]]
        out.append(b)
    return {"arms": out}


@router.get("/refutation")
def refutation():
    st = state_or_409()
    return {"status": engine.status["refutation"], "result": st.refutation}


@router.post("/refutation", status_code=202)
def run_refutation():
    state_or_409()
    if engine.status["refutation"] == "running":
        raise HTTPException(409, "refutation already running")
    engine.run_refutation(background=True)
    return {"accepted": True}
