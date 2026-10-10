"""
Prescriptive budget allocation (SciPy MILP).

Given causal predictions, choose one discount d_i ∈ {$0, $10, $20} per
customer to maximise expected incremental profit under a hard budget:

    maximise    Σ_i Σ_k  v_ik · x_ik
    subject to  Σ_k x_ik ≤ 1                       (one offer per customer)
                Σ_i Σ_k  c_ik · x_ik ≤ Budget      (marketing budget)
                x_ik ∈ {0, 1}

    v_ik = τ̂_k(x_i) · AOV_i · margin  −  c_ik       (net incremental profit)
    c_ik = k · p̂_k(x_i)                            (expected redemption cost)

The redemption cost is paid by *everyone* who buys with the coupon – including
the "Sure Things" who would have bought anyway. That is exactly why
targeting by purchase probability wastes money and targeting by causal
uplift does not.

Risk adjustment: the optimiser maximises predicted value, so it is drawn to
customers whose effect is *over*-estimated (the winner's curse). Planning on
a lower confidence bound  τ̃ = τ̂ − λ·σ̂  (σ̂ from the estimator's 95% CI)
trades a little expected value for robustness; λ = risk_aversion.

The efficient frontier (profit vs budget) is computed exactly for the LP
relaxation with the convex-hull greedy algorithm for the multiple-choice
knapsack problem, so the full curve costs one sort instead of many solves.
"""
from __future__ import annotations

import time

import numpy as np
import pandas as pd
from scipy.optimize import Bounds, LinearConstraint, milp
from scipy.sparse import csr_matrix, vstack

from backend import config

ARMS = [a for a in config.TREATMENT_LEVELS if a != 0]


def option_table(p0: np.ndarray, tau: dict[int, np.ndarray], aov: np.ndarray, margin: float,
                 objective: str = "profit", cost_basis: str = "redemption") -> tuple[np.ndarray, np.ndarray]:
    """Return (value, cost) matrices of shape (n, len(ARMS))."""
    vals, costs = [], []
    for k in ARMS:
        pk = np.clip(p0 + tau[k], 0, 1)
        cost = k * pk if cost_basis == "redemption" else np.full_like(p0, float(k))
        if objective == "revenue":
            val = tau[k] * aov
        elif objective == "conversions":
            val = tau[k]
        else:
            val = tau[k] * aov * margin - cost
        vals.append(val)
        costs.append(cost)
    return np.column_stack(vals), np.column_stack(costs)


def solve_milp(value: np.ndarray, cost: np.ndarray, budget: float, time_limit: float = 20.0) -> dict:
    n, k = value.shape
    choice = np.zeros(n, dtype=int)                      # index into config.TREATMENT_LEVELS
    useful = (value > 1e-9).any(axis=1)
    idx = np.where(useful)[0]
    start = time.perf_counter()
    status = "optimal"
    if len(idx) and budget > 0:
        v = value[idx].ravel()
        c = cost[idx].ravel()
        m = len(idx)
        # Options with non-positive value are never chosen: fix their upper bound to 0
        ub = (v > 1e-9).astype(float)
        rows = np.repeat(np.arange(m), k)
        one_offer = csr_matrix((np.ones(m * k), (rows, np.arange(m * k))), shape=(m, m * k))
        budget_row = csr_matrix(c.reshape(1, -1))
        A = vstack([one_offer, budget_row]).tocsr()
        lb_c = np.concatenate([np.zeros(m), [0.0]])
        ub_c = np.concatenate([np.ones(m), [budget]])
        res = milp(c=-v, constraints=LinearConstraint(A, lb_c, ub_c), integrality=np.ones(m * k),
                   bounds=Bounds(np.zeros(m * k), ub),
                   options={"time_limit": time_limit, "mip_rel_gap": 1e-4, "presolve": True})
        if res.x is None:
            status = "infeasible"
        else:
            status = "optimal" if res.status == 0 else "time_limit"
            x = res.x.reshape(m, k) > 0.5
            picked = x.any(axis=1)
            choice[idx[picked]] = x[picked].argmax(axis=1) + 1
    elapsed = time.perf_counter() - start
    return {"choice": choice, "status": status, "solve_seconds": elapsed, "candidates": int(len(idx))}


def frontier(value: np.ndarray, cost: np.ndarray, budgets: np.ndarray) -> list[dict]:
    """Exact LP-relaxation frontier via convex-hull increments (multiple-choice knapsack)."""
    inc_eff, inc_c, inc_v = [], [], []
    for vi, ci in zip(value, cost):
        pts = sorted([(0.0, 0.0)] + [(c, v) for c, v in zip(ci, vi) if v > 0], key=lambda p: p[0])
        hull = [pts[0]]
        for p in pts[1:]:
            if p[1] <= hull[-1][1]:
                continue                                  # dominated: costs more, earns less
            while len(hull) >= 2:
                (c1, v1), (c2, v2) = hull[-2], hull[-1]
                if (v2 - v1) * (p[0] - c1) <= (p[1] - v1) * (c2 - c1):
                    hull.pop()                            # not on the upper concave hull
                else:
                    break
            hull.append(p)
        for (c1, v1), (c2, v2) in zip(hull, hull[1:]):
            dc = max(c2 - c1, 1e-9)
            inc_eff.append((v2 - v1) / dc)
            inc_c.append(dc)
            inc_v.append(v2 - v1)
    if not inc_eff:
        return [{"budget": float(b), "value": 0.0} for b in budgets]
    order = np.argsort(-np.array(inc_eff))
    cc = np.cumsum(np.array(inc_c)[order])
    cv = np.cumsum(np.array(inc_v)[order])
    eff = np.array(inc_eff)[order]
    out = []
    for b in budgets:
        j = np.searchsorted(cc, b, side="right")
        val = cv[j - 1] if j > 0 else 0.0
        if j < len(cc):                                  # fractional last increment
            prev = cc[j - 1] if j > 0 else 0.0
            val += (b - prev) * eff[j]
        out.append({"budget": float(b), "value": float(val)})
    return out


def _fill_budget(order: np.ndarray, cost: np.ndarray, budget: float) -> np.ndarray:
    """Give offers following `order` until the expected budget is spent."""
    cum = np.cumsum(cost[order])
    return order[cum <= budget]


def heuristic_choice(name: str, value: np.ndarray, cost: np.ndarray, p0: np.ndarray, budget: float,
                     seed: int = 0) -> np.ndarray:
    n = len(p0)
    choice = np.zeros(n, dtype=int)
    rng = np.random.default_rng(seed)
    if name == "blanket_10":
        sel = _fill_budget(rng.permutation(n), cost[:, 0], budget)
        choice[sel] = 1
    elif name == "blanket_20":
        sel = _fill_budget(rng.permutation(n), cost[:, 1], budget)
        choice[sel] = 2
    elif name == "response_model":
        # "Traditional ML": target the customers most likely to purchase
        sel = _fill_budget(np.argsort(-p0), cost[:, 0], budget)
        choice[sel] = 1
    elif name == "uplift_rank":
        # Rank by predicted $10 uplift without optimising the offer level
        sel = _fill_budget(np.argsort(-value[:, 0]), cost[:, 0], budget)
        choice[sel] = 1
    return choice


STRATEGIES = {
    "causal_optimizer": "Causal optimiser (MILP)",
    "uplift_rank": "Uplift ranking, $10 only",
    "response_model": "Traditional ML (purchase propensity)",
    "blanket_10": "Blanket $10 (random)",
    "blanket_20": "Blanket $20 (random)",
}


def evaluate(choice: np.ndarray, value: np.ndarray, cost: np.ndarray, p0: np.ndarray, tau: dict,
             aov: np.ndarray, margin: float, truth: dict | None) -> dict:
    """Score an allocation with the model's predictions and, if available, the oracle."""
    n = len(choice)
    rows = np.arange(n)
    treated = choice > 0
    sel_v = np.where(treated, value[rows, np.maximum(choice - 1, 0)], 0.0)
    sel_c = np.where(treated, cost[rows, np.maximum(choice - 1, 0)], 0.0)
    pred_tau = np.zeros(n)
    for j, k in enumerate(ARMS, start=1):
        pred_tau[choice == j] = tau[k][choice == j]
    out = {
        "customers_targeted": int(treated.sum()),
        "offers": {f"${k}": int((choice == j).sum()) for j, k in enumerate(ARMS, start=1)},
        "predicted_profit": float(sel_v.sum()),
        "predicted_spend": float(sel_c.sum()),
        "predicted_incremental_conversions": float(pred_tau.sum()),
        "predicted_roi": float(sel_v.sum() / sel_c.sum()) if sel_c.sum() > 0 else 0.0,
    }
    if truth is not None:
        t_tau = np.zeros(n)
        t_spend = np.zeros(n)
        for j, k in enumerate(ARMS, start=1):
            m = choice == j
            t_tau[m] = truth[k][m] - truth[0][m]
            t_spend[m] = k * truth[k][m]
        t_profit = (t_tau * aov * margin - t_spend).sum()
        out.update({
            "true_profit": float(t_profit),
            "true_spend": float(t_spend.sum()),
            "true_incremental_conversions": float(t_tau.sum()),
            "true_roi": float(t_profit / t_spend.sum()) if t_spend.sum() > 0 else 0.0,
            "wasted_spend": float(t_spend[treated & (t_tau <= 0.01)].sum()),
        })
    return out


def optimise(df: pd.DataFrame, p0: np.ndarray, tau: dict[int, np.ndarray], budget: float,
             margin: float = config.GROSS_MARGIN, objective: str = "profit",
             cost_basis: str = "redemption", truth: dict | None = None,
             sigma: dict[int, np.ndarray] | None = None, risk_aversion: float = 0.0) -> dict:
    aov = df["avg_order_value"].values if "avg_order_value" in df else np.full(len(df), 60.0)
    value, cost = option_table(p0, tau, aov, margin, objective, cost_basis)
    if sigma is not None and risk_aversion > 0:
        robust_tau = {k: tau[k] - risk_aversion * sigma[k] for k in ARMS}
        plan_value, _ = option_table(p0, robust_tau, aov, margin, objective, cost_basis)
    else:
        plan_value = value
    sol = solve_milp(plan_value, cost, budget)

    strategies = []
    for key, label in STRATEGIES.items():
        ch = sol["choice"] if key == "causal_optimizer" else heuristic_choice(key, value, cost, p0, budget)
        res = evaluate(ch, value, cost, p0, tau, aov, margin, truth)
        res.update({"key": key, "label": label})
        strategies.append(res)

    max_b = float(max(budget * 3, cost.max(axis=1).sum() * 0.6, 1.0))
    budgets = np.linspace(0, max_b, 41)
    return {
        "choice": sol["choice"],
        "value": value,
        "cost": cost,
        "status": sol["status"],
        "solve_seconds": sol["solve_seconds"],
        "candidates": sol["candidates"],
        "strategies": strategies,
        "frontier": frontier(plan_value, cost, budgets),
    }
