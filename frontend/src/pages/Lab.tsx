import { useEffect, useMemo, useState } from 'react'
import { Ban, Dices, RotateCcw, Search, Sparkles, Ticket } from 'lucide-react'
import { post, useApi } from '../api/client'
import type { Segment } from '../api/types'
import Counter from '../components/Counter'
import Plot from '../components/Plot'
import { Badge, Card, CardHeader, ErrorBox, PageHeader, Segmented, Select, Skeleton, Slider, Spinner } from '../components/ui'
import { cx } from '../lib/cx'
import { fmtMoney, fmtNum, fmtPct, fmtPts } from '../lib/format'
import { C, SEGMENT_BLURB, SEGMENT_COLOR, armColor, tc } from '../lib/theme'
import { useApp } from '../store/useApp'

type Profile = Record<string, number | string>

interface FeatureMeta {
  feature: string
  label: string
  min: number
  max: number
  step: number
  binary: boolean
  median: number
}

interface ProfileResponse {
  customer_id: string
  profile: Profile
  segment: Segment
  features: FeatureMeta[]
  regions: string[]
  actual: { discount: number; purchased: number }
}

interface ArmPrediction {
  tau: number
  lower: number
  upper: number
  p_with: number
  expected_profit: number
  expected_cost: number
  risk_adjusted_profit: number
}

interface Prediction {
  p0: number
  arms: { '10': ArmPrediction; '20': ArmPrediction }
  recommendation: 0 | 10 | 20
  segment: Segment
  uplift_percentile: number
  curve: { x: number[]; p0: number[]; '10': number[]; '20': number[] }
  sweep: string
  sweep_label: string
  attribution: { feature: string; label: string; value: number; median: number; delta: number }[]
  model: string
}

const PERSONAS: { key: Segment; label: string }[] = [
  { key: 'Persuadables', label: 'Persuadable' },
  { key: 'Sure Things', label: 'Sure Thing' },
  { key: 'Lost Causes', label: 'Lost Cause' },
  { key: 'Sleeping Dogs', label: 'Sleeping Dog' },
]

const fmtFeature = (m: FeatureMeta, v: number) =>
  m.binary ? (v ? 'Yes' : 'No') : m.feature === 'email_open_rate' ? fmtPct(v, 0) : m.feature === 'avg_order_value' ? fmtMoney(v) : fmtNum(v, 0)

/** Radial gauge with an animated arc. */
function Gauge({ value, label, color }: { value: number; label: string; color: string }) {
  const r = 46
  const c = 2 * Math.PI * r
  const arc = c * 0.75
  return (
    <div className="relative h-[124px] w-[124px]">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-[225deg]">
        <circle cx="60" cy="60" r={r} fill="none" stroke={tc('#1d2436')} strokeWidth="9" strokeDasharray={`${arc} ${c}`} strokeLinecap="round" />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={`${arc} ${c}`}
          strokeDashoffset={arc * (1 - Math.max(0, Math.min(1, value)))}
          style={{ transition: 'stroke-dashoffset 0.9s cubic-bezier(0.2,0.8,0.2,1), stroke 0.5s', filter: `drop-shadow(0 0 6px ${color}88)` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="num text-[22px] font-semibold text-fog-100">
          <Counter value={value * 100} format={(v) => `${v.toFixed(0)}`} />
          <span className="text-[12px] text-fog-400">th</span>
        </span>
        <span className="text-[10.5px] uppercase tracking-wider text-fog-500">{label}</span>
      </div>
    </div>
  )
}

/** One "parallel world": animated liquid bar of purchase probability. */
function World({ title, prob, base, color, delta, ci, profit, best, icon }: {
  title: string
  prob: number
  base: number
  color: string
  delta?: number
  ci?: [number, number]
  profit?: number
  best: boolean
  icon: React.ReactNode
}) {
  return (
    <div
      className={cx(
        'relative flex flex-col items-center rounded-2xl border p-4 transition-all duration-500',
        best ? 'border-transparent bg-ink-900/80 shadow-[0_20px_50px_-20px_rgba(45,212,191,0.45)]' : 'border-white/[0.05] bg-ink-900/50',
      )}
      style={best ? { boxShadow: `0 0 0 1.5px ${color}, 0 24px 60px -24px ${color}` } : undefined}
    >
      {best && (
        <span className="absolute -top-2.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ink-950" style={{ background: color }}>
          Recommended
        </span>
      )}
      <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-fog-200">
        <span style={{ color }}>{icon}</span>
        {title}
      </div>
      <div className="relative mt-3 h-44 w-16 overflow-hidden rounded-2xl bg-ink-950 ring-1 ring-white/[0.06]">
        {/* baseline reference */}
        <div className="absolute inset-x-0 border-t border-dashed border-white/30" style={{ bottom: `${base * 100}%`, transition: 'bottom 0.8s' }} />
        <div
          className="liquid absolute inset-x-0 bottom-0"
          style={{
            height: `${prob * 100}%`,
            background: `linear-gradient(180deg, ${color}, ${color}55)`,
            transition: 'height 0.9s cubic-bezier(0.2, 0.8, 0.2, 1)',
          }}
        />
      </div>
      <div className="num mt-3 text-[24px] font-semibold text-fog-100">
        <Counter value={prob * 100} format={(v) => `${v.toFixed(1)}%`} />
      </div>
      <div className="text-[11px] text-fog-500">P(purchase)</div>
      {delta !== undefined && (
        <div className="num mt-2 text-center text-[12px]">
          <div style={{ color: delta >= 0 ? color : C.bad }}>
            <Counter value={delta} format={fmtPts} />
          </div>
          {ci && <div className="text-[10.5px] text-fog-500">CI {fmtPts(ci[0])} … {fmtPts(ci[1])}</div>}
          {profit !== undefined && (
            <div className={cx('mt-1 font-semibold', profit > 0 ? 'text-emerald-300' : 'text-rose-300')}>
              <Counter value={profit} format={(v) => `${v >= 0 ? '+' : ''}${fmtMoney(v, 2)}`} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function Lab() {
  const initialPersona = useApp.getState().labPersona ?? 'Persuadables'
  const [source, setSource] = useState<string>(`persona=${encodeURIComponent(initialPersona)}`)
  const [search, setSearch] = useState('')
  const { data: base, error } = useApi<ProfileResponse>(`/api/lab/profile?${source}`)
  const [edits, setEdits] = useState<{ key: string; profile: Profile } | null>(null)
  const [sweep, setSweep] = useState('cart_abandons_90d')
  const [pred, setPred] = useState<Prediction | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const runKey = useApp((s) => s.runKey)

  useEffect(() => {
    useApp.setState({ labPersona: null })
  }, [])

  const baseKey = base ? `${source}|${base.customer_id}` : ''
  const profile = edits && edits.key === baseKey ? edits.profile : base?.profile
  const profileJson = JSON.stringify(profile ?? null)

  useEffect(() => {
    if (!profile) return
    const t = window.setTimeout(() => {
      setBusy(true)
      post<Prediction>('/api/lab/predict', { profile, sweep, customer_id: base?.customer_id })
        .then((p) => {
          setPred(p)
          setErr(null)
        })
        .catch((e: Error) => setErr(e.message))
        .finally(() => setBusy(false))
    }, 180)
    return () => window.clearTimeout(t)
    // profileJson captures deep changes of `profile`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileJson, sweep, runKey])

  const setFeature = (f: string, v: number | string) => {
    if (!profile) return
    setEdits({ key: baseKey, profile: { ...profile, [f]: v } })
  }

  const curve = useMemo(() => {
    if (!pred || !profile) return []
    const cur = Number(profile[pred.sweep])
    const ys = [...pred.curve['10'], ...pred.curve['20']].map((v) => v * 100)
    return [
      { type: 'scatter' as const, mode: 'lines' as const, name: '$10 uplift', x: pred.curve.x, y: pred.curve['10'].map((v) => v * 100), line: { color: C.arm10, width: 3, shape: 'spline' as const } },
      { type: 'scatter' as const, mode: 'lines' as const, name: '$20 uplift', x: pred.curve.x, y: pred.curve['20'].map((v) => v * 100), line: { color: C.arm20, width: 3, shape: 'spline' as const } },
      {
        type: 'scatter' as const,
        mode: 'lines' as const,
        name: 'Baseline P(buy)',
        x: pred.curve.x,
        y: pred.curve.p0.map((v) => v * 100),
        yaxis: 'y2',
        line: { color: C.truth, width: 1.5, dash: 'dot' as const },
      },
      {
        type: 'scatter' as const,
        mode: 'lines' as const,
        name: 'This customer',
        x: [cur, cur],
        y: [Math.min(0, ...ys), Math.max(...ys)],
        line: { color: tc('#eef0f6'), width: 1, dash: 'dash' as const },
        hoverinfo: 'skip' as const,
      },
    ]
  }, [pred, profile])

  const attribution = useMemo(() => {
    if (!pred) return []
    const rows = pred.attribution.slice(0, 8).reverse()
    return [
      {
        type: 'bar' as const,
        orientation: 'h' as const,
        y: rows.map((r) => r.label),
        x: rows.map((r) => r.delta * 100),
        marker: { color: rows.map((r) => (r.delta >= 0 ? C.arm10 : C.legacy)) },
        text: rows.map((r) => `${r.delta >= 0 ? '+' : ''}${(r.delta * 100).toFixed(1)}`),
        textposition: 'outside' as const,
        textfont: { color: C.text, family: 'JetBrains Mono', size: 11 },
        cliponaxis: false,
        hovertemplate: '%{y}: %{x:.2f} pts vs median customer<extra></extra>',
      },
    ]
  }, [pred])

  if (error) return <ErrorBox message={error} />
  if (!base || !profile) return <Skeleton h={700} />

  const rec = pred?.recommendation ?? 0
  const recColor = rec === 0 ? tc('#7c859d') : armColor(rec)
  const best = rec === 0 ? null : pred?.arms[String(rec) as '10' | '20']
  const metaByFeature = Object.fromEntries(base.features.map((m) => [m.feature, m]))

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Counterfactual simulator"
        title="What-If Lab"
        description="Pick a customer, then change their traits. The champion causal model predicts all three parallel worlds (no coupon, $10, $20) live and says which offer, if any, is worth sending."
        right={
          <div className="flex flex-wrap items-center gap-2">
            {PERSONAS.map((p) => (
              <button
                key={p.key}
                onClick={() => setSource(`persona=${encodeURIComponent(p.key)}`)}
                className={cx(
                  'flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12.5px] font-medium ring-1 ring-inset transition',
                  source === `persona=${encodeURIComponent(p.key)}` ? 'bg-white/[0.07] text-fog-100 ring-white/20' : 'text-fog-400 ring-white/10 hover:text-fog-100',
                )}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: SEGMENT_COLOR[p.key] }} />
                {p.label}
              </button>
            ))}
            <button
              onClick={() => setSource(`seed=${Math.floor(Math.random() * 1e6)}`)}
              className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12.5px] font-medium text-fog-400 ring-1 ring-inset ring-white/10 transition hover:text-fog-100"
            >
              <Dices size={14} /> Random
            </button>
          </div>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        {/* ── controls ── */}
        <Card className="h-fit xl:sticky xl:top-20">
          <form
            className="relative mb-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (search.trim()) setSource(`customer_id=${encodeURIComponent(search.trim())}`)
            }}
          >
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fog-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Load customer ID, e.g. C042-000107"
              className="w-full rounded-xl border border-white/10 bg-ink-950 py-2 pl-9 pr-3 font-mono text-[12.5px] text-fog-100 outline-none placeholder:font-sans placeholder:text-fog-500 focus:border-teal-400/50"
            />
          </form>
          <div className="mb-4 flex items-center justify-between rounded-xl bg-ink-950/60 px-3 py-2.5">
            <div>
              <div className="num text-[13px] font-semibold text-fog-100">{base.customer_id}</div>
              <div className="text-[11px] text-fog-500">
                history: {base.actual.discount ? `got $${base.actual.discount}` : 'no coupon'} · {base.actual.purchased ? 'purchased' : 'did not buy'}
              </div>
            </div>
            <button onClick={() => setEdits(null)} title="Reset edits" className="rounded-lg p-1.5 text-fog-400 hover:bg-white/5 hover:text-fog-100">
              <RotateCcw size={15} />
            </button>
          </div>
          <div className="space-y-4">
            {base.features.map((m) =>
              m.binary ? (
                <div key={m.feature} className="flex items-center justify-between">
                  <span className="text-[12.5px] font-medium text-fog-300">{m.label}</span>
                  <Segmented
                    size="sm"
                    value={Number(profile[m.feature]) ? 1 : 0}
                    onChange={(v) => setFeature(m.feature, v)}
                    options={[
                      { value: 0, label: 'No' },
                      { value: 1, label: 'Yes' },
                    ]}
                  />
                </div>
              ) : (
                <Slider
                  key={m.feature}
                  label={m.label}
                  value={Number(profile[m.feature])}
                  min={m.min}
                  max={m.max}
                  step={m.step}
                  onChange={(v) => setFeature(m.feature, v)}
                  format={(v) => fmtFeature(m, v)}
                />
              ),
            )}
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] font-medium text-fog-300">Region</span>
              <Select value={String(profile.region)} onChange={(v) => setFeature('region', v)} options={base.regions.map((r) => ({ value: r, label: r[0].toUpperCase() + r.slice(1) }))} />
            </div>
          </div>
        </Card>

        {/* ── outputs ── */}
        <div className="space-y-6">
          {err && <ErrorBox message={err} />}
          <Card className="glow-border">
            <div className="flex flex-wrap items-center gap-6">
              <div
                className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl transition-colors duration-500"
                style={{ background: `${recColor}22`, color: recColor, boxShadow: `0 0 40px -6px ${recColor}` }}
              >
                {rec === 0 ? <Ban size={28} /> : <Ticket size={28} />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.18em] text-fog-400">
                  Decision {busy && <Spinner className="h-3 w-3 text-arm10" />}
                </div>
                <div className="font-display text-[26px] font-semibold leading-tight text-fog-100">
                  {rec === 0 ? 'Do not send a coupon' : `Send the $${rec} coupon`}
                </div>
                <div className="mt-1 text-[13px] text-fog-300">
                  {pred &&
                    (rec === 0
                      ? pred.arms['10'].tau < 0
                        ? 'A discount would lower this customer’s purchase odds.'
                        : 'The uplift does not cover the coupon cost after risk adjustment.'
                      : `Lifts purchase probability by ${fmtPts(best!.tau)} for an expected ${fmtMoney(best!.expected_profit, 2)} incremental profit.`)}
                </div>
              </div>
              {pred && (
                <div className="flex items-center gap-5">
                  <div className="text-right">
                    <Badge tone="neutral" className="!text-[12px]">
                      <span className="h-2 w-2 rounded-full" style={{ background: SEGMENT_COLOR[pred.segment] }} />
                      {pred.segment}
                    </Badge>
                    <div className="mt-1.5 max-w-[190px] text-[11.5px] leading-snug text-fog-500">{SEGMENT_BLURB[pred.segment]}</div>
                  </div>
                  <Gauge value={pred.uplift_percentile} label="uplift pctl" color={SEGMENT_COLOR[pred.segment]} />
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Three parallel worlds" subtitle="The same customer under each offer. Dashed line = purchase probability with no coupon." icon={<Sparkles size={15} />} />
            {pred ? (
              <div className="grid grid-cols-3 gap-4">
                <World title="No coupon" prob={pred.p0} base={pred.p0} color={tc('#7c859d')} best={rec === 0} icon={<Ban size={14} />} />
                {(['10', '20'] as const).map((a) => (
                  <World
                    key={a}
                    title={`$${a} coupon`}
                    prob={pred.arms[a].p_with}
                    base={pred.p0}
                    color={armColor(Number(a))}
                    delta={pred.arms[a].tau}
                    ci={[pred.arms[a].lower, pred.arms[a].upper]}
                    profit={pred.arms[a].expected_profit}
                    best={rec === Number(a)}
                    icon={<Ticket size={14} />}
                  />
                ))}
              </div>
            ) : (
              <Skeleton h={300} />
            )}
          </Card>

          <div className="grid gap-6 2xl:grid-cols-2">
            <Card>
              <CardHeader
                title="Response curve"
                subtitle="How this customer's uplift would change if one trait changed, holding everything else fixed"
                right={
                  <Select
                    value={sweep}
                    onChange={setSweep}
                    options={base.features.filter((m) => !m.binary).map((m) => ({ value: m.feature, label: m.label }))}
                  />
                }
              />
              <Plot
                data={curve}
                height={300}
                layout={{
                  xaxis: { title: metaByFeature[sweep]?.label },
                  yaxis: { title: 'Uplift (pts)' },
                  yaxis2: { title: 'Baseline P(buy) %', overlaying: 'y', side: 'right', showgrid: false },
                  legend: { y: 1.2 },
                  margin: { r: 56 },
                }}
              />
            </Card>
            <Card>
              <CardHeader title="Why this customer?" subtitle="Change in $10 uplift if each trait were set to the median customer's value (local attribution)" />
              <Plot data={attribution} height={300} layout={{ margin: { l: 150, r: 40 }, xaxis: { title: 'Contribution to uplift (pts)' }, showlegend: false }} />
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
