"""Pipeline control, health and dataset endpoints."""
import io

import numpy as np
import pandas as pd
from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from backend import config
from backend.api.deps import state_or_409
from backend.api.schemas import PipelineRequest
from backend.causal.data import FEATURE_LABELS, FEATURES, generate_dataset, validate_upload
from backend.causal.engine import RunConfig, engine

router = APIRouter(prefix="/api", tags=["pipeline"])


@router.get("/health")
def health():
    return {"status": "ok", "service": config.API_TITLE, "version": config.API_VERSION,
            "pipeline": engine.status["state"]}


@router.get("/status")
def status():
    st = engine.state
    out = dict(engine.status)
    if st is not None:
        out["run"] = {"n": len(st.df), "source": st.cfg.source, "estimator": st.cfg.estimator, "model": st.cate.name,
                      "seed": st.cfg.seed, "confounding": st.cfg.confounding, "oracle": st.oracle,
                      "created_at": st.created_at, "timings": st.timings}
    return out


@router.post("/pipeline/run", status_code=202)
def run_pipeline(req: PipelineRequest):
    try:
        engine.start(RunConfig(**req.model_dump()))
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))
    return {"accepted": True, "config": req.model_dump()}


@router.post("/data/upload", status_code=202)
async def upload(file: UploadFile = File(...), estimator: str = Form(config.DEFAULT_ESTIMATOR),
                 budget: float = Form(config.DEFAULT_BUDGET)):
    raw = await file.read()
    try:
        df = pd.read_csv(io.BytesIO(raw))
    except Exception as exc:
        raise HTTPException(400, f"could not parse CSV: {exc}")
    problems = validate_upload(df)
    if problems:
        raise HTTPException(422, {"problems": problems})
    if estimator != "auto" and estimator not in config.ESTIMATORS:
        raise HTTPException(422, f"estimator must be one of {config.ESTIMATORS}")
    try:
        engine.start(RunConfig(n=len(df), estimator=estimator, budget=budget, source=file.filename or "upload"), df=df)
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))
    return {"accepted": True, "rows": len(df)}


@router.get("/data/template.csv")
def template():
    from fastapi.responses import Response

    df = generate_dataset(1_000, seed=1)
    cols = ["customer_id"] + FEATURES + [config.TREATMENT_COL, config.OUTCOME_COL]
    return Response(df[cols].to_csv(index=False), media_type="text/csv",
                    headers={"Content-Disposition": "attachment; filename=econocausal_template.csv"})


@router.get("/data/summary")
def data_summary():
    st = state_or_409()
    df = st.df
    arms = []
    for arm in config.TREATMENT_LEVELS:
        m = df[config.TREATMENT_COL] == arm
        arms.append({"arm": arm, "count": int(m.sum()), "share": float(m.mean()),
                     "conversion": float(df.loc[m, config.OUTCOME_COL].mean()) if m.any() else 0.0})
    features = []
    for f in FEATURES:
        v = df[f].astype(float)
        binary = set(np.unique(v)) <= {0.0, 1.0}
        hist, edges = np.histogram(v, bins=2 if binary else 30)
        by_arm = {str(a): float(v[df[config.TREATMENT_COL] == a].mean()) for a in config.TREATMENT_LEVELS}
        features.append({"feature": f, "label": FEATURE_LABELS[f], "mean": float(v.mean()), "std": float(v.std()),
                         "min": float(v.min()), "max": float(v.max()), "binary": binary,
                         "hist": hist.tolist(), "edges": edges.round(3).tolist(), "mean_by_arm": by_arm})
    return {
        "rows": len(df), "train_rows": int(len(st.train_idx)), "test_rows": int(len(st.test_idx)),
        "conversion_rate": float(df[config.OUTCOME_COL].mean()),
        "avg_order_value": float(df["avg_order_value"].mean()),
        "arms": arms, "features": features, "source": st.cfg.source, "oracle": st.oracle,
    }


@router.get("/data/sample")
def data_sample(limit: int = 25):
    st = state_or_409()
    cols = ["customer_id"] + FEATURES + [config.TREATMENT_COL, config.OUTCOME_COL]
    rows = st.df[cols].head(max(1, min(limit, 200)))
    return {"columns": cols, "rows": rows.round(3).to_dict(orient="records")}
