# EconoCausal: Project Report

**Domain:** Economics & Causal AI · **Track:** Infotact Advanced Data Science & ML Engineering, Vol. II, Project 2

## 1. Problem

Predictive models learn correlations. A churn model ranks customers by how likely they are to leave. But the business question is causal: *how much does a discount change this customer's behaviour?* Two failure modes waste money:

- **Sure Things** buy anyway. Their coupon is a pure margin give-away.
- **Sleeping Dogs** respond negatively, because a discount cheapens the brand for premium shoppers.

Only **Persuadables**, customers who buy *because of* the offer, generate incremental profit.

## 2. Data: a structural causal model

Real campaign logs never reveal counterfactuals, so the default dataset comes from a structural causal model (`backend/causal/data.py`):

- **X:** 14 customer covariates (recency, frequency, order value, engagement, loyalty, device, region, …)
- **T ∈ {$0, $10, $20}:** assigned by a *biased historical policy*. Lapsing customers and cart abandoners received larger discounts. The `confounding` parameter (γ) scales this bias, and γ = 0 gives a randomised trial.
- **Y:** purchase within 14 days, from potential outcomes p₀(x), p₁₀(x), p₂₀(x)
- **Effect heterogeneity:** driven by a latent price sensitivity (mostly explained by observables), an engagement gate, and a brand-sensitivity penalty that creates Sleeping Dogs. The $20 arm has diminishing returns.

Because the true τ(x) is stored in hidden `true_*` columns, every estimator can be graded against the oracle. Uploaded CSVs work identically, minus the oracle metrics.

## 3. Week 1: Causal graphing (DoWhy)

The DAG encodes domain knowledge:

- **Confounders** {recency, frequency, cart abandons, loyalty} affect both T and Y.
- **Outcome drivers / effect modifiers** affect Y only.
- **Price sensitivity** is a dashed latent node.

`CausalModel.identify_effect` returns the back-door estimand with exactly the confounder set. The dashboard renders the graph interactively and highlights back-door paths.

**Why naive analysis fails:** raw conversion for the $20 group is barely above control, so the naive estimate is +6 pts. Its true effect is +16 pts. The discount looks weak only because it was aimed at customers who were unlikely to buy.

## 4. Propensity score pipelines

A multinomial logistic model estimates the generalised propensity e_k(x) = P(T = k | x). For each arm against control, the pipeline computes:

- the conditional propensity, used for **IPW (Hájek)** and **1:1 nearest-neighbour matching** on the logit with a 0.2·σ caliper
- the **standardised mean difference** for each covariate (love plot). Max |SMD| falls from about 1.1 to ≤ 0.05 after weighting.
- overlap histograms and effective sample size, as positivity diagnostics

## 5. Week 2: Double machine learning (EconML)

The model is **Y − m(X) = θ(X)·(T − e(X)) + ε**. The nuisances m and e are cross-fitted LightGBM models (3 folds). Neyman orthogonality makes θ(X) first-order insensitive to nuisance errors.

| Estimator | Final stage | Notes |
| :--- | :--- | :--- |
| `CausalForestDML` | honest generalised random forest | non-linear heterogeneity, pointwise CIs |
| `LinearDML` | linear in X | interpretable coefficients with CIs and p-values |
| `ForestDRLearner` | forest on doubly robust pseudo-outcomes | consistent if either nuisance model is correct |

**Champion/challenger.** All three are trained on a 70% split. The champion is the model with the highest **IPW Qini coefficient on the 30% hold-out**. This criterion uses only observed data, so it transfers to real campaign logs. Oracle metrics are reported alongside for transparency, never for selection:

- PEHE
- correlation with the true τ
- CI coverage
- sign accuracy

**Interpretability.** A depth-3 regression tree fitted to τ̂(x) turns the model into actionable rules. Example: *non-loyalty members with more than 1.5 cart abandons and AOV ≤ $78 gain about 20 pts from a $10 coupon.*

**Uplift evaluation.** Qini curves are IPW-weighted on the hold-out, which corrects for the biased assignment. They are compared against random targeting and against a traditional purchase-propensity ranking. Decile calibration compares predicted, IPW-observed and true uplift.

## 6. Mid-project causal audit (refutation)

Each check runs on the DoWhy-identified estimand, for both arms:

| Test | Expectation | Pass rule |
| :--- | :--- | :--- |
| Placebo treatment (permute T) | effect vanishes | |new| ≤ 25% of original |
| Random common cause | estimate stable | drift ≤ 15% |
| Data subset (80%) | estimate stable | drift ≤ 15% |
| Bootstrap resampling | estimate stable | drift ≤ 15% |
| Unobserved common cause | sign survives | sign preserved |

The default run passes 10/10. DoWhy's built-in bootstrap refuter took about 100 s, so it was replaced with a bootstrap that reuses the identified estimand. The whole battery now runs in about 30 s.

## 7. Week 3: Prescriptive optimisation (SciPy MILP)

For each customer i and arm k, with redemption cost c_ik = k · p̂_k(x_i) (coupons are paid by everyone who redeems, Sure Things included):

```
maximise   Σ v_ik x_ik           v_ik = τ̃_k(x_i) · AOV_i · margin − c_ik
s.t.       Σ_k x_ik ≤ 1          (one offer per customer)
           Σ c_ik x_ik ≤ Budget
           x_ik ∈ {0,1}
```

- **Solver.** HiGHS through `scipy.optimize.milp`. Options with non-positive value are pre-pruned, which typically leaves about 3–5k candidates, and the solve takes under 3 s.
- **Risk adjustment (winner's curse).** Maximising noisy predictions selects customers whose effect is over-estimated. Planning on τ̃ = τ̂ − λσ̂, with σ̂ taken from each estimator's CI, raised true profit by about $1,000–1,400 at λ = 1 across all three estimators in testing.
- **Frontier.** The LP relaxation of this multiple-choice knapsack is solved exactly by sorting the convex-hull increments of every customer's option set. One sort yields the entire profit-vs-budget curve. A unit test checks that the MILP reaches ≥ 97% of this bound.
- **Benchmarks** (same budget): uplift ranking ($10 only), traditional ML (highest purchase propensity), blanket $10 and blanket $20. On synthetic data, each strategy is scored with oracle profit and wasted spend.

## 8. Week 4: API, drift detection, polish

- **FastAPI.** The pipeline runs in a background thread with staged progress. Results are swapped in atomically, and refutation and comparison run as background jobs. Endpoints cover CSV upload, template download, a paginated and filterable allocation table, and CSV export.
- **Drift detector.** PSI on reference deciles (warn ≥ 0.10, alert ≥ 0.25), two-sample KS tests, and PSI of the predicted-uplift distribution. Scenarios: stable, competitor price war, churn wave, new market launch. Each one produces a retrain recommendation.
- **Natural-language summaries.** Examples: *"This strategy earns $6,551 more than blanket $10 targeting with the same budget."* and *"The traditional model would spend $1,732 on customers who would have bought anyway…"*

## 9. Limitations & extensions

- Unconfoundedness is untestable. The sensitivity refuter bounds, but cannot eliminate, the risk of hidden confounding.
- The outcome is binary and modelled on the probability scale. Extensions: revenue outcomes, multi-period (dynamic) treatment, and a budget split across channels.
- Policy learning (`econml.policy.DRPolicyTree`) could replace the post-hoc rule tree.
