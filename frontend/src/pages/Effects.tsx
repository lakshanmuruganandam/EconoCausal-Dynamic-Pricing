import { useMemo, useState } from 'react'
import { Crown } from 'lucide-react'
import { useApi } from '../api/client'
import type { ArmKey, Compare, Distribution, ModelSummary, Scatter, Segment } from '../api/types'
import Plot from '../components/Plot'
import DMLExplainer from '../components/DMLExplainer'
import { ArmToggle, Badge, Card, CardHeader, ErrorBox, KeyValue, PageHeader, Segmented, Select, Skeleton, Spinner } from '../components/ui'
import { cx } from '../lib/cx'
import { fmtNum, fmtPct, fmtPts } from '../lib/format'
import { C, SEGMENT_COLOR, armColor, tc } from '../lib/theme'

const SCATTER_FEATURES = [
  ['cart_abandons_90d', 'Cart abandons (90d)'],
  ['email_open_rate', 'Email open rate'],
  ['avg_order_value', 'Avg order value ($)'],
  ['age', 'Age'],
  ['recency_days', 'Days since last order'],
  ['frequency', 'Orders / year'],
  ['sessions_30d', 'Sessions (30d)'],
  ['tenure_months', 'Tenure (months)'],
] as const

export default function Effects() {
  const summary = useApi<ModelSummary>('/api/model/summary')
  const dist = useApi<Distribution>('/api/model/distribution')
  const cmp = useApi<Compare>('/api/model/compare')
  const [arm, setArm] = useState<10 | 20>(10)
  const [feature, setFeature] = useState<string>('cart_abandons_90d')
  const [colorBy, setColorBy] = useState<'segment' | 'truth'>('segment')
  const scatter = useApi<Scatter>(`/api/model/scatter?feature=${feature}&arm=${arm}&n=1800`)
  const key = String(arm) as ArmKey

  const distData = useMemo(() => {
    if (!dist.data) return []
    return (['10', '20'] as ArmKey[]).map((a) => ({
      type: 'bar' as const,
      name: `$${a} offer`,
      x: dist.data!.bins.map((b) => b * 100),
      y: dist.data!.arms[a].hist,
      marker: { color: a === '10' ? tc('rgba(45,212,191,0.6)') : tc('rgba(167,139,250,0.55)'), line: { width: 0 } },
      hovertemplate: `$${a}: %{x:.1f} pts · %{y} customers<extra></extra>`,
    }))
  }, [dist.data])

  const scatterData = useMemo(() => {
    const s = scatter.data
    if (!s) return []
    const jitter = (v: number, i: number) => v + (((i * 9301 + 49297) % 233280) / 233280 - 0.5) * (s.feature === 'cart_abandons_90d' || s.feature === 'frequency' || s.feature === 'sessions_30d' ? 0.6 : 0)
    if (colorBy === 'truth' && s.true) {
      return [
        {
          type: 'scattergl' as const,
          mode: 'markers' as const,
          name: 'Ground truth',
          x: s.x.map(jitter),
          y: s.true.map((v) => v * 100),
          marker: { color: C.truth, size: 4, opacity: 0.35 },
          hovertemplate: 'truth %{y:.1f} pts<extra></extra>',
        },
        {
          type: 'scattergl' as const,
          mode: 'markers' as const,
          name: 'Estimated τ̂(x)',
          x: s.x.map(jitter),
          y: s.ite.map((v) => v * 100),
          marker: { color: armColor(arm), size: 4, opacity: 0.55 },
          hovertemplate: 'estimate %{y:.1f} pts<extra></extra>',
        },
      ]
    }
    const segs: Segment[] = ['Persuadables', 'Sure Things', 'Lost Causes', 'Sleeping Dogs']
    return segs.map((seg) => {
      const idx = s.segment.map((v, i) => (v === seg ? i : -1)).filter((i) => i >= 0)
      return {
        type: 'scattergl' as const,
        mode: 'markers' as const,
        name: seg,
        x: idx.map((i) => jitter(s.x[i], i)),
        y: idx.map((i) => s.ite[i] * 100),
        marker: { color: SEGMENT_COLOR[seg], size: 4.5, opacity: 0.6 },
        hovertemplate: `${seg}<br>${s.label}: %{x:.2f}<br>τ̂ %{y:.1f} pts<extra></extra>`,
      }
    })
  }, [scatter.data, colorBy, arm])

  const predVsTrue = useMemo(() => {
    const s = scatter.data
    if (!s?.true) return null
    const lo = Math.min(...s.true, ...s.ite) * 100
    const hi = Math.max(...s.true, ...s.ite) * 100
    return [
      {
        type: 'scattergl' as const,
        mode: 'markers' as const,
        x: s.true.map((v) => v * 100),
        y: s.ite.map((v) => v * 100),
        marker: { color: armColor(arm), size: 4, opacity: 0.45 },
        hovertemplate: 'true %{x:.1f} · est %{y:.1f}<extra></extra>',
        showlegend: false,
      },
      { type: 'scatter' as const, mode: 'lines' as const, x: [lo, hi], y: [lo, hi], line: { color: C.truth, dash: 'dash' as const, width: 1.5 }, showlegend: false, hoverinfo: 'skip' as const },
    ]
  }, [scatter.data, arm])

  const importance = useMemo(() => {
    if (!summary.data) return []
    const rows = summary.data.importance.slice(0, 10).reverse()
    return [
      {
        type: 'bar' as const,
        orientation: 'h' as const,
        x: rows.map((r) => r.importance * 100),
        y: rows.map((r) => r.label),
        marker: { color: rows.map((_, i) => `rgba(45,212,191,${0.35 + (i / rows.length) * 0.6})`) },
        hovertemplate: '%{y}: %{x:.1f}%<extra></extra>',
      },
    ]
  }, [summary.data])

  const coefPlot = useMemo(() => {
    const c = summary.data?.coefficients
    if (!c) return null
    const rows = c.filter((r) => r.arm === arm).sort((p, q) => Math.abs(p.coef) - Math.abs(q.coef))
    return [
      {
        type: 'scatter' as const,
        mode: 'markers' as const,
        x: rows.map((r) => r.coef * 100),
        y: rows.map((r) => r.label),
        error_x: {
          type: 'data' as const,
          symmetric: false,
          array: rows.map((r) => (r.upper - r.coef) * 100),
          arrayminus: rows.map((r) => (r.coef - r.lower) * 100),
          color: tc('#7c859d'),
          thickness: 1.2,
          width: 3,
        },
        marker: { color: rows.map((r) => (r.p_value < 0.05 ? armColor(arm) : tc('#5a6379'))), size: 9 },
        hovertemplate: '%{y}: %{x:.2f} pts per unit<extra></extra>',
      },
    ]
  }, [summary.data, arm])

  if (summary.error) return <ErrorBox message={summary.error} />
  if (!summary.data) return <Skeleton h={700} />
  const s = summary.data
  const d = dist.data?.arms[key]
  const models = cmp.data?.result?.models ?? []
  const champion = cmp.data?.result?.selection?.champion ?? s.estimator

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Week 2 · Double machine learning (EconML)"
        title="Individual treatment effects"
        description="For every customer, Double ML estimates τ(x): how many percentage points a discount adds to their purchase probability. Nuisance models are cross-fitted LightGBM; the final stage isolates the causal part from the confounded signal."
        right={<ArmToggle value={arm} onChange={setArm} />}
      />

      <Card className="glow-border">
        <CardHeader
          title="How Double ML removes confounding"
          subtitle="Animated on real data: the same customers, before and after each residualisation stage. Click a step or let it autoplay."
        />
        <DMLExplainer arm={arm} />
      </Card>

      <Card>
        <CardHeader
          title="Champion / challenger"
          subtitle={
            cmp.data?.result?.selection
              ? `Selection rule: ${cmp.data.result.selection.criterion}. Oracle metrics are shown for transparency but never used for selection.`
              : 'All estimators trained on the same split and scored on the same hold-out.'
          }
          right={cmp.data?.status === 'running' && <Badge tone="info"><Spinner className="h-3 w-3" /> training challengers</Badge>}
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-white/[0.06] text-[11.5px] uppercase tracking-wide text-fog-500">
                <th className="py-2 pr-3 font-medium">Estimator</th>
                <th className="py-2 pr-3 font-medium">ATE</th>
                <th className="py-2 pr-3 font-medium">Qini (IPW)</th>
                <th className="py-2 pr-3 font-medium">Normalised Qini</th>
                <th className="py-2 pr-3 font-medium">PEHE ↓</th>
                <th className="py-2 pr-3 font-medium">Corr(τ̂, τ)</th>
                <th className="py-2 pr-3 font-medium">CI coverage</th>
                <th className="py-2 font-medium">Fit</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => {
                const r = m.arms[key]
                return (
                  <tr key={m.name} className={cx('border-b border-white/[0.04]', m.name === champion && 'bg-teal-400/[0.04]')}>
                    <td className="py-3 pr-3">
                      <div className="flex items-center gap-2 font-semibold text-fog-100">
                        {m.name === champion && <Crown size={14} className="text-amber-300" />}
                        {m.label}
                      </div>
                      <div className="text-[11.5px] text-fog-500">{m.family}</div>
                    </td>
                    <td className="num py-3 pr-3 text-fog-200">{fmtPts(r.ate)}</td>
                    <td className="num py-3 pr-3 text-fog-200">{fmtNum(r.qini, 4)}</td>
                    <td className="num py-3 pr-3 text-fog-200">{r.normalized_qini != null ? fmtPct(r.normalized_qini, 0) : '—'}</td>
                    <td className="num py-3 pr-3 text-fog-200">{r.pehe != null ? fmtNum(r.pehe * 100, 2) + ' pts' : '—'}</td>
                    <td className="num py-3 pr-3 text-fog-200">{fmtNum(r.correlation, 3)}</td>
                    <td className="num py-3 pr-3 text-fog-200">{r.ci_coverage != null ? fmtPct(r.ci_coverage, 0) : '—'}</td>
                    <td className="num py-3 text-fog-400">{m.fit_seconds.toFixed(1)}s</td>
                  </tr>
                )
              })}
              {models.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-fog-500">
                    {cmp.data?.status === 'running' ? 'Training challenger models…' : 'Comparison not available yet.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Distribution of individual effects" subtitle="Heterogeneity is the opportunity: the same coupon helps some customers a lot and others not at all." />
          <Plot
            data={distData}
            height={290}
            layout={{
              barmode: 'overlay',
              xaxis: { title: 'Estimated lift in purchase probability τ̂(x) (pts)' },
              yaxis: { title: 'Customers' },
              shapes: [{ type: 'line', xref: 'x', yref: 'paper', x0: 0, x1: 0, y0: 0, y1: 1, line: { color: C.zero, dash: 'dot' } }],
            }}
          />
        </Card>
        <Card>
          <CardHeader title={`${s.label}`} subtitle={s.summary} />
          <KeyValue k={`ATE ($${arm})`} v={fmtPts(s.ate[key].value)} />
          <KeyValue k="95% CI" v={`${fmtPts(s.ate[key].lower)} … ${fmtPts(s.ate[key].upper)}`} />
          {d && (
            <>
              <KeyValue k="Median τ̂" v={fmtPts(d.median)} />
              <KeyValue k="10th – 90th percentile" v={`${fmtPts(d.p10)} … ${fmtPts(d.p90)}`} />
              <KeyValue k="Significantly positive" v={fmtPct(d.share_significant)} />
              <KeyValue k="Significantly negative" v={fmtPct(d.share_negative)} />
            </>
          )}
          {s.oracle && (
            <div className="mt-3 rounded-xl bg-amber-400/[0.06] p-3 ring-1 ring-inset ring-amber-400/15">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-300/90">Oracle check (hold-out)</div>
              <div className="num mt-1 grid grid-cols-2 gap-1 text-[12px] text-amber-100">
                <span>corr {fmtNum(s.oracle[key].correlation, 3)}</span>
                <span>PEHE {fmtNum(s.oracle[key].pehe * 100, 2)} pts</span>
                <span>bias {fmtPts(s.oracle[key].ate_bias, 2)}</span>
                <span>sign acc {fmtPct(s.oracle[key].sign_accuracy, 0)}</span>
              </div>
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="What drives the response?"
            subtitle="Estimated effect against a customer feature (sample of 1,800 customers)"
            right={
              <div className="flex gap-2">
                <Select value={feature} onChange={setFeature} options={SCATTER_FEATURES.map(([v, l]) => ({ value: v, label: l }))} />
                {scatter.data?.true && (
                  <Segmented
                    size="sm"
                    value={colorBy}
                    onChange={setColorBy}
                    options={[
                      { value: 'segment', label: 'Segments' },
                      { value: 'truth', label: 'vs truth' },
                    ]}
                  />
                )}
              </div>
            }
          />
          <Plot data={scatterData} height={340} layout={{ xaxis: { title: scatter.data?.label }, yaxis: { title: 'τ̂(x) (pts)' }, legend: { y: 1.14 } }} />
        </Card>
        <Card>
          <CardHeader title="Effect drivers" subtitle={s.estimator === 'linear_dml' ? 'Share of |β|·σ(x) in the linear CATE' : 'Share of heterogeneity splits in the forest'} />
          <Plot data={importance} height={340} layout={{ margin: { l: 140 }, xaxis: { title: 'Importance (%)' }, showlegend: false }} />
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Who responds most? Interpretable rules"
            subtitle="A depth-3 tree fitted to τ̂(x) turns the model into segment rules a marketing team can act on (EconML SingleTreeCateInterpreter approach)."
          />
          <div className="space-y-2">
            {s.rules[key].map((r, i) => {
              const max = Math.max(...s.rules[key].map((x) => Math.abs(x.cate)))
              return (
                <div key={i} className="grid grid-cols-[1fr_auto] items-center gap-4 rounded-xl border border-white/[0.05] bg-ink-900/60 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap gap-1.5">
                      {r.conditions.map((c) => (
                        <span key={c} className="rounded-md bg-white/[0.05] px-2 py-0.5 font-mono text-[11px] text-fog-200">
                          {c}
                        </span>
                      ))}
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-700">
                      <div className="h-full rounded-full" style={{ width: `${(Math.abs(r.cate) / max) * 100}%`, background: r.cate >= 0 ? armColor(arm) : C.bad }} />
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="num text-[16px] font-semibold" style={{ color: r.cate >= 0 ? armColor(arm) : C.bad }}>
                      {fmtPts(r.cate)}
                    </div>
                    <div className="num text-[11px] text-fog-500">{fmtPct(r.share, 0)} of base</div>
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
        <div className="space-y-6">
          {predVsTrue && (
            <Card>
              <CardHeader title="Estimated vs true effect" subtitle="Points on the dashed line are perfect recoveries" />
              <Plot data={predVsTrue} height={280} layout={{ xaxis: { title: 'True τ (pts)' }, yaxis: { title: 'Estimated τ̂ (pts)' } }} />
            </Card>
          )}
          {coefPlot && (
            <Card>
              <CardHeader title="Linear CATE coefficients" subtitle="Effect change per unit of each feature, with 95% CI. Grey = not significant." />
              <Plot data={coefPlot} height={380} layout={{ margin: { l: 140 }, xaxis: { title: 'Δτ per unit (pts)' }, showlegend: false }} />
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
