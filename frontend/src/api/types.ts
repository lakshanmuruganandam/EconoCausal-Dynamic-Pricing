export type Arm = 10 | 20
export type ArmKey = '10' | '20'
export type Segment = 'Persuadables' | 'Sure Things' | 'Lost Causes' | 'Sleeping Dogs'

export interface RunInfo {
  n: number
  source: string
  estimator: string
  model: string
  seed: number
  confounding: number
  oracle: boolean
  created_at: number
  timings: Record<string, number>
}

export interface Status {
  state: 'idle' | 'running' | 'ready' | 'error'
  stage: string | null
  stage_index: number
  stages: string[]
  message: string
  error: string | null
  started_at: number | null
  finished_at: number | null
  refutation: string
  comparison: string
  run?: RunInfo
}

export interface Interval {
  value: number
  lower: number
  upper: number
  stderr: number | null
}

export interface Effect {
  arm: Arm
  naive: number
  ipw: number
  psm_att: number
  dml: Interval
  truth: number | null
  story: string
}

export interface SegmentRow {
  segment: Segment
  count: number
  share: number
  avg_uplift: number
  avg_baseline: number
}

export interface Report {
  kpis: {
    customers: number
    conversion_rate: number
    ate_10: Interval
    ate_20: Interval
    persuadable_share: number
    optimised_profit: number
    uplift_vs_blanket: number
    uplift_vs_response: number
    roi: number
    budget: number
    qini_10: number
    normalized_qini_10: number | null
    refutation: string | null
    drift: string | null
  }
  effects: Effect[]
  narrative: string[]
  segments: SegmentRow[]
  metric_basis: 'oracle' | 'predicted'
}

export interface FeatureSummary {
  feature: string
  label: string
  mean: number
  std: number
  min: number
  max: number
  binary: boolean
  hist: number[]
  edges: number[]
  mean_by_arm: Record<string, number>
}

export interface DataSummary {
  rows: number
  train_rows: number
  test_rows: number
  conversion_rate: number
  avg_order_value: number
  arms: { arm: number; count: number; share: number; conversion: number }[]
  features: FeatureSummary[]
  source: string
  oracle: boolean
}

export interface GraphNode {
  id: string
  label: string
  role: 'treatment' | 'outcome' | 'confounder' | 'modifier' | 'latent'
}
export interface GraphEdge {
  source: string
  target: string
  kind: 'causal' | 'latent' | 'modifier'
}
export interface Graph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  adjustment_set: string[]
}

export interface Identification {
  estimand_type: string
  method: string
  backdoor_variables: string[]
  expression: string
  assumptions: string[]
}

export interface BalanceRow {
  feature: string
  label: string
  raw: number
  weighted: number
  matched: number | null
}
export interface PropensityArm {
  arm: Arm
  n_treated: number
  n_control: number
  n_matched: number
  match_rate: number
  naive_effect: number
  ipw_effect: number
  psm_att: number
  effective_sample_size: { treated: number; control: number }
  overlap: { bins: number[]; treated: number[]; control: number[]; share_extreme: number }
  balance: BalanceRow[]
  max_abs_smd_raw: number
  max_abs_smd_weighted: number
}

export interface Rule {
  conditions: string[]
  n: number
  share: number
  cate: number
}
export interface OracleMetrics {
  pehe: number
  correlation: number
  ate_bias: number
  ci_coverage: number
  sign_accuracy: number
}
export interface ModelSummary {
  estimator: string
  label: string
  family: string
  summary: string
  fit_seconds: number
  ate: Record<ArmKey, Interval>
  importance: { feature: string; label: string; importance: number }[]
  coefficients: { arm: Arm; feature: string; label: string; coef: number; lower: number; upper: number; p_value: number }[] | null
  rules: Record<ArmKey, Rule[]>
  oracle: Record<ArmKey, OracleMetrics> | null
}

export interface Distribution {
  bins: number[]
  arms: Record<ArmKey, {
    hist: number[]
    mean: number
    median: number
    p10: number
    p90: number
    share_positive: number
    share_significant: number
    share_negative: number
  }>
}

export interface Scatter {
  feature: string
  label: string
  arm: Arm
  x: number[]
  ite: number[]
  lower: number[]
  upper: number[]
  segment: Segment[]
  true?: number[]
}

export interface CompareModel {
  name: string
  label: string
  family: string
  summary: string
  fit_seconds: number
  arms: Record<ArmKey, Partial<OracleMetrics> & { ate: number; qini: number; normalized_qini: number | null }>
}
export interface Compare {
  status: string
  active: string
  result: {
    models: CompareModel[]
    selection: { criterion: string; scores: Record<string, number>; champion: string } | null
  } | null
}

export interface QiniArm {
  arm: Arm
  n: number
  fraction: number[]
  curves: { causal_model: number[]; response_model: number[]; random: number[] }
  true_curves?: { causal_model: number[]; response_model: number[]; perfect: number[]; random: number[] }
  qini_coefficient: number
  qini_response: number
  normalized_qini?: number
  normalized_qini_response?: number
  total_incremental: number
}
export interface Decile {
  decile: number
  predicted: number
  observed: number | null
  true: number | null
  n: number
}
export interface Uplift {
  arms: Record<ArmKey, QiniArm>
  deciles: Record<ArmKey, Decile[]>
  segments: {
    segments: SegmentRow[]
    confusion?: { labels: Segment[]; matrix: number[][]; accuracy: number }
  }
  oracle: boolean
}

export interface RefutationTest {
  key: string
  label: string
  description: string
  original: number
  new_effect: number | null
  p_value: number | null
  passed: boolean
  note: string
}
export interface Refutation {
  status: string
  result: {
    arms: { arm: Arm; estimate: number; method: string; n: number; tests: RefutationTest[] }[]
    passed: number
    total: number
    verdict: 'PASS' | 'PARTIAL' | 'FAIL'
  } | null
}

export interface Strategy {
  key: string
  label: string
  customers_targeted: number
  offers: Record<string, number>
  predicted_profit: number
  predicted_spend: number
  predicted_incremental_conversions: number
  predicted_roi: number
  true_profit?: number
  true_spend?: number
  true_incremental_conversions?: number
  true_roi?: number
  wasted_spend?: number
}
export interface OptimiseParams {
  budget: number
  margin: number
  objective: 'profit' | 'revenue' | 'conversions'
  cost_basis: 'redemption' | 'issued'
  risk_aversion: number
}
export interface Optimisation {
  params: OptimiseParams
  status: string
  solve_seconds: number
  candidates: number
  strategies: Strategy[]
  frontier: { budget: number; value: number }[]
  narrative: string[]
  oracle: boolean
}
export interface AllocationRow {
  customer_id: string
  segment: Segment
  discount: number
  baseline_prob: number
  uplift_10: number
  uplift_20: number
  uplift: number
  uplift_lower: number | null
  expected_cost: number
  expected_profit: number
  avg_order_value: number
}
export interface Allocation {
  total: number
  page: number
  size: number
  rows: AllocationRow[]
}

export interface DriftFeature {
  feature: string
  label: string
  psi: number
  ks_pvalue: number | null
  ref_mean: number
  cur_mean: number
  mean_shift: number
  level: 'ok' | 'warn' | 'alert'
}
export interface Drift {
  scenario?: string
  features: DriftFeature[]
  n_reference: number
  n_current: number
  drifted: string[]
  warnings: string[]
  prediction?: {
    psi: number
    level: 'ok' | 'warn' | 'alert'
    ref_mean: number
    cur_mean: number
    bins: number[]
    ref_hist: number[]
    cur_hist: number[]
  }
  status: 'ok' | 'warn' | 'alert'
  recommendation: string
}
export interface Scenario {
  key: string
  label: string
  description: string
}
