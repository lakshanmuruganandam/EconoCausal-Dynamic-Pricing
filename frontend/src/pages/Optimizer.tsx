import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, Search, Sparkles, Zap } from 'lucide-react'
import { api, exportAllocationCsv, post, useApi } from '../api/client'
import Counter from '../components/Counter'
import type { Allocation, Optimisation, OptimiseParams, Segment } from '../api/types'
import Plot from '../components/Plot'
import { Badge, Button, Card, CardHeader, Dot, ErrorBox, PageHeader, Segmented, Select, Skeleton, Slider, Spinner, Stat } from '../components/ui'
import { cx } from '../lib/cx'
import { fmtInt, fmtMoney, fmtMoneyCompact, fmtPct, fmtPts } from '../lib/format'
import { C, SEGMENT_COLOR, armColor, tc } from '../lib/theme'

const STRATEGY_COLOR: Record<string, string> = {
  causal_optimizer: C.arm10,
  uplift_rank: tc('#60a5fa'),
  response_model: C.legacy,
  blanket_10: tc('#7c859d'),
  blanket_20: tc('#5a6379'),
}

const SORTS = [
  { value: 'expected_profit', label: 'Expected profit' },
  { value: 'uplift', label: 'Uplift' },
  { value: 'baseline_prob', label: 'Baseline probability' },
  { value: 'expected_cost', label: 'Expected cost' },
  { value: 'avg_order_value', label: 'Order value' },
] as const

export default function Optimizer() {
  const initial = useApi<Optimisation>('/api/optimize')
  const [opt, setOpt] = useState<Optimisation | null>(null)
  const [params, setParams] = useState<OptimiseParams | null>(null)
  const [solving, setSolving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  const current = opt ?? initial.data
  const p = params ?? initial.data?.params ?? null

  const solve = useCallback(async (next: OptimiseParams) => {
    setSolving(true)
    setErr(null)
    try {
      const res = await post<Optimisation>('/api/optimize', next)
      setOpt(res)
      setVersion((v) => v + 1)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSolving(false)
    }
  }, [])

  const update = (patch: Partial<OptimiseParams>, commit = false) => {
    if (!p) return
    const next = { ...p, ...patch }
    setParams(next)
    if (commit) solve(next)
  }

  const metric = current?.oracle ? 'true_profit' : 'predicted_profit'
  const basisLabel = current?.oracle ? 'Ground-truth profit' : 'Predicted profit'

  const strategyChart = useMemo(() => {
    if (!current) return []
    const rows = [...current.strategies].reverse()
    return [
      {
        type: 'bar' as const,
        orientation: 'h' as const,
        y: rows.map((s) => s.label),
        x: rows.map((s) => s[metric] ?? 0),
        marker: { color: rows.map((s) => STRATEGY_COLOR[s.key]) },
        text: rows.map((s) => fmtMoney(s[metric] ?? 0)),
        textposition: rows.map((s) => ((s[metric] ?? 0) >= 0 ? 'outside' : 'inside')) as unknown as 'outside',
        insidetextanchor: 'start' as const,
        textfont: { family: 'JetBrains Mono', color: C.text, size: 12 },
        hovertemplate: '%{y}<br>%{x:$,.0f}<extra></extra>',
        cliponaxis: false,
      },
    ]
  }, [current, metric])

  const frontierChart = useMemo(() => {
    if (!current || !p) return []
    const opt = current.strategies.find((s) => s.key === 'causal_optimizer')!
    return [
      {
        type: 'scatter' as const,
        mode: 'lines' as const,
        name: 'Efficient frontier (LP bound)',
        x: current.frontier.map((f) => f.budget),
        y: current.frontier.map((f) => f.value),
        line: { color: C.arm10, width: 2.5, shape: 'spline' as const },
        fill: 'tozeroy' as const,
        fillcolor: tc('rgba(45,212,191,0.07)'),
        hovertemplate: 'budget %{x:$,.0f}<br>planned value %{y:$,.0f}<extra></extra>',
      },
      {
        type: 'scatter' as const,
        mode: 'markers' as const,
        name: 'Current plan (MILP)',
        x: [opt.predicted_spend],
        y: [current.frontier.reduce((best, f) => (Math.abs(f.budget - p.budget) < Math.abs(best.budget - p.budget) ? f : best)).value],
        marker: { color: tc('#eef0f6'), size: 12, line: { color: C.arm10, width: 3 } },
        hovertemplate: 'spend %{x:$,.0f}<extra></extra>',
      },
    ]
  }, [current, p])

  if (initial.error) return <ErrorBox message={initial.error} />
  if (!current || !p) return <Skeleton h={700} />

  const best = current.strategies.find((s) => s.key === 'causal_optimizer')!
  const blanket = current.strategies.find((s) => s.key === 'blanket_10')!
  const legacy = current.strategies.find((s) => s.key === 'response_model')!

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Week 3 · Prescriptive optimisation (SciPy MILP)"
        title="Budget allocation"
        description="A mixed-integer program picks one offer ($0, $10 or $20) per customer to maximise incremental profit within the budget. It plans on risk-adjusted effects (τ̂ − λσ̂) so noisy over-estimates do not win (the winner’s curse)."
      />

      <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
        <Card className="h-fit xl:sticky xl:top-20">
          <CardHeader title="Campaign constraints" subtitle="Drag a slider to re-solve" icon={<Zap size={15} />} />
          <div className="space-y-5">
            <Slider
              label="Marketing budget"
              value={p.budget}
              min={500}
              max={30000}
              step={250}
              onChange={(v) => update({ budget: v })}
              onCommit={() => solve({ ...p })}
              format={(v) => fmtMoney(v)}
            />
            <Slider
              label="Gross margin"
              value={p.margin}
              min={0.15}
              max={0.8}
              step={0.01}
              onChange={(v) => update({ margin: v })}
              onCommit={() => solve({ ...p })}
              format={(v) => fmtPct(v, 0)}
              hint="Share of each order’s value that is profit"
            />
            <Slider
              label="Risk aversion λ"
              value={p.risk_aversion}
              min={0}
              max={2.5}
              step={0.1}
              onChange={(v) => update({ risk_aversion: v })}
              onCommit={() => solve({ ...p })}
              format={(v) => (v === 0 ? 'off' : `${v.toFixed(1)}σ`)}
              hint="Plan on τ̂ − λσ̂. Higher values avoid customers whose uplift is uncertain."
            />
            <div>
              <div className="mb-1.5 text-[12.5px] font-medium text-fog-300">Objective</div>
              <Segmented
                size="sm"
                value={p.objective}
                onChange={(v) => update({ objective: v }, true)}
                options={[
                  { value: 'profit', label: 'Profit' },
                  { value: 'revenue', label: 'Revenue' },
                  { value: 'conversions', label: 'Conversions' },
                ]}
              />
            </div>
            <div>
              <div className="mb-1.5 text-[12.5px] font-medium text-fog-300">Coupon cost counted</div>
              <Segmented
                size="sm"
                value={p.cost_basis}
                onChange={(v) => update({ cost_basis: v }, true)}
                options={[
                  { value: 'redemption', label: 'On redemption' },
                  { value: 'issued', label: 'Per coupon issued' },
                ]}
              />
            </div>
            <div className="flex items-center justify-between rounded-xl bg-ink-950/60 px-3 py-2.5 text-[11.5px] text-fog-400">
              <span className="flex items-center gap-2">
                {solving ? <Spinner className="text-arm10" /> : <span className="h-2 w-2 rounded-full bg-emerald-400" />}
                HiGHS MILP · {current.status}
              </span>
              <span className="num">
                {fmtInt(current.candidates)} candidates · {current.solve_seconds.toFixed(2)}s
              </span>
            </div>
            {err && <ErrorBox message={err} />}
          </div>
        </Card>

        <div className={cx('space-y-6 transition-opacity', solving && 'opacity-60')}>
          <div className="grid grid-cols-2 gap-4 2xl:grid-cols-4">
            <Stat label={basisLabel} value={<Counter value={best[metric] ?? 0} format={fmtMoneyCompact} />} tone={(best[metric] ?? 0) > 0 ? 'good' : 'bad'} sub={`ROI ${fmtPct(best.true_roi ?? best.predicted_roi, 0)}`} accent={C.good} />
            <Stat label="Customers targeted" value={<Counter value={best.customers_targeted} format={fmtInt} />} sub={`${fmtInt(best.offers['$10'] ?? 0)} × $10 · ${fmtInt(best.offers['$20'] ?? 0)} × $20`} accent={C.arm10} />
            <Stat label="Expected spend" value={<Counter value={best.predicted_spend} format={fmtMoneyCompact} />} sub={`of ${fmtMoney(p.budget)} budget`} />
            <Stat
              label="Beats blanket $10 by"
              value={fmtMoneyCompact((best[metric] ?? 0) - (blanket[metric] ?? 0))}
              sub={`and traditional ML by ${fmtMoneyCompact((best[metric] ?? 0) - (legacy[metric] ?? 0))}`}
              tone="good"
              accent={C.legacy}
            />
          </div>

          <Card className="border-teal-400/15 bg-gradient-to-br from-teal-400/[0.06] to-transparent">
            <div className="flex gap-3">
              <Sparkles size={18} className="mt-0.5 shrink-0 text-arm10" />
              <div className="space-y-1.5 text-[13.5px] leading-relaxed text-fog-200">
                {current.narrative.map((n, i) => (
                  <p key={i} className={i === 0 ? 'font-medium text-fog-100' : undefined}>
                    {n}
                  </p>
                ))}
              </div>
            </div>
          </Card>

          <div className="grid gap-6 2xl:grid-cols-2">
            <Card>
              <CardHeader title="Strategy comparison" subtitle={`${basisLabel} for the same ${fmtMoney(p.budget)} budget`} />
              <Plot data={strategyChart} height={290} layout={{ margin: { l: 210, r: 70 }, xaxis: { title: 'Incremental profit ($)', tickprefix: '$' }, showlegend: false }} />
            </Card>
            <Card>
              <CardHeader title="Profit frontier" subtitle="Best achievable planned profit at every budget. Past the peak, extra coupons cost more than they earn." />
              <Plot data={frontierChart} height={290} layout={{ xaxis: { title: 'Budget ($)', tickprefix: '$' }, yaxis: { title: 'Planned profit ($)', tickprefix: '$' }, legend: { y: 1.18 } }} />
            </Card>
          </div>

          <Card pad={false}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-[12.5px]">
                <thead>
                  <tr className="border-b border-white/[0.06] text-[11px] uppercase tracking-wide text-fog-500">
                    <th className="px-5 py-3 font-medium">Strategy</th>
                    <th className="px-3 py-3 font-medium">Targeted</th>
                    <th className="px-3 py-3 font-medium">Spend</th>
                    <th className="px-3 py-3 font-medium">Predicted profit</th>
                    {current.oracle && <th className="px-3 py-3 font-medium">True profit</th>}
                    {current.oracle && <th className="px-3 py-3 font-medium">Incremental buyers</th>}
                    {current.oracle && <th className="px-3 py-3 font-medium">Wasted spend</th>}
                  </tr>
                </thead>
                <tbody>
                  {current.strategies.map((s) => (
                    <tr key={s.key} className={cx('border-b border-white/[0.04]', s.key === 'causal_optimizer' && 'bg-teal-400/[0.04]')}>
                      <td className="px-5 py-3">
                        <span className="flex items-center gap-2 font-medium text-fog-100">
                          <Dot color={STRATEGY_COLOR[s.key]} /> {s.label}
                        </span>
                      </td>
                      <td className="num px-3 py-3 text-fog-200">{fmtInt(s.customers_targeted)}</td>
                      <td className="num px-3 py-3 text-fog-200">{fmtMoney(s.predicted_spend)}</td>
                      <td className={cx('num px-3 py-3', s.predicted_profit >= 0 ? 'text-emerald-300' : 'text-rose-300')}>{fmtMoney(s.predicted_profit)}</td>
                      {current.oracle && <td className={cx('num px-3 py-3 font-semibold', (s.true_profit ?? 0) >= 0 ? 'text-emerald-300' : 'text-rose-300')}>{fmtMoney(s.true_profit ?? 0)}</td>}
                      {current.oracle && <td className="num px-3 py-3 text-fog-200">{fmtInt(s.true_incremental_conversions ?? 0)}</td>}
                      {current.oracle && <td className="num px-3 py-3 text-amber-200">{fmtMoney(s.wasted_spend ?? 0)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>

      <BudgetFlow version={version} />

      <AllocationTable version={version} />
    </div>
  )
}

interface Flow {
  segments: Segment[]
  offers: string[]
  links: { source: string; target: string; customers: number; spend: number; profit: number }[]
  budget: number
  spend: number
  profit: number
}

const OFFER_COLOR: Record<string, string> = { 'No offer': tc('#3a4560'), '$10 offer': C.arm10, '$20 offer': C.arm20 }

function hexA(hex: string, a: number) {
  const [r, g, b] = hex.match(/\w\w/g)!.map((h) => parseInt(h, 16))
  return `rgba(${r},${g},${b},${a})`
}

function BudgetFlow({ version }: { version: number }) {
  const { data } = useApi<Flow>(`/api/optimize/flow?v=${version}`)
  const sankey = useMemo(() => {
    if (!data) return []
    const nodes = [...data.segments, ...data.offers]
    const idx = Object.fromEntries(nodes.map((n, i) => [n, i]))
    return [
      {
        type: 'sankey' as const,
        arrangement: 'snap' as const,
        node: {
          label: nodes,
          color: nodes.map((n) => (n in SEGMENT_COLOR ? SEGMENT_COLOR[n as Segment] : OFFER_COLOR[n])),
          pad: 22,
          thickness: 18,
          line: { color: 'rgba(0,0,0,0)', width: 0 },
          hovertemplate: '%{label}<br>%{value:,} customers<extra></extra>',
        },
        link: {
          source: data.links.map((l) => idx[l.source]),
          target: data.links.map((l) => idx[l.target]),
          value: data.links.map((l) => l.customers),
          color: data.links.map((l) => hexA(l.target === 'No offer' ? tc('#3a4560') : SEGMENT_COLOR[l.source as Segment], l.target === 'No offer' ? 0.25 : 0.45)),
          customdata: data.links.map((l) => [l.spend, l.profit]),
          hovertemplate: '%{source.label} → %{target.label}<br>%{value:,} customers<br>spend $%{customdata[0]:,.0f} · profit $%{customdata[1]:,.0f}<extra></extra>',
        },
        textfont: { color: tc('#d5d9e5'), size: 12, family: 'Inter' },
      },
    ]
  }, [data])

  if (!data) return <Skeleton h={380} />
  const used = Math.min(1, data.spend / data.budget)
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
      <Card>
        <CardHeader title="Where the budget flows" subtitle="Customer segments → offers chosen by the optimiser. Persuadables get the coupons; Sure Things and Lost Causes are left alone." />
        <Plot data={sankey as never} height={360} layout={{ margin: { l: 8, r: 8, t: 8, b: 8 } }} />
      </Card>
      <Card className="flex flex-col items-center justify-center text-center">
        <div className="relative h-44 w-44">
          <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
            <circle cx="60" cy="60" r="50" fill="none" stroke={tc('#1d2436')} strokeWidth="10" />
            <circle
              cx="60"
              cy="60"
              r="50"
              fill="none"
              stroke="url(#budget-g)"
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 50}
              strokeDashoffset={2 * Math.PI * 50 * (1 - used)}
              style={{ transition: 'stroke-dashoffset 1s cubic-bezier(0.2,0.8,0.2,1)' }}
            />
            <defs>
              <linearGradient id="budget-g" x1="0" x2="1">
                <stop offset="0%" stopColor={tc('#2dd4bf')} />
                <stop offset="100%" stopColor={tc('#a78bfa')} />
              </linearGradient>
            </defs>
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="num text-[26px] font-semibold text-fog-100">
              <Counter value={used * 100} format={(v) => `${v.toFixed(0)}%`} />
            </span>
            <span className="text-[11px] uppercase tracking-wider text-fog-500">budget used</span>
          </div>
        </div>
        <div className="num mt-4 text-[13px] text-fog-300">
          {fmtMoney(data.spend)} <span className="text-fog-500">of</span> {fmtMoney(data.budget)}
        </div>
        <div className="mt-1 text-[11.5px] text-fog-500">Unspent budget means extra coupons would lose money.</div>
      </Card>
    </div>
  )
}

function AllocationTable({ version }: { version: number }) {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [discount, setDiscount] = useState<'all' | '10' | '20' | '0'>('all')
  const [segment, setSegment] = useState<'all' | Segment>('all')
  const [sort, setSort] = useState<string>('expected_profit')
  const [loaded, setLoaded] = useState<{ key: string; data: Allocation } | null>(null)
  const size = 15
  const query = new URLSearchParams({ page: String(page), size: String(size), search: q, discount, segment, sort, order: 'desc' }).toString()
  const requestKey = `${query}|${version}`
  const data = loaded?.data ?? null
  const loading = loaded?.key !== requestKey

  useEffect(() => {
    const t = window.setTimeout(() => setQ(search), 300)
    return () => window.clearTimeout(t)
  }, [search])

  useEffect(() => {
    let alive = true
    const key = `${query}|${version}`
    api<Allocation>(`/api/optimize/allocation?${query}`).then((d) => alive && setLoaded({ key, data: d }))
    return () => {
      alive = false
    }
  }, [query, version])

  const pages = data ? Math.max(1, Math.ceil(data.total / size)) : 1

  return (
    <Card pad={false}>
      <div className="flex flex-wrap items-end justify-between gap-4 p-5 pb-4">
        <div>
          <h3 className="font-display text-[15px] font-semibold text-fog-100">Prescription: allocation matrix</h3>
          <p className="mt-1 text-[12.5px] text-fog-400">The optimal discount for each customer. Export the targeted list for the CRM.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fog-500" />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
              placeholder="Search customer ID"
              className="w-48 rounded-lg border border-white/10 bg-ink-900 py-1.5 pl-8 pr-3 text-[12.5px] text-fog-100 outline-none placeholder:text-fog-500 focus:border-teal-400/50"
            />
          </div>
          <Select
            value={discount}
            onChange={(v) => {
              setDiscount(v)
              setPage(1)
            }}
            options={[
              { value: 'all', label: 'All offers' },
              { value: '20', label: '$20 offer' },
              { value: '10', label: '$10 offer' },
              { value: '0', label: 'No offer' },
            ]}
          />
          <Select
            value={segment}
            onChange={(v) => {
              setSegment(v)
              setPage(1)
            }}
            options={[
              { value: 'all', label: 'All segments' },
              { value: 'Persuadables', label: 'Persuadables' },
              { value: 'Sure Things', label: 'Sure Things' },
              { value: 'Lost Causes', label: 'Lost Causes' },
              { value: 'Sleeping Dogs', label: 'Sleeping Dogs' },
            ]}
          />
          <Select value={sort} onChange={setSort} options={SORTS.map((s) => ({ value: s.value, label: `Sort: ${s.label}` }))} />
          <Button variant="outline" icon={<Download size={14} />} onClick={exportAllocationCsv}>
            Export CSV
          </Button>
        </div>
      </div>
      <div className={cx('overflow-x-auto transition-opacity', loading && 'opacity-60')}>
        <table className="w-full min-w-[900px] text-left text-[12.5px]">
          <thead>
            <tr className="border-y border-white/[0.06] bg-ink-900/60 text-[11px] uppercase tracking-wide text-fog-500">
              <th className="px-5 py-2.5 font-medium">Customer</th>
              <th className="px-3 py-2.5 font-medium">Segment</th>
              <th className="px-3 py-2.5 font-medium">Offer</th>
              <th className="px-3 py-2.5 font-medium">Baseline P(buy)</th>
              <th className="px-3 py-2.5 font-medium">Uplift $10</th>
              <th className="px-3 py-2.5 font-medium">Uplift $20</th>
              <th className="px-3 py-2.5 font-medium">Order value</th>
              <th className="px-3 py-2.5 font-medium">Exp. cost</th>
              <th className="px-3 py-2.5 font-medium">Exp. profit</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((r) => (
              <tr key={r.customer_id} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                <td className="num px-5 py-2 text-fog-100">{r.customer_id}</td>
                <td className="px-3 py-2">
                  <span className="flex items-center gap-1.5 text-fog-200">
                    <Dot color={SEGMENT_COLOR[r.segment]} /> {r.segment}
                  </span>
                </td>
                <td className="px-3 py-2">
                  {r.discount > 0 ? (
                    <Badge tone={r.discount === 20 ? 'violet' : 'teal'}>${r.discount}</Badge>
                  ) : (
                    <span className="text-fog-500">none</span>
                  )}
                </td>
                <td className="num px-3 py-2 text-fog-200">{fmtPct(r.baseline_prob, 0)}</td>
                <td className="num px-3 py-2" style={{ color: r.uplift_10 >= 0 ? armColor(10) : C.bad }}>{fmtPts(r.uplift_10)}</td>
                <td className="num px-3 py-2" style={{ color: r.uplift_20 >= 0 ? armColor(20) : C.bad }}>{fmtPts(r.uplift_20)}</td>
                <td className="num px-3 py-2 text-fog-200">{fmtMoney(r.avg_order_value, 2)}</td>
                <td className="num px-3 py-2 text-fog-300">{r.discount > 0 ? fmtMoney(r.expected_cost, 2) : '—'}</td>
                <td className={cx('num px-3 py-2 font-medium', r.expected_profit > 0 ? 'text-emerald-300' : 'text-fog-500')}>
                  {r.discount > 0 ? fmtMoney(r.expected_profit, 2) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between px-5 py-3 text-[12px] text-fog-400">
        <span className="num">{data ? `${fmtInt(data.total)} customers` : '…'}</span>
        <div className="flex items-center gap-2">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg p-1.5 hover:bg-white/5 disabled:opacity-30">
            <ChevronLeft size={16} />
          </button>
          <span className="num">
            {page} / {fmtInt(pages)}
          </span>
          <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="rounded-lg p-1.5 hover:bg-white/5 disabled:opacity-30">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </Card>
  )
}
