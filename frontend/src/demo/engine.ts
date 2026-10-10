/**
 * Static demo engine (GitHub Pages build, VITE_DEMO=1).
 *
 * Every read-only API response was snapshotted by `backend/export_static.py`.
 * Interactive endpoints are re-implemented here in the browser:
 *   - budget optimisation: exact LP relaxation of the multiple-choice knapsack
 *     (convex-hull greedy), integer-rounded — the same model as the SciPy MILP
 *   - allocation table / Sankey / CSV export from per-customer arrays
 *   - What-If Lab: Linear DML is linear in X, so τ(x) is reproduced exactly
 */
import type { Segment } from '../api/types'

const BASE = import.meta.env.BASE_URL
const ARMS = [10, 20] as const
const SEGMENTS: Segment[] = ['Persuadables', 'Sure Things', 'Lost Causes', 'Sleeping Dogs']

export class DemoError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Must match `slug()` in backend/export_static.py. */
export const demoFile = (path: string) => path.replace(/^\//, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') + '.json'

const cache = new Map<string, Promise<unknown>>()
function load<T>(file: string): Promise<T> {
  if (!cache.has(file)) {
    cache.set(
      file,
      fetch(`${BASE}demo/${file}`).then((r) => {
        if (!r.ok) throw new DemoError(404, `Not available in the static demo (${file})`)
        return r.json()
      }),
    )
  }
  return cache.get(file) as Promise<T>
}

/* ── data shapes ───────────────────────────────────────────────────────── */

interface Customers {
  id: string[]
  segment: number[]
  p0: number[]
  tau10: number[]
  tau20: number[]
  sig10: number[]
  sig20: number[]
  aov: number[]
  discount: number[]
  purchased: number[]
  region: number[]
  true0?: number[]
  true10?: number[]
  true20?: number[]
  [feature: string]: number[] | string[] | undefined
}

interface Linear {
  intercept: number
  coef: number[]
}

interface LabModel {
  features: string[]
  tau: Record<'10' | '20', Linear>
  sigma: Record<'10' | '20', Linear>
  p0_logit: Linear
  tau10_sorted: number[]
  meta: { feature: string; label: string; min: number; max: number; step: number; binary: boolean; median: number }[]
  regions: string[]
  margin: number
  risk_aversion: number
  budget: number
}

interface Params {
  budget: number
  margin: number
  objective: 'profit' | 'revenue' | 'conversions'
  cost_basis: 'redemption' | 'issued'
  risk_aversion: number
}

/* ── optimiser ─────────────────────────────────────────────────────────── */

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function optionTable(c: Customers, tau: Record<number, number[]>, p: Params) {
  const n = c.p0.length
  const value = [new Float64Array(n), new Float64Array(n)]
  const cost = [new Float64Array(n), new Float64Array(n)]
  ARMS.forEach((k, j) => {
    for (let i = 0; i < n; i++) {
      const pk = Math.min(1, Math.max(0, c.p0[i] + tau[k][i]))
      const cst = p.cost_basis === 'redemption' ? k * pk : k
      cost[j][i] = cst
      value[j][i] =
        p.objective === 'revenue' ? tau[k][i] * c.aov[i] : p.objective === 'conversions' ? tau[k][i] : tau[k][i] * c.aov[i] * p.margin - cst
    }
  })
  return { value, cost }
}

interface Inc {
  i: number
  to: number // option index reached (1 = $10, 2 = $20)
  dc: number
  dv: number
  eff: number
}

/** Upper-concave-hull increments per customer (multiple-choice knapsack LP). */
function increments(value: Float64Array[], cost: Float64Array[]): Inc[] {
  const out: Inc[] = []
  const n = value[0].length
  for (let i = 0; i < n; i++) {
    const pts = [{ c: 0, v: 0, o: 0 }]
    for (let j = 0; j < 2; j++) if (value[j][i] > 0) pts.push({ c: cost[j][i], v: value[j][i], o: j + 1 })
    if (pts.length === 1) continue
    pts.sort((a, b) => a.c - b.c)
    const hull = [pts[0]]
    for (const q of pts.slice(1)) {
      if (q.v <= hull[hull.length - 1].v) continue
      while (hull.length >= 2) {
        const a = hull[hull.length - 2]
        const b = hull[hull.length - 1]
        if ((b.v - a.v) * (q.c - a.c) <= (q.v - a.v) * (b.c - a.c)) hull.pop()
        else break
      }
      hull.push(q)
    }
    for (let h = 1; h < hull.length; h++) {
      const dc = Math.max(hull[h].c - hull[h - 1].c, 1e-9)
      const dv = hull[h].v - hull[h - 1].v
      out.push({ i, to: hull[h].o, dc, dv, eff: dv / dc })
    }
  }
  return out.sort((a, b) => b.eff - a.eff)
}

function solve(incs: Inc[], n: number, budget: number) {
  const choice = new Int8Array(n)
  const blocked = new Uint8Array(n)
  let spent = 0
  for (const inc of incs) {
    if (blocked[inc.i]) continue
    if (spent + inc.dc <= budget) {
      spent += inc.dc
      choice[inc.i] = inc.to
    } else blocked[inc.i] = 1 // later (less efficient) upgrades of this customer are skipped too
  }
  return choice
}

function frontier(incs: Inc[], budgets: number[]) {
  let cc = 0
  let cv = 0
  const cum = incs.map((x) => ((cc += x.dc), (cv += x.dv), [cc, cv, x.eff]))
  return budgets.map((b) => {
    let lo = 0
    let hi = cum.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (cum[mid][0] <= b) lo = mid + 1
      else hi = mid
    }
    let val = lo > 0 ? cum[lo - 1][1] : 0
    if (lo < cum.length) val += (b - (lo > 0 ? cum[lo - 1][0] : 0)) * cum[lo][2]
    return { budget: b, value: val }
  })
}

function fillBudget(order: number[], cost: Float64Array, budget: number, n: number, opt: number) {
  const choice = new Int8Array(n)
  let cum = 0
  for (const i of order) {
    cum += cost[i]
    if (cum > budget) break
    choice[i] = opt
  }
  return choice
}

const STRATEGIES: [string, string][] = [
  ['causal_optimizer', 'Causal optimiser (MILP)'],
  ['uplift_rank', 'Uplift ranking, $10 only'],
  ['response_model', 'Traditional ML (purchase propensity)'],
  ['blanket_10', 'Blanket $10 (random)'],
  ['blanket_20', 'Blanket $20 (random)'],
]

function evaluate(choice: Int8Array, value: Float64Array[], cost: Float64Array[], c: Customers, p: Params) {
  const n = choice.length
  let targeted = 0
  const offers = { $10: 0, $20: 0 }
  let pv = 0
  let pc = 0
  let pconv = 0
  let tProfit = 0
  let tSpend = 0
  let tConv = 0
  let waste = 0
  const truth = c.true0 && c.true10 && c.true20
  for (let i = 0; i < n; i++) {
    const ch = choice[i]
    if (!ch) continue
    targeted++
    offers[ch === 1 ? '$10' : '$20']++
    pv += value[ch - 1][i]
    pc += cost[ch - 1][i]
    pconv += ch === 1 ? c.tau10[i] : c.tau20[i]
    if (truth) {
      const k = ch === 1 ? 10 : 20
      const pk = (ch === 1 ? c.true10! : c.true20!)[i]
      const tt = pk - c.true0![i]
      const spend = k * pk
      tProfit += tt * c.aov[i] * p.margin - spend
      tSpend += spend
      tConv += tt
      if (tt <= 0.01) waste += spend
    }
  }
  const out: Record<string, unknown> = {
    customers_targeted: targeted,
    offers,
    predicted_profit: pv,
    predicted_spend: pc,
    predicted_incremental_conversions: pconv,
    predicted_roi: pc > 0 ? pv / pc : 0,
  }
  if (truth)
    Object.assign(out, {
      true_profit: tProfit,
      true_spend: tSpend,
      true_incremental_conversions: tConv,
      true_roi: tSpend > 0 ? tProfit / tSpend : 0,
      wasted_spend: waste,
    })
  return out
}

const money = (x: number) => `${x < 0 ? '-' : ''}$${Math.round(Math.abs(x)).toLocaleString('en-US')}`

function narrative(strats: Record<string, Record<string, number | Record<string, number>>>, budget: number, segs: { segment: string; share: number }[]) {
  const opt = strats.causal_optimizer
  const metric = 'true_profit' in opt ? 'true_profit' : 'predicted_profit'
  const offers = opt.offers as Record<string, number>
  const lines = [
    `With a ${money(budget)} budget the causal optimiser targets ${(opt.customers_targeted as number).toLocaleString()} customers (${offers.$10.toLocaleString()} × $10, ${offers.$20.toLocaleString()} × $20) for an expected ${money(opt[metric] as number)} incremental profit.`,
  ]
  for (const [key, name] of [
    ['blanket_10', 'blanket $10 targeting'],
    ['response_model', 'the traditional purchase-propensity model'],
  ]) {
    const diff = (opt[metric] as number) - (strats[key][metric] as number)
    if (diff > 0) lines.push(`This strategy earns ${money(diff)} more than ${name} with the same budget.`)
  }
  if ('wasted_spend' in strats.response_model)
    lines.push(
      `The traditional model would spend ${money(strats.response_model.wasted_spend as number)} on customers who would have bought anyway or do not respond, versus ${money(opt.wasted_spend as number)} for the causal optimiser.`,
    )
  const sure = segs.find((s) => s.segment === 'Sure Things')
  if (sure && sure.share > 0) lines.push(`${Math.round(sure.share * 100)}% of customers are Sure Things – they buy without a coupon, so they are excluded.`)
  return lines
}

interface Solved {
  params: Params
  choice: Int8Array
  value: Float64Array[]
  cost: Float64Array[]
  payload: Record<string, unknown>
}
let solved: Solved | null = null

async function optimise(params?: Partial<Params>): Promise<Solved> {
  const [c, m, up] = await Promise.all([
    load<Customers>('customers.json'),
    load<LabModel>('lab_model.json'),
    load<{ segments: { segments: { segment: string; share: number }[] } }>(demoFile('/api/uplift')),
  ])
  const p: Params = {
    budget: m.budget,
    margin: m.margin,
    objective: 'profit',
    cost_basis: 'redemption',
    risk_aversion: m.risk_aversion,
    ...solved?.params,
    ...params,
  }
  const t0 = performance.now()
  const n = c.p0.length
  const { value, cost } = optionTable(c, { 10: c.tau10, 20: c.tau20 }, p)
  const plan =
    p.risk_aversion > 0
      ? optionTable(c, { 10: c.tau10.map((t, i) => t - p.risk_aversion * c.sig10[i]), 20: c.tau20.map((t, i) => t - p.risk_aversion * c.sig20[i]) }, p).value
      : value
  const incs = increments(plan, cost)
  const choice = solve(incs, n, p.budget)
  const rand = mulberry32(0)
  const perm = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[perm[i], perm[j]] = [perm[j], perm[i]]
  }
  const byP0 = Array.from({ length: n }, (_, i) => i).sort((a, b) => c.p0[b] - c.p0[a])
  const byV10 = Array.from({ length: n }, (_, i) => i).sort((a, b) => value[0][b] - value[0][a])
  const choices: Record<string, Int8Array> = {
    causal_optimizer: choice,
    uplift_rank: fillBudget(byV10, cost[0], p.budget, n, 1),
    response_model: fillBudget(byP0, cost[0], p.budget, n, 1),
    blanket_10: fillBudget(perm, cost[0], p.budget, n, 1),
    blanket_20: fillBudget(perm, cost[1], p.budget, n, 2),
  }
  const byKey: Record<string, Record<string, number | Record<string, number>>> = {}
  const strategies = STRATEGIES.map(([key, label]) => {
    const r = evaluate(choices[key], value, cost, c, p) as Record<string, number | Record<string, number>>
    byKey[key] = r
    return { key, label, ...r }
  })
  let maxCost = 0
  for (let i = 0; i < n; i++) maxCost += Math.max(cost[0][i], cost[1][i])
  const maxB = Math.max(p.budget * 3, maxCost * 0.6, 1)
  const budgets = Array.from({ length: 41 }, (_, i) => (maxB * i) / 40)
  const payload = {
    params: p,
    status: 'optimal',
    solve_seconds: (performance.now() - t0) / 1000,
    candidates: new Set(incs.map((x) => x.i)).size,
    strategies,
    frontier: frontier(incs, budgets),
    narrative: narrative(byKey, p.budget, up.segments.segments),
    oracle: !!c.true0,
  }
  solved = { params: p, choice, value, cost, payload }
  return solved
}

async function current() {
  return solved ?? optimise()
}

async function allocationRows() {
  const [c, s] = await Promise.all([load<Customers>('customers.json'), current()])
  return c.id.map((id, i) => {
    const ch = s.choice[i]
    const best = c.tau20[i] > c.tau10[i] ? 20 : 10
    const tau = ch ? (ch === 1 ? c.tau10[i] : c.tau20[i]) : best === 20 ? c.tau20[i] : c.tau10[i]
    const sig = ch === 1 ? c.sig10[i] : c.sig20[i]
    return {
      customer_id: id,
      segment: SEGMENTS[c.segment[i]],
      discount: ch === 1 ? 10 : ch === 2 ? 20 : 0,
      baseline_prob: c.p0[i],
      uplift_10: c.tau10[i],
      uplift_20: c.tau20[i],
      uplift: tau,
      uplift_lower: ch ? tau - 1.96 * sig : null,
      expected_cost: ch ? s.cost[ch - 1][i] : 0,
      expected_profit: ch ? s.value[ch - 1][i] : 0,
      avg_order_value: c.aov[i],
    }
  })
}

type Row = Awaited<ReturnType<typeof allocationRows>>[number]

async function allocation(q: URLSearchParams) {
  let rows = await allocationRows()
  const search = q.get('search') ?? ''
  const discount = q.get('discount') ?? 'all'
  const segment = q.get('segment') ?? 'all'
  const sort = (q.get('sort') ?? 'expected_profit') as keyof Row
  const page = Number(q.get('page') ?? 1)
  const size = Number(q.get('size') ?? 25)
  if (search) rows = rows.filter((r) => r.customer_id.toLowerCase().includes(search.toLowerCase()))
  if (discount !== 'all') rows = rows.filter((r) => r.discount === Number(discount))
  if (segment !== 'all') rows = rows.filter((r) => r.segment === segment)
  const dir = q.get('order') === 'asc' ? 1 : -1
  rows.sort((a, b) => dir * (((a[sort] as number) ?? -Infinity) - ((b[sort] as number) ?? -Infinity)))
  return { total: rows.length, page, size, rows: rows.slice((page - 1) * size, page * size) }
}

export async function downloadAllocationCsv() {
  const rows = (await allocationRows()).filter((r) => r.discount > 0).sort((a, b) => b.expected_profit - a.expected_profit)
  const cols = Object.keys(rows[0] ?? { customer_id: '' }) as (keyof Row)[]
  const csv = [cols.join(','), ...rows.map((r) => cols.map((k) => (typeof r[k] === 'number' ? (r[k] as number).toFixed(5) : (r[k] ?? ''))).join(','))].join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'econocausal_prescription.csv'
  a.click()
  URL.revokeObjectURL(url)
}

async function flow() {
  const [c, s] = await Promise.all([load<Customers>('customers.json'), current()])
  const offers = ['No offer', '$10 offer', '$20 offer']
  const agg = new Map<string, { customers: number; spend: number; profit: number }>()
  let spend = 0
  let profit = 0
  for (let i = 0; i < c.id.length; i++) {
    const ch = s.choice[i]
    const key = `${c.segment[i]}|${ch}`
    const e = agg.get(key) ?? { customers: 0, spend: 0, profit: 0 }
    e.customers++
    if (ch) {
      e.spend += s.cost[ch - 1][i]
      e.profit += s.value[ch - 1][i]
      spend += s.cost[ch - 1][i]
      profit += s.value[ch - 1][i]
    }
    agg.set(key, e)
  }
  const links = [...agg.entries()].map(([k, v]) => {
    const [seg, ch] = k.split('|').map(Number)
    return { source: SEGMENTS[seg], target: offers[ch], ...v }
  })
  return { segments: SEGMENTS, offers, links, budget: s.params.budget, spend, profit }
}

/* ── What-If Lab ───────────────────────────────────────────────────────── */

type Profile = Record<string, number | string>

function profileOf(c: Customers, m: LabModel, i: number) {
  const prof: Profile = {}
  for (const f of m.meta) prof[f.feature] = (c[f.feature] as number[])[i]
  prof.region = m.regions[c.region[i]]
  return {
    customer_id: c.id[i],
    profile: prof,
    segment: SEGMENTS[c.segment[i]],
    features: m.meta,
    regions: m.regions,
    actual: { discount: c.discount[i], purchased: c.purchased[i] },
  }
}

const vec = (m: LabModel, p: Profile) =>
  m.features.map((f) => (f.startsWith('region_') ? (p.region === f.slice(7) ? 1 : 0) : Number(p[f])))
const lin = (l: Linear, x: number[]) => l.intercept + l.coef.reduce((s, b, j) => s + b * x[j], 0)
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z))
const logit = (p: number) => Math.log(p / (1 - p))

async function labProfile(q: URLSearchParams) {
  const persona = q.get('persona')
  if (persona) return load(demoFile(`/api/lab/profile?persona=${encodeURIComponent(persona)}`))
  const [c, m] = await Promise.all([load<Customers>('customers.json'), load<LabModel>('lab_model.json')])
  let i: number
  const id = q.get('customer_id')
  if (id) {
    i = c.id.indexOf(id)
    if (i < 0) throw new DemoError(404, `customer '${id}' not found`)
  } else i = Math.floor(mulberry32(Number(q.get('seed') ?? 0))() * c.id.length)
  return profileOf(c, m, i)
}

async function labPredict(body: { profile: Profile; sweep: string; customer_id?: string; margin?: number; risk_aversion?: number }) {
  const [c, m] = await Promise.all([load<Customers>('customers.json'), load<LabModel>('lab_model.json')])
  const margin = body.margin ?? m.margin
  const lam = body.risk_aversion ?? m.risk_aversion
  const x = vec(m, body.profile)

  // p0: anchor at the customer's exact model value, move with the logit surrogate
  const anchor = body.customer_id ? c.id.indexOf(body.customer_id) : -1
  const p0At = (xv: number[]) => {
    if (anchor < 0) return sigmoid(lin(m.p0_logit, xv))
    const xa = vec(m, profileOf(c, m, anchor).profile)
    const shift = lin(m.p0_logit, xv) - lin(m.p0_logit, xa)
    return sigmoid(logit(Math.min(0.999, Math.max(0.001, c.p0[anchor]))) + shift)
  }
  const tauAt = (a: '10' | '20', xv: number[]) => lin(m.tau[a], xv)
  const p0 = p0At(x)
  const arms: Record<string, Record<string, number>> = {}
  let bestArm = 0
  let bestVal = 0
  for (const a of ['10', '20'] as const) {
    const k = Number(a)
    const tau = tauAt(a, x)
    const sig = Math.max(0.003, lin(m.sigma[a], x))
    const pw = Math.min(1, Math.max(0, p0 + tau))
    const cost = k * pw
    const aov = Number(body.profile.avg_order_value)
    const val = tau * aov * margin - cost
    const robust = (tau - lam * sig) * aov * margin - k * Math.min(1, Math.max(0, p0 + tau - lam * sig))
    arms[a] = { tau, lower: tau - 1.96 * sig, upper: tau + 1.96 * sig, p_with: pw, expected_profit: val, expected_cost: cost, risk_adjusted_profit: robust }
    if (robust > bestVal) {
      bestVal = robust
      bestArm = k
    }
  }
  const meta = Object.fromEntries(m.meta.map((f) => [f.feature, f]))
  const sm = meta[body.sweep]
  const grid = sm.binary ? [0, 1] : Array.from({ length: 30 }, (_, i) => sm.min + ((sm.max - sm.min) * i) / 29)
  const curve = { x: grid, p0: [] as number[], '10': [] as number[], '20': [] as number[] }
  for (const g of grid) {
    const xv = vec(m, { ...body.profile, [body.sweep]: g })
    curve.p0.push(p0At(xv))
    curve['10'].push(tauAt('10', xv))
    curve['20'].push(tauAt('20', xv))
  }
  const attribution = m.meta
    .map((f) => {
      const xv = vec(m, { ...body.profile, [f.feature]: f.median })
      return { feature: f.feature, label: f.label, value: Number(body.profile[f.feature]), median: f.median, delta: arms['10'].tau - tauAt('10', xv) }
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
  const t10 = arms['10'].tau
  const segment: Segment = t10 < -0.01 ? 'Sleeping Dogs' : t10 >= 0.07 ? 'Persuadables' : p0 >= 0.45 ? 'Sure Things' : 'Lost Causes'
  const sorted = m.tau10_sorted
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid] < t10) lo = mid + 1
    else hi = mid
  }
  return {
    p0,
    arms,
    recommendation: bestArm,
    segment,
    uplift_percentile: lo / sorted.length,
    curve,
    sweep: body.sweep,
    sweep_label: sm.label,
    attribution,
    model: 'linear_dml (in-browser)',
  }
}

/* ── router ────────────────────────────────────────────────────────────── */

let lastDrift: unknown = {}
const READ_ONLY =
  'This is the static GitHub Pages demo. Retraining, uploads and the refutation re-run need the Python backend: clone the repo and run it locally.'

export async function demoApi<T>(path: string, init?: RequestInit): Promise<T> {
  const [route, qs] = path.split('?')
  const q = new URLSearchParams(qs ?? '')
  const method = (init?.method ?? 'GET').toUpperCase()
  const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined

  if (method === 'POST') {
    if (route === '/api/optimize') return (await optimise(body)).payload as T
    if (route === '/api/lab/predict') return (await labPredict(body)) as T
    if (route === '/api/drift') {
      lastDrift = await load(`drift_${body?.scenario ?? 'price_war'}.json`)
      return lastDrift as T
    }
    throw new DemoError(403, READ_ONLY)
  }
  switch (route) {
    case '/api/status':
      return load<T>('status.json')
    case '/api/optimize':
      return (await current()).payload as T
    case '/api/optimize/allocation':
      return (await allocation(q)) as T
    case '/api/optimize/flow':
      return (await flow()) as T
    case '/api/lab/profile':
      return (await labProfile(q)) as T
    case '/api/drift':
      return lastDrift as T
    default:
      return load<T>(demoFile(path))
  }
}
