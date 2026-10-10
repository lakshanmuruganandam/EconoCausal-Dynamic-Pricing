"""
Double / Debiased Machine Learning for Individual Treatment Effects (EconML).

DML partials out the confounders in two stages:

    1.  Nuisance models (LightGBM, cross-fitted):
            m(x) = E[Y | X]          outcome model
            e(x) = P(T = k | X)      treatment (propensity) model
    2.  Final stage on the residuals:
            Y - m(X)  =  θ(X) · (T - e(X))  +  ε

θ(X) is the Conditional Average Treatment Effect – the *causal* lift in
purchase probability a specific customer profile gets from a discount.
Because only the residual variation in T is used, the confounding that the
historical targeting policy introduced is stripped out (Neyman orthogonality
makes θ robust to small errors in either nuisance model).

Three final-stage estimators are supported:

    causal_forest   CausalForestDML   – non-parametric, honest forest, valid CIs
    linear_dml      LinearDML         – θ(X) linear in X, interpretable coefficients
    dr_learner      ForestDRLearner   – doubly-robust pseudo-outcomes + forest
"""
from __future__ import annotations

import time
import warnings
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from lightgbm import LGBMClassifier, LGBMRegressor
from sklearn.tree import DecisionTreeRegressor

from backend import config
from backend.causal.data import FEATURE_LABELS

ARMS = [a for a in config.TREATMENT_LEVELS if a != 0]


def _lgbm_reg(seed: int) -> LGBMRegressor:
    return LGBMRegressor(n_estimators=config.NUISANCE_ESTIMATORS, learning_rate=0.05, num_leaves=31,
                         min_child_samples=40, subsample=0.8, subsample_freq=1, colsample_bytree=0.8,
                         random_state=seed, verbose=-1)


def _lgbm_clf(seed: int) -> LGBMClassifier:
    return LGBMClassifier(n_estimators=config.NUISANCE_ESTIMATORS, learning_rate=0.05, num_leaves=31,
                          min_child_samples=40, subsample=0.8, subsample_freq=1, colsample_bytree=0.8,
                          random_state=seed, verbose=-1)


def build_estimator(name: str, seed: int = 0):
    if name == "causal_forest":
        from econml.dml import CausalForestDML

        return CausalForestDML(model_y=_lgbm_reg(seed), model_t=_lgbm_clf(seed), discrete_treatment=True,
                               categories=config.TREATMENT_LEVELS, cv=config.CV_FOLDS, n_estimators=400,
                               min_samples_leaf=25, max_samples=0.45, honest=True, random_state=seed)
    if name == "linear_dml":
        from econml.dml import LinearDML

        return LinearDML(model_y=_lgbm_reg(seed), model_t=_lgbm_clf(seed), discrete_treatment=True,
                         categories=config.TREATMENT_LEVELS, cv=config.CV_FOLDS, random_state=seed)
    if name == "dr_learner":
        from econml.dr import ForestDRLearner

        return ForestDRLearner(model_regression=_lgbm_reg(seed), model_propensity=_lgbm_clf(seed),
                               categories=config.TREATMENT_LEVELS, cv=config.CV_FOLDS, n_estimators=400,
                               min_samples_leaf=25, max_samples=0.45, honest=True, random_state=seed)
    raise ValueError(f"unknown estimator '{name}' – choose from {config.ESTIMATORS}")


ESTIMATOR_INFO = {
    "causal_forest": {"label": "Causal Forest DML", "family": "Double ML",
                      "summary": "Honest generalised random forest on orthogonalised residuals. Captures non-linear heterogeneity with valid confidence intervals."},
    "linear_dml": {"label": "Linear DML", "family": "Double ML",
                   "summary": "Final stage linear in customer features. Less flexible but fully interpretable coefficients."},
    "dr_learner": {"label": "Forest DR-Learner", "family": "Doubly Robust",
                   "summary": "Doubly-robust pseudo-outcomes regressed with an honest forest. Consistent if either nuisance model is right."},
}


@dataclass
class CateResult:
    name: str
    ite: dict[int, np.ndarray]                 # arm -> τ̂(x) for every customer
    lower: dict[int, np.ndarray]
    upper: dict[int, np.ndarray]
    ate: dict[int, dict]
    importance: list[dict]
    coefficients: list[dict] | None
    fit_seconds: float
    estimator: object = field(repr=False, default=None)


def _importance(est, name: str, X: pd.DataFrame) -> list[dict]:
    cols = list(X.columns)
    try:
        if name == "causal_forest":
            imp = np.asarray(est.feature_importances_).ravel()[: len(cols)]
        elif name == "dr_learner":
            imp = np.mean([np.asarray(est.feature_importances_(T=a)).ravel() for a in ARMS], axis=0)
        else:
            coef = np.abs(np.asarray(est.coef_)).reshape(-1, len(cols)).mean(axis=0)
            imp = coef * X.std().values
    except Exception:
        imp = np.zeros(len(cols))
    imp = np.nan_to_num(imp)
    total = imp.sum() or 1.0
    rows = [{"feature": c, "label": FEATURE_LABELS.get(c, c), "importance": float(v / total)}
            for c, v in zip(cols, imp)]
    return sorted(rows, key=lambda r: -r["importance"])


def _linear_coefficients(est, X: pd.DataFrame) -> list[dict] | None:
    """θ(x) = Σ β_j x_j coefficients with 95% CIs and p-values, one block per arm."""
    try:
        coef = np.asarray(est.coef_).reshape(len(ARMS), -1)
        inf = est.coef__inference()
        lo, hi = (np.asarray(v).reshape(len(ARMS), -1) for v in inf.conf_int(alpha=0.05))
        pv = np.asarray(inf.pvalue()).reshape(len(ARMS), -1)
        return [{"arm": arm, "feature": c, "label": FEATURE_LABELS.get(c, c), "coef": float(coef[i, j]),
                 "lower": float(lo[i, j]), "upper": float(hi[i, j]), "p_value": float(pv[i, j])}
                for i, arm in enumerate(ARMS) for j, c in enumerate(X.columns)]
    except Exception:
        return None


def fit_cate(name: str, X_train: pd.DataFrame, t_train: np.ndarray, y_train: np.ndarray,
             X_all: pd.DataFrame, seed: int = 0) -> CateResult:
    """Fit an EconML estimator on the training split and score every customer."""
    est = build_estimator(name, seed)
    start = time.perf_counter()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        est.fit(y_train.astype(float), t_train, X=X_train.values)
    fit_s = time.perf_counter() - start

    ite, lo, hi, ate = {}, {}, {}, {}
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        for arm in ARMS:
            ite[arm] = np.asarray(est.effect(X_all.values, T0=0, T1=arm)).ravel()
            try:
                l, u = est.effect_interval(X_all.values, T0=0, T1=arm, alpha=0.05)
                lo[arm], hi[arm] = np.asarray(l).ravel(), np.asarray(u).ravel()
            except Exception:
                lo[arm], hi[arm] = ite[arm], ite[arm]
            try:
                inf = est.ate_inference(X_train.values, T0=0, T1=arm)
                a_lo, a_hi = inf.conf_int_mean(alpha=0.05)
                ate[arm] = {"value": float(inf.mean_point), "lower": float(np.ravel(a_lo)[0]),
                            "upper": float(np.ravel(a_hi)[0]), "stderr": float(np.ravel(inf.stderr_mean)[0])}
            except Exception:
                v = float(np.mean(ite[arm]))
                ate[arm] = {"value": v, "lower": float(np.mean(lo[arm])), "upper": float(np.mean(hi[arm])),
                            "stderr": None}

    return CateResult(
        name=name, ite=ite, lower=lo, upper=hi, ate=ate,
        importance=_importance(est, name, X_train),
        coefficients=_linear_coefficients(est, X_train) if name == "linear_dml" else None,
        fit_seconds=fit_s, estimator=est,
    )


class BaselineModel:
    """
    p(Y=1 | X, T=0): purchase probability *without* a discount.

    The optimiser needs it to price the expected redemption cost; an
    S-learner gradient boosted model with the treatment as a feature is
    accurate for this level estimate.
    """

    def __init__(self, seed: int = 0):
        self.clf = _lgbm_clf(seed)

    @staticmethod
    def _augment(X: pd.DataFrame, t: np.ndarray | None) -> np.ndarray:
        A = X.copy()
        A["_t10"] = (t == 10).astype(float) if t is not None else 0.0
        A["_t20"] = (t == 20).astype(float) if t is not None else 0.0
        return A.values

    def fit(self, X: pd.DataFrame, t: np.ndarray, y: np.ndarray) -> "BaselineModel":
        self.clf.fit(self._augment(X, t), y)
        return self

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        return np.clip(self.clf.predict_proba(self._augment(X, None))[:, 1], 0.001, 0.999)


def baseline_model(X_train: pd.DataFrame, t_train: np.ndarray, y_train: np.ndarray,
                   X_score: pd.DataFrame, seed: int = 0) -> np.ndarray:
    return BaselineModel(seed).fit(X_train, t_train, y_train).predict(X_score)


def cate_rules(X: pd.DataFrame, tau: np.ndarray, max_depth: int = 3, min_leaf_frac: float = 0.03) -> list[dict]:
    """
    Distil τ̂(x) into human-readable segment rules with a shallow tree
    (equivalent to EconML's SingleTreeCateInterpreter).
    """
    tree = DecisionTreeRegressor(max_depth=max_depth, min_samples_leaf=max(int(len(X) * min_leaf_frac), 20),
                                 random_state=0).fit(X.values, tau)
    t = tree.tree_
    cols = list(X.columns)
    rules: list[dict] = []

    def fmt(feature: str, op: str, thr: float) -> str:
        label = FEATURE_LABELS.get(feature, feature)
        if set(np.unique(X[feature])) <= {0.0, 1.0}:
            return f"{label} = {'No' if op == '<=' else 'Yes'}"
        return f"{label} {op} {thr:,.2f}" if thr < 10 else f"{label} {op} {thr:,.0f}"

    def walk(node: int, path: list[str]):
        if t.children_left[node] == -1:
            rules.append({"conditions": path, "n": int(t.n_node_samples[node]),
                          "share": float(t.n_node_samples[node] / len(X)), "cate": float(t.value[node][0][0])})
            return
        f, thr = cols[t.feature[node]], float(t.threshold[node])
        walk(t.children_left[node], path + [fmt(f, "<=", thr)])
        walk(t.children_right[node], path + [fmt(f, ">", thr)])

    walk(0, [])
    return sorted(rules, key=lambda r: -r["cate"])


def oracle_metrics(tau_hat: np.ndarray, tau_true: np.ndarray, lo: np.ndarray, hi: np.ndarray) -> dict:
    """Accuracy against the hidden ground truth (synthetic data only)."""
    return {
        "pehe": float(np.sqrt(np.mean((tau_hat - tau_true) ** 2))),
        "correlation": float(np.corrcoef(tau_hat, tau_true)[0, 1]) if tau_hat.std() > 0 else 0.0,
        "ate_bias": float(tau_hat.mean() - tau_true.mean()),
        "ci_coverage": float(np.mean((tau_true >= lo) & (tau_true <= hi))),
        "sign_accuracy": float(np.mean(np.sign(tau_hat) == np.sign(tau_true))),
    }
