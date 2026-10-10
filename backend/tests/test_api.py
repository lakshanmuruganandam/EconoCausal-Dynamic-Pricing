"""End-to-end API tests against a pipeline run on a small dataset."""
import io

import pytest
from fastapi.testclient import TestClient

from backend.main import app


@pytest.fixture(scope="module")
def client(ready_engine):
    with TestClient(app) as c:
        yield c


def test_health_and_status(client):
    assert client.get("/api/health").json()["status"] == "ok"
    st = client.get("/api/status").json()
    assert st["state"] == "ready"
    assert st["run"]["oracle"] is True


def test_data_summary(client):
    d = client.get("/api/data/summary").json()
    assert d["rows"] == 4000
    assert sum(a["count"] for a in d["arms"]) == 4000
    assert len(d["features"]) == 14


def test_graph_and_identification(client):
    g = client.get("/api/causal/graph").json()
    roles = {n["role"] for n in g["nodes"]}
    assert {"treatment", "outcome", "confounder", "modifier", "latent"} <= roles
    ident = client.get("/api/causal/identification").json()
    assert set(ident["backdoor_variables"]) == set(g["adjustment_set"])


def test_effects_close_to_truth(client):
    effects = client.get("/api/causal/effects").json()["effects"]
    for e in effects:
        assert e["dml"]["lower"] <= e["truth"] + 0.05
        assert abs(e["dml"]["value"] - e["truth"]) < abs(e["naive"] - e["truth"]) + 0.02


def test_refutation_battery(client):
    r = client.get("/api/causal/refutation").json()
    assert r["status"] == "ready"
    placebo = [t for a in r["result"]["arms"] for t in a["tests"] if t["key"] == "placebo_treatment_refuter"]
    assert all(t["passed"] for t in placebo)


def test_model_endpoints(client):
    s = client.get("/api/model/summary").json()
    assert s["estimator"] == "linear_dml"
    assert s["coefficients"]
    assert s["rules"]["10"]
    assert s["oracle"]["10"]["correlation"] > 0.5
    d = client.get("/api/model/distribution").json()
    assert len(d["bins"]) == len(d["arms"]["10"]["hist"])
    sc = client.get("/api/model/scatter", params={"feature": "email_open_rate", "n": 200}).json()
    assert len(sc["x"]) == 200
    assert client.get("/api/model/scatter", params={"feature": "nope"}).status_code == 422


def test_uplift_beats_response_model(client):
    u = client.get("/api/uplift").json()
    for arm in ("10", "20"):
        assert u["arms"][arm]["normalized_qini"] > u["arms"][arm]["normalized_qini_response"]


def test_optimise_and_allocation(client):
    res = client.post("/api/optimize", json={"budget": 1000, "risk_aversion": 1.0}).json()
    opt = next(s for s in res["strategies"] if s["key"] == "causal_optimizer")
    blanket = next(s for s in res["strategies"] if s["key"] == "blanket_10")
    assert opt["predicted_spend"] <= 1000 + 1e-6
    assert opt["true_profit"] > blanket["true_profit"]
    assert res["narrative"]
    page = client.get("/api/optimize/allocation", params={"discount": "10", "size": 10}).json()
    assert all(r["discount"] == 10 for r in page["rows"])
    csv = client.get("/api/optimize/allocation.csv")
    assert csv.headers["content-type"].startswith("text/csv")
    assert csv.text.splitlines()[0].startswith("customer_id")


def test_drift_endpoint(client):
    d = client.post("/api/drift", json={"scenario": "churn_wave", "n": 2000}).json()
    assert d["status"] == "alert"
    assert "prediction" in d
    assert len(client.get("/api/drift/scenarios").json()["scenarios"]) == 4


def test_report(client):
    r = client.get("/api/report").json()
    assert r["kpis"]["customers"] == 4000
    assert r["metric_basis"] == "oracle"


def test_upload_rejects_bad_csv(client):
    bad = io.BytesIO(b"a,b\n1,2\n")
    r = client.post("/api/data/upload", files={"file": ("bad.csv", bad, "text/csv")})
    assert r.status_code == 422


def test_lab_profile_and_predict(client):
    prof = client.get("/api/lab/profile", params={"persona": "Persuadables"}).json()
    assert prof["segment"] == "Persuadables"
    assert len(prof["features"]) == 10
    res = client.post("/api/lab/predict", json={"profile": prof["profile"], "sweep": "email_open_rate"}).json()
    assert 0 < res["p0"] < 1
    assert res["recommendation"] in (0, 10, 20)
    assert len(res["curve"]["x"]) == len(res["curve"]["10"]) == 30
    assert len(res["attribution"]) == 10
    one = client.get("/api/lab/profile", params={"customer_id": prof["customer_id"]}).json()
    assert one["profile"] == prof["profile"]
    assert client.get("/api/lab/profile", params={"customer_id": "nope"}).status_code == 404


def test_residuals_and_flow(client):
    r = client.get("/api/model/residuals", params={"arm": 10, "n": 200}).json()
    assert len(r["points"]["t_res"]) == 200
    assert r["theta"] > r["naive"]                       # de-confounding raises the estimate
    f = client.get("/api/optimize/flow").json()
    assert sum(l["customers"] for l in f["links"]) == 4000
