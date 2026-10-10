"""Plain-English summaries rendered in the dashboard."""
from __future__ import annotations


def money(x: float) -> str:
    sign = "-" if x < 0 else ""
    return f"{sign}${abs(x):,.0f}"


def pts(x: float) -> str:
    return f"{x * 100:+.1f} pts"


def effect_story(arm: int, naive: float, dml: dict, truth: float | None) -> str:
    s = (f"A ${arm} discount causally changes purchase probability by {pts(dml['value'])} "
         f"(95% CI {pts(dml['lower'])} to {pts(dml['upper'])}).")
    if abs(dml["value"]) > 1e-6:
        gap = (dml["value"] - naive) / abs(dml["value"])
        if abs(gap) > 0.15:
            word = "under-estimates" if naive < dml["value"] else "over-estimates"
            s += (f" A naive before/after comparison ({pts(naive)}) {word} the effect by "
                  f"{abs(gap):.0%} because historical targeting sent bigger discounts to customers who were already unlikely to buy.")
    if truth is not None:
        s += f" Ground truth for this simulation is {pts(truth)}."
    return s


def optimiser_story(strategies: list[dict], budget: float, segments: dict | None) -> list[str]:
    by_key = {s["key"]: s for s in strategies}
    opt = by_key["causal_optimizer"]
    metric = "true_profit" if "true_profit" in opt else "predicted_profit"
    lines = [
        f"With a {money(budget)} budget the causal optimiser targets {opt['customers_targeted']:,} customers "
        f"({opt['offers'].get('$10', 0):,} × $10, {opt['offers'].get('$20', 0):,} × $20) for an expected "
        f"{money(opt[metric])} incremental profit."
    ]
    for key, name in [("blanket_10", "blanket $10 targeting"), ("response_model", "the traditional purchase-propensity model")]:
        other = by_key.get(key)
        if other:
            diff = opt[metric] - other[metric]
            if diff > 0:
                lines.append(f"This strategy earns {money(diff)} more than {name} with the same budget.")
    if "wasted_spend" in by_key.get("response_model", {}):
        lines.append(f"The traditional model would spend {money(by_key['response_model']['wasted_spend'])} "
                     f"on customers who would have bought anyway or do not respond, versus "
                     f"{money(opt['wasted_spend'])} for the causal optimiser.")
    if segments:
        sure = next((s for s in segments["segments"] if s["segment"] == "Sure Things"), None)
        dogs = next((s for s in segments["segments"] if s["segment"] == "Sleeping Dogs"), None)
        if sure and sure["share"] > 0:
            lines.append(f"{sure['share']:.0%} of customers are Sure Things – they buy without a coupon, so they are excluded.")
        if dogs and dogs["share"] >= 0.005:
            lines.append(f"{dogs['share']:.0%} are Sleeping Dogs whose purchase probability drops when offered a discount.")
    return lines
