"""
Causal graph definition, identification and refutation (Microsoft DoWhy).

Week 1 deliverable: encode domain knowledge as a Directed Acyclic Graph,
let DoWhy derive the back-door adjustment set, then – for the mid-project
Causal Audit – stress-test the estimate with refutation tests that a
genuinely causal effect must survive.
"""
from __future__ import annotations

import logging
import warnings

import networkx as nx
import numpy as np
import pandas as pd

from backend import config
from backend.causal.data import FEATURE_LABELS, FEATURES

log = logging.getLogger("econocausal.dag")

# Domain knowledge: the historical targeting rules looked at these variables,
# and each of them also drives purchasing → they open back-door paths.
CONFOUNDERS = ["recency_days", "frequency", "cart_abandons_90d", "loyalty_member"]
# Variables that drive purchasing / modulate the discount response only.
OUTCOME_DRIVERS = [f for f in FEATURES if f not in CONFOUNDERS]


def build_graph() -> nx.DiGraph:
    g = nx.DiGraph()
    t, y = config.TREATMENT_COL, config.OUTCOME_COL
    g.add_edge(t, y)
    for c in CONFOUNDERS:
        g.add_edge(c, t)
        g.add_edge(c, y)
    for m in OUTCOME_DRIVERS:
        g.add_edge(m, y)
    # Structural relations between covariates (do not change identification)
    g.add_edge("tenure_months", "loyalty_member")
    g.add_edge("recency_days", "frequency")
    g.add_edge("sessions_30d", "cart_abandons_90d")
    return g


def graph_payload() -> dict:
    """Node/edge layout consumed by the frontend DAG viewer."""
    t, y = config.TREATMENT_COL, config.OUTCOME_COL
    g = build_graph()
    nodes = [
        {"id": t, "label": "Discount offered", "role": "treatment"},
        {"id": y, "label": "Purchase (14d)", "role": "outcome"},
        {"id": "price_sensitivity", "label": "Price sensitivity", "role": "latent"},
    ]
    for c in CONFOUNDERS:
        nodes.append({"id": c, "label": FEATURE_LABELS[c], "role": "confounder"})
    for m in OUTCOME_DRIVERS:
        if m.startswith("region_") and m != "region_north":
            continue
        nid = "region" if m.startswith("region_") else m
        label = "Region" if nid == "region" else FEATURE_LABELS[m]
        nodes.append({"id": nid, "label": label, "role": "modifier"})

    edges = []
    for a, b in g.edges():
        a2 = "region" if a.startswith("region_") else a
        if (a2, b) not in {(e["source"], e["target"]) for e in edges}:
            edges.append({"source": a2, "target": b, "kind": "causal"})
    for src in ["cart_abandons_90d", "avg_order_value", "loyalty_member", "age", "mobile_user"]:
        edges.append({"source": src, "target": "price_sensitivity", "kind": "latent"})
    edges.append({"source": "price_sensitivity", "target": y, "kind": "modifier"})
    return {"nodes": nodes, "edges": edges, "adjustment_set": CONFOUNDERS}


def _binary_frame(df: pd.DataFrame, arm: int, sample: int, seed: int) -> pd.DataFrame:
    sub = df[df[config.TREATMENT_COL].isin([0, arm])]
    if len(sub) > sample:
        sub = sub.sample(sample, random_state=seed)
    out = sub[FEATURES + [config.OUTCOME_COL]].copy()
    out[config.TREATMENT_COL] = (sub[config.TREATMENT_COL].values == arm).astype(int)
    return out.reset_index(drop=True)


def _model(frame: pd.DataFrame):
    from dowhy import CausalModel

    return CausalModel(
        data=frame,
        treatment=config.TREATMENT_COL,
        outcome=config.OUTCOME_COL,
        graph=build_graph(),
    )


def identify(df: pd.DataFrame) -> dict:
    """Run DoWhy identification on the $10 contrast and summarise the estimand."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        model = _model(_binary_frame(df, 10, 2000, 0))
        estimand = model.identify_effect(proceed_when_unidentifiable=True)
    backdoor = sorted(estimand.get_backdoor_variables() or [])
    return {
        "estimand_type": "Non-parametric average treatment effect (ATE)",
        "method": "Back-door criterion",
        "backdoor_variables": backdoor,
        "expression": "d/dT  E[ Purchase | T, " + ", ".join(backdoor) + " ]",
        "assumptions": [
            "Unconfoundedness: no unobserved common causes of discount and purchase given the back-door set",
            "Positivity: every customer profile had a non-zero chance of receiving each discount",
            "SUTVA: one customer's coupon does not change another customer's purchase",
        ],
        "frontdoor_variables": list(estimand.get_frontdoor_variables() or []),
        "instrumental_variables": list(estimand.get_instrumental_variables() or []),
    }


REFUTERS = [
    {
        "key": "placebo_treatment_refuter",
        "label": "Placebo treatment",
        "description": "Randomly permute who got the discount. A real causal effect must collapse to ~0.",
        "kwargs": {"placebo_type": "permute"},
        "expect": "vanish",
    },
    {
        "key": "random_common_cause",
        "label": "Random common cause",
        "description": "Add a random covariate as an extra confounder. The estimate should not move.",
        "kwargs": {},
        "expect": "stable",
    },
    {
        "key": "data_subset_refuter",
        "label": "Data subset",
        "description": "Re-estimate on random 80% subsets. A robust effect is stable across samples.",
        "kwargs": {"subset_fraction": 0.8},
        "expect": "stable",
    },
    {
        "key": "bootstrap",
        "label": "Bootstrap resampling",
        "description": "Re-estimate on bootstrap resamples (with replacement) to check sampling variability.",
        "kwargs": {},
        "expect": "stable",
    },
    {
        "key": "add_unobserved_common_cause",
        "label": "Unobserved confounder",
        "description": "Simulate a hidden confounder of moderate strength. The sign of the effect should survive.",
        "kwargs": {
            "confounders_effect_on_treatment": "binary_flip",
            "confounders_effect_on_outcome": "linear",
            "effect_strength_on_treatment": 0.02,
            "effect_strength_on_outcome": 0.02,
        },
        "expect": "sign",
    },
]


def _verdict(expect: str, orig: float, new: float) -> tuple[bool, str]:
    scale = max(abs(orig), 1e-6)
    if expect == "vanish":
        ok = abs(new) <= 0.25 * scale
        return ok, f"placebo effect is {abs(new) / scale:.0%} of the original"
    if expect == "stable":
        drift = abs(new - orig) / scale
        return drift <= 0.15, f"estimate moved {drift:.1%}"
    ok = np.sign(new) == np.sign(orig)
    return bool(ok), "sign preserved" if ok else "sign flipped"


def _bootstrap(frame: pd.DataFrame, estimand, simulations: int, seed: int) -> tuple[float, float]:
    """Re-estimate the identified estimand on bootstrap resamples. Returns (mean, p-value of 0)."""
    from dowhy import CausalModel

    rng = np.random.default_rng(seed)
    vals = []
    for _ in range(simulations):
        boot = frame.iloc[rng.integers(0, len(frame), len(frame))].reset_index(drop=True)
        m = CausalModel(data=boot, treatment=config.TREATMENT_COL, outcome=config.OUTCOME_COL, graph=build_graph())
        vals.append(float(m.estimate_effect(estimand, method_name="backdoor.linear_regression").value))
    vals = np.array(vals)
    p_zero = float(min(1.0, 2 * min((vals <= 0).mean(), (vals >= 0).mean())))
    return float(vals.mean()), p_zero


def refute(df: pd.DataFrame, arms=(10, 20), sample: int = config.REFUTER_SAMPLE,
           simulations: int = config.REFUTER_SIMULATIONS, seed: int = 7) -> dict:
    """Run the full DoWhy refutation battery for every discount arm."""
    results = []
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        logging.getLogger("dowhy").setLevel(logging.ERROR)
        np.seterr(all="ignore")
        for arm in arms:
            frame = _binary_frame(df, arm, sample, seed)
            model = _model(frame)
            estimand = model.identify_effect(proceed_when_unidentifiable=True)
            est = model.estimate_effect(estimand, method_name="backdoor.linear_regression")
            orig = float(est.value)
            arm_res = {"arm": arm, "estimate": orig, "method": "backdoor.linear_regression",
                       "n": len(frame), "tests": []}
            for r in REFUTERS:
                kwargs = dict(r["kwargs"])
                if r["key"] not in ("add_unobserved_common_cause", "bootstrap"):
                    kwargs["num_simulations"] = simulations
                    kwargs["random_seed"] = seed
                try:
                    p_value = None
                    if r["key"] == "bootstrap":
                        new, p_value = _bootstrap(frame, estimand, simulations, seed)
                    else:
                        ref = model.refute_estimate(estimand, est, method_name=r["key"], **kwargs)
                        new = ref.new_effect
                        if isinstance(new, (tuple, list, np.ndarray)):
                            new = float(np.mean(new))
                        if isinstance(ref.refutation_result, dict) and ref.refutation_result.get("p_value") is not None:
                            p_value = float(ref.refutation_result["p_value"])
                    new = float(new)
                    passed, note = _verdict(r["expect"], orig, new)
                    arm_res["tests"].append({
                        "key": r["key"], "label": r["label"], "description": r["description"],
                        "original": orig, "new_effect": new, "p_value": p_value,
                        "passed": bool(passed), "note": note,
                    })
                except Exception as exc:  # pragma: no cover - library edge cases
                    log.warning("refuter %s failed: %s", r["key"], exc)
                    arm_res["tests"].append({
                        "key": r["key"], "label": r["label"], "description": r["description"],
                        "original": orig, "new_effect": None, "p_value": None,
                        "passed": False, "note": f"refuter error: {exc}",
                    })
            results.append(arm_res)
    total = sum(len(a["tests"]) for a in results)
    passed = sum(t["passed"] for a in results for t in a["tests"])
    return {"arms": results, "passed": passed, "total": total,
            "verdict": "PASS" if passed == total else ("PARTIAL" if passed >= total * 0.7 else "FAIL")}
