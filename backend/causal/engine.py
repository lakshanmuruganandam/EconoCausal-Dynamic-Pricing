"""
Pipeline orchestration and in-memory state.

    data → propensity/balance → identification → DML (ITE) → uplift/segments
         → budget optimisation → (background) refutation audit + model comparison

The pipeline runs in a background thread so the API stays responsive; the
frontend polls /api/status for progress. A finished run is swapped in
atomically, so readers never observe a half-built state.
"""
from __future__ import annotations

import logging
import threading
import time
import traceback
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from backend import config
from backend.causal import dag, drift, dml, narrative, optimizer, propensity, uplift
from backend.causal.data import FEATURES, generate_dataset, has_oracle

log = logging.getLogger("econocausal.engine")

STAGES = [
    ("data", "Loading campaign data"),
    ("propensity", "Estimating propensity scores & balance"),
    ("identification", "Identifying causal estimand (DoWhy)"),
    ("dml", "Training Double ML for individual effects"),
    ("uplift", "Evaluating uplift & segmenting customers"),
    ("optimize", "Solving budget allocation (MILP)"),
]


@dataclass
class RunConfig:
    n: int = config.DEFAULT_N_CUSTOMERS
    seed: int = config.DEFAULT_SEED
    confounding: float = config.DEFAULT_CONFOUNDING
    estimator: str = config.DEFAULT_ESTIMATOR
    budget: float = config.DEFAULT_BUDGET
    source: str = "synthetic"


@dataclass
class State:
    cfg: RunConfig
    df: pd.DataFrame
    X: pd.DataFrame
    t: np.ndarray
    y: np.ndarray
    train_idx: np.ndarray
    test_idx: np.ndarray
    proba: np.ndarray
    balance: dict
    identification: dict
    cate: dml.CateResult
    p0_hat: np.ndarray
    p0_model: dml.BaselineModel
    segments: np.ndarray
    uplift: dict
    optimisation: dict
    opt_params: dict
    oracle: bool
    created_at: float = field(default_factory=time.time)
    refutation: dict | None = None
    comparison: dict | None = None
    drift: dict | None = None
    timings: dict = field(default_factory=dict)
    cache: dict = field(default_factory=dict)

    def truth(self) -> dict | None:
        if not self.oracle:
            return None
        return {0: self.df["true_p0"].values, 10: self.df["true_p10"].values, 20: self.df["true_p20"].values}


class Engine:
    def __init__(self):
        self.state: State | None = None
        self._lock = threading.Lock()
        self.status = {"state": "idle", "stage": None, "stage_index": 0, "stages": [s[1] for s in STAGES],
                       "message": "Waiting to start", "error": None, "started_at": None, "finished_at": None,
                       "refutation": "idle", "comparison": "idle"}

    # ── status helpers ────────────────────────────────────────────────────
    def _set_stage(self, i: int):
        key, msg = STAGES[i]
        self.status.update({"stage": key, "stage_index": i, "message": msg})
        log.info("[%d/%d] %s", i + 1, len(STAGES), msg)

    @property
    def busy(self) -> bool:
        return self.status["state"] == "running"

    # ── public entry points ───────────────────────────────────────────────
    def start(self, cfg: RunConfig, df: pd.DataFrame | None = None, background: bool = True):
        if not self._lock.acquire(blocking=False):
            raise RuntimeError("a pipeline run is already in progress")
        self.status.update({"state": "running", "error": None, "started_at": time.time(), "finished_at": None,
                            "refutation": "idle", "comparison": "idle", "stage_index": 0})

        def work():
            try:
                self._run(cfg, df)
                self.status.update({"state": "ready", "stage": "done", "stage_index": len(STAGES),
                                    "message": "Pipeline complete", "finished_at": time.time()})
            except Exception as exc:
                log.error("pipeline failed: %s\n%s", exc, traceback.format_exc())
                self.status.update({"state": "error", "error": str(exc), "message": "Pipeline failed",
                                    "finished_at": time.time()})
            finally:
                self._lock.release()
            if self.status["state"] == "ready":
                self.run_refutation(background=False)
                if self.state.comparison is None:
                    self.run_comparison(background=False)

        if background:
            threading.Thread(target=work, daemon=True, name="econocausal-pipeline").start()
        else:
            work()

    def _run(self, cfg: RunConfig, df: pd.DataFrame | None):
        timings = {}
        tick = time.perf_counter()

        self._set_stage(0)
        if df is None:
            df = generate_dataset(cfg.n, cfg.seed, cfg.confounding)
        df = df.reset_index(drop=True)
        if "customer_id" not in df:
            df.insert(0, "customer_id", [f"U{i:06d}" for i in range(len(df))])
        X = df[FEATURES].astype(float)
        t = df[config.TREATMENT_COL].values.astype(int)
        y = df[config.OUTCOME_COL].values.astype(int)
        oracle = has_oracle(df)
        rng = np.random.default_rng(cfg.seed)
        perm = rng.permutation(len(df))
        n_test = int(len(df) * config.TEST_FRACTION)
        test_idx, train_idx = np.sort(perm[:n_test]), np.sort(perm[n_test:])
        timings["data"], tick = time.perf_counter() - tick, time.perf_counter()

        self._set_stage(1)
        proba, _ = propensity.fit_propensity(X, t)
        balance = {arm: propensity.analyse_contrast(X, t, y, proba, arm) for arm in dml.ARMS}
        timings["propensity"], tick = time.perf_counter() - tick, time.perf_counter()

        self._set_stage(2)
        identification = dag.identify(df)
        timings["identification"], tick = time.perf_counter() - tick, time.perf_counter()

        self._set_stage(3)
        p0_model = dml.BaselineModel(cfg.seed).fit(X.iloc[train_idx], t[train_idx], y[train_idx])
        p0_all = p0_model.predict(X)
        names = config.ESTIMATORS if cfg.estimator == "auto" else [cfg.estimator]
        candidates = []
        for i, name in enumerate(names):
            if len(names) > 1:
                self.status["message"] = f"Training Double ML – {dml.ESTIMATOR_INFO[name]['label']} ({i + 1}/{len(names)})"
            candidates.append(dml.fit_cate(name, X.iloc[train_idx], t[train_idx], y[train_idx], X, seed=cfg.seed))
        selection = None
        if len(candidates) > 1:
            # Champion/challenger: pick the model with the best IPW Qini on the hold-out set.
            # Uses observed data only, so it works identically on real campaign logs.
            scores = {c.name: self._holdout_qini(c, proba, p0_all, t, y, test_idx) for c in candidates}
            best = max(scores, key=scores.get)
            selection = {"criterion": "Mean IPW Qini coefficient on hold-out (observed data only)",
                         "scores": scores, "champion": best}
        cate = next(c for c in candidates if selection is None or c.name == selection["champion"])
        timings["dml"], tick = time.perf_counter() - tick, time.perf_counter()

        self._set_stage(4)
        segments = uplift.segment_customers(p0_all, cate.ite[10])
        up = self._uplift(df, X, t, y, proba, test_idx, cate, p0_all, segments, oracle)
        timings["uplift"], tick = time.perf_counter() - tick, time.perf_counter()

        self._set_stage(5)
        params = {"budget": cfg.budget, "margin": config.GROSS_MARGIN, "objective": "profit",
                  "cost_basis": "redemption", "risk_aversion": config.RISK_AVERSION}
        truth = None
        if oracle:
            truth = {0: df["true_p0"].values, 10: df["true_p10"].values, 20: df["true_p20"].values}
        opt = optimizer.optimise(df, p0_all, cate.ite, truth=truth, sigma=_sigma(cate), **params)
        timings["optimize"] = time.perf_counter() - tick

        self.state = State(cfg=cfg, df=df, X=X, t=t, y=y, train_idx=train_idx, test_idx=test_idx, proba=proba,
                           balance=balance, identification=identification, cate=cate, p0_hat=p0_all, p0_model=p0_model,
                           segments=segments, uplift=up, optimisation=opt, opt_params=params, oracle=oracle,
                           timings=timings)
        if selection is not None:
            self.state.comparison = {"models": [self._score_estimator(self.state, c, c.name) for c in candidates],
                                     "selection": selection}
            self.status["comparison"] = "ready"

    @staticmethod
    def _holdout_qini(cate: dml.CateResult, proba, p0_all, t, y, test_idx) -> float:
        vals = []
        for arm in dml.ARMS:
            k = config.TREATMENT_LEVELS.index(arm)
            e = np.clip(proba[test_idx, k] / (proba[test_idx, k] + proba[test_idx, 0]), 0.01, 0.99)
            q = uplift.qini(arm, cate.ite[arm][test_idx], p0_all[test_idx], y[test_idx], t[test_idx], e)
            vals.append(q["qini_coefficient"])
        return float(np.mean(vals))

    def _uplift(self, df, X, t, y, proba, test_idx, cate, p0_all, segments, oracle) -> dict:
        res = {"arms": {}, "deciles": {}}
        for arm in dml.ARMS:
            k = config.TREATMENT_LEVELS.index(arm)
            e_cond = np.clip(proba[:, k] / (proba[:, k] + proba[:, 0]), 0.01, 0.99)
            tt = df[f"true_ite_{arm}"].values[test_idx] if oracle else None
            res["arms"][arm] = uplift.qini(arm, cate.ite[arm][test_idx], p0_all[test_idx], y[test_idx],
                                           t[test_idx], e_cond[test_idx], tt)
            res["deciles"][arm] = uplift.deciles(arm, cate.ite[arm][test_idx], y[test_idx], t[test_idx],
                                                 e_cond[test_idx], tt)
        seg_true = df["true_segment"].values if oracle else None
        res["segments"] = uplift.segment_summary(segments, cate.ite[10], p0_all, seg_true)
        return res

    # ── background extras ─────────────────────────────────────────────────
    def run_refutation(self, background: bool = True):
        st = self.state
        if st is None:
            raise RuntimeError("pipeline has not run yet")

        def work():
            self.status["refutation"] = "running"
            try:
                st.refutation = dag.refute(st.df)
                self.status["refutation"] = "ready"
            except Exception as exc:
                log.error("refutation failed: %s", exc)
                self.status["refutation"] = f"error: {exc}"

        threading.Thread(target=work, daemon=True).start() if background else work()

    def run_comparison(self, background: bool = True):
        st = self.state
        if st is None:
            raise RuntimeError("pipeline has not run yet")

        def work():
            self.status["comparison"] = "running"
            try:
                rows = []
                for name in config.ESTIMATORS:
                    res = st.cate if name == st.cate.name else dml.fit_cate(
                        name, st.X.iloc[st.train_idx], st.t[st.train_idx], st.y[st.train_idx],
                        st.X.iloc[st.test_idx], seed=st.cfg.seed)
                    rows.append(self._score_estimator(st, res, name))
                st.comparison = {"models": rows, "selection": None}
                self.status["comparison"] = "ready"
            except Exception as exc:
                log.error("comparison failed: %s\n%s", exc, traceback.format_exc())
                self.status["comparison"] = f"error: {exc}"

        threading.Thread(target=work, daemon=True).start() if background else work()

    @staticmethod
    def _score_estimator(st: State, res: dml.CateResult, name: str) -> dict:
        full = len(res.ite[dml.ARMS[0]]) == len(st.df)    # scored on every row, not just the hold-out
        ti = st.test_idx
        row = {"name": name, **dml.ESTIMATOR_INFO[name], "fit_seconds": res.fit_seconds, "arms": {}}
        for arm in dml.ARMS:
            tau = res.ite[arm][ti] if full else res.ite[arm]
            lo = res.lower[arm][ti] if full else res.lower[arm]
            hi = res.upper[arm][ti] if full else res.upper[arm]
            k = config.TREATMENT_LEVELS.index(arm)
            e = np.clip(st.proba[ti, k] / (st.proba[ti, k] + st.proba[ti, 0]), 0.01, 0.99)
            tt = st.df[f"true_ite_{arm}"].values[ti] if st.oracle else None
            q = uplift.qini(arm, tau, st.p0_hat[ti], st.y[ti], st.t[ti], e, tt)
            m = {"ate": float(tau.mean()), "qini": q["qini_coefficient"], "normalized_qini": q.get("normalized_qini")}
            if st.oracle:
                m.update(dml.oracle_metrics(tau, tt, lo, hi))
            row["arms"][arm] = m
        return row

    # ── interactive actions ───────────────────────────────────────────────
    def reoptimise(self, budget: float, margin: float, objective: str, cost_basis: str,
                   risk_aversion: float) -> dict:
        st = self.require()
        params = {"budget": budget, "margin": margin, "objective": objective, "cost_basis": cost_basis,
                  "risk_aversion": risk_aversion}
        st.optimisation = optimizer.optimise(st.df, st.p0_hat, st.cate.ite, truth=st.truth(),
                                             sigma=_sigma(st.cate), **params)
        st.opt_params = params
        return st.optimisation

    def score_drift(self, scenario: str, n: int, seed: int) -> dict:
        st = self.require()
        batch = generate_dataset(n, seed, st.cfg.confounding, scenario=scenario)
        cur_pred = np.asarray(st.cate.estimator.effect(batch[FEATURES].values.astype(float), T0=0, T1=10)).ravel()
        ref = st.df.iloc[st.train_idx]
        res = drift.detect(ref, batch, FEATURES, st.cate.ite[10][st.train_idx], cur_pred)
        res["scenario"] = scenario
        st.drift = res
        return res

    def require(self) -> State:
        if self.state is None:
            raise LookupError("pipeline has not completed yet")
        return self.state

    # ── summaries ─────────────────────────────────────────────────────────
    def effects(self) -> list[dict]:
        st = self.require()
        rows = []
        for arm in dml.ARMS:
            b = st.balance[arm]
            truth = float(st.df[f"true_ite_{arm}"].mean()) if st.oracle else None
            rows.append({
                "arm": arm,
                "naive": b["naive_effect"],
                "ipw": b["ipw_effect"],
                "psm_att": b["psm_att"],
                "dml": st.cate.ate[arm],
                "truth": truth,
                "story": narrative.effect_story(arm, b["naive_effect"], st.cate.ate[arm], truth),
            })
        return rows


def _sigma(cate: dml.CateResult) -> dict[int, np.ndarray]:
    """Per-customer standard error of τ̂ recovered from the 95% interval."""
    return {a: np.maximum(cate.upper[a] - cate.lower[a], 0) / 3.92 for a in dml.ARMS}


engine = Engine()
