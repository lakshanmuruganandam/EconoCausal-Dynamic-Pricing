"""
Export a static snapshot of the full pipeline for the GitHub Pages demo.

    .venv/bin/python -m backend.export_static

Runs the real causal pipeline once, then captures every API response the
dashboard reads into `frontend/public/demo/*.json`. Interactive features that
need computation (budget MILP re-solves, allocation table, What-If Lab) are
re-implemented in the browser from `customers.json` + `lab_model.json`.
"""
import json
import os
import re
import time
from pathlib import Path

os.environ["ECONOCAUSAL_AUTORUN"] = "0"

import numpy as np  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sklearn.linear_model import LinearRegression  # noqa: E402

from backend import config  # noqa: E402
from backend.causal.data import DRIFT_SCENARIOS, FEATURES, NUMERIC_FEATURES, REGIONS, SEGMENTS  # noqa: E402
from backend.causal.engine import RunConfig, _sigma, engine  # noqa: E402
from backend.main import app  # noqa: E402

OUT = config.BASE_DIR / "frontend" / "public" / "demo"
SCATTER_FEATURES = ["cart_abandons_90d", "email_open_rate", "avg_order_value", "age", "recency_days",
                    "frequency", "sessions_30d", "tenure_months"]


def slug(path: str) -> str:
    """Must match `demoFile()` in frontend/src/demo/engine.ts."""
    return re.sub(r"[^A-Za-z0-9]+", "_", path.lstrip("/")).strip("_") + ".json"


def save(name: str, payload) -> None:
    (OUT / name).write_text(json.dumps(payload, separators=(",", ":"), allow_nan=False))


def r(a, d=4):
    return np.round(np.asarray(a, dtype=float), d).tolist()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for f in OUT.glob("*.json"):
        f.unlink()

    t0 = time.time()
    # Linear DML as the demo model: its CATE is exactly linear in X, so the
    # browser What-If Lab can reproduce it without shipping a forest.
    engine.start(RunConfig(estimator="linear_dml"), background=False)
    st = engine.require()
    print(f"pipeline + audit + comparison: {time.time() - t0:.0f}s")

    client = TestClient(app)
    paths = [
        "/api/report", "/api/data/summary", "/api/data/sample?limit=12",
        "/api/causal/graph", "/api/causal/identification", "/api/causal/effects", "/api/causal/propensity",
        "/api/causal/refutation", "/api/model/summary", "/api/model/distribution", "/api/model/compare",
        "/api/uplift", "/api/drift/scenarios",
        "/api/model/scatter?feature=email_open_rate&arm=10&n=3000",
        *[f"/api/model/residuals?arm={a}&n=450" for a in (10, 20)],
        *[f"/api/model/scatter?feature={f}&arm={a}&n=1800" for f in SCATTER_FEATURES for a in (10, 20)],
        *[f"/api/lab/profile?persona={s.replace(' ', '%20')}" for s in SEGMENTS],
    ]
    for p in paths:
        res = client.get(p)
        res.raise_for_status()
        save(slug(p), res.json())

    status = client.get("/api/status").json()
    status["demo"] = True
    save("status.json", status)

    for scen in DRIFT_SCENARIOS:
        res = client.post("/api/drift", json={"scenario": scen, "n": 5000, "seed": 2026})
        save(f"drift_{scen}.json", res.json())

    (OUT / "template.csv").write_text(client.get("/api/data/template.csv").text)

    # ── per-customer arrays for the in-browser optimiser / allocation table ──
    df = st.df
    sig = _sigma(st.cate)
    region_idx = np.argmax(df[[f"region_{x}" for x in REGIONS]].values, axis=1)
    customers = {
        "id": df["customer_id"].tolist(),
        "segment": [SEGMENTS.index(s) for s in st.segments],
        "p0": r(st.p0_hat), "tau10": r(st.cate.ite[10]), "tau20": r(st.cate.ite[20]),
        "sig10": r(sig[10]), "sig20": r(sig[20]),
        "aov": r(df["avg_order_value"], 2),
        "discount": df[config.TREATMENT_COL].astype(int).tolist(),
        "purchased": df[config.OUTCOME_COL].astype(int).tolist(),
        "region": region_idx.tolist(),
        **{f: r(df[f], 3) for f in NUMERIC_FEATURES},
    }
    if st.oracle:
        customers.update({"true0": r(df["true_p0"]), "true10": r(df["true_p10"]), "true20": r(df["true_p20"])})
    save("customers.json", customers)

    # ── What-If Lab model: exact linear CATE + linear surrogates for σ and logit p0 ──
    est = st.cate.estimator
    X = st.X.values
    coef = np.asarray(est.coef_).reshape(2, -1)
    intercept = np.asarray(est.intercept_).ravel()
    p = np.clip(st.p0_hat, 1e-3, 1 - 1e-3)
    p0_fit = LinearRegression().fit(X, np.log(p / (1 - p)))
    sig_fit = {a: LinearRegression().fit(X, sig[a]) for a in (10, 20)}
    lab_model = {
        "features": FEATURES,
        "tau": {str(a): {"intercept": float(intercept[i]), "coef": r(coef[i], 6)} for i, a in enumerate((10, 20))},
        "sigma": {str(a): {"intercept": float(m.intercept_), "coef": r(m.coef_, 6)} for a, m in sig_fit.items()},
        "p0_logit": {"intercept": float(p0_fit.intercept_), "coef": r(p0_fit.coef_, 6)},
        "p0_r2": float(p0_fit.score(X, np.log(p / (1 - p)))),
        "tau10_sorted": r(np.sort(st.cate.ite[10])[::20]),   # for uplift percentiles
        "meta": client.get("/api/lab/profile?persona=Persuadables").json()["features"],
        "regions": REGIONS,
        "margin": config.GROSS_MARGIN,
        "risk_aversion": config.RISK_AVERSION,
        "budget": config.DEFAULT_BUDGET,
    }
    save("lab_model.json", lab_model)

    total = sum(f.stat().st_size for f in OUT.iterdir())
    print(f"wrote {len(list(OUT.iterdir()))} files, {total / 1e6:.1f} MB → {OUT}")


if __name__ == "__main__":
    main()
