import { useMemo, useState } from 'react'
import { useApi } from '../api/client'
import type { PropensityArm } from '../api/types'
import Plot from '../components/Plot'
import { ArmToggle, Callout, Card, CardHeader, ErrorBox, KeyValue, Legend, PageHeader, Skeleton, Stat } from '../components/ui'
import { fmtInt, fmtNum, fmtPct, fmtPts } from '../lib/format'
import { C, armColor, tc } from '../lib/theme'

export default function Balance() {
  const { data, error } = useApi<{ arms: PropensityArm[] }>('/api/causal/propensity')
  const [arm, setArm] = useState<10 | 20>(20)
  const a = data?.arms.find((x) => x.arm === arm)

  const love = useMemo(() => {
    if (!a) return []
    const rows = [...a.balance].sort((p, q) => Math.abs(p.raw) - Math.abs(q.raw))
    const y = rows.map((r) => r.label)
    return [
      {
        type: 'scatter' as const,
        mode: 'markers' as const,
        name: 'Before adjustment',
        x: rows.map((r) => r.raw),
        y,
        marker: { color: C.legacy, size: 10, symbol: 'circle' },
        hovertemplate: '%{y}<br>raw SMD %{x:.3f}<extra></extra>',
      },
      {
        type: 'scatter' as const,
        mode: 'markers' as const,
        name: 'After matching',
        x: rows.map((r) => r.matched),
        y,
        marker: { color: tc('#818cf8'), size: 9, symbol: 'diamond' },
        hovertemplate: '%{y}<br>matched SMD %{x:.3f}<extra></extra>',
      },
      {
        type: 'scatter' as const,
        mode: 'markers' as const,
        name: 'After IPW',
        x: rows.map((r) => r.weighted),
        y,
        marker: { color: C.arm10, size: 10, symbol: 'circle', line: { color: tc('#0a0d16'), width: 1.5 } },
        hovertemplate: '%{y}<br>weighted SMD %{x:.3f}<extra></extra>',
      },
    ]
  }, [a])

  const overlap = useMemo(() => {
    if (!a) return []
    return [
      {
        type: 'scatter' as const,
        mode: 'lines' as const,
        name: `Received $${arm}`,
        x: a.overlap.bins,
        y: a.overlap.treated,
        fill: 'tozeroy' as const,
        line: { color: armColor(arm), width: 2, shape: 'spline' as const },
        fillcolor: arm === 10 ? tc('rgba(45,212,191,0.18)') : tc('rgba(167,139,250,0.18)'),
      },
      {
        type: 'scatter' as const,
        mode: 'lines' as const,
        name: 'No discount',
        x: a.overlap.bins,
        y: a.overlap.control,
        fill: 'tozeroy' as const,
        line: { color: C.control, width: 2, shape: 'spline' as const },
        fillcolor: tc('rgba(100,116,139,0.18)'),
      },
    ]
  }, [a, arm])

  if (error) return <ErrorBox message={error} />
  if (!a) return <Skeleton h={600} />

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Propensity score pipelines"
        title="Making observational data behave like an A/B test"
        description="A multinomial propensity model estimates each customer’s probability of receiving each discount. Re-weighting (IPW) and nearest-neighbour matching then balance treated and control customers, as if the coupons had been handed out at random."
        right={<ArmToggle value={arm} onChange={setArm} />}
      />

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Stat label="Max |SMD| before" value={fmtNum(a.max_abs_smd_raw, 3)} tone={a.max_abs_smd_raw > 0.1 ? 'bad' : 'good'} sub="> 0.1 means imbalanced" accent={C.legacy} />
        <Stat label="Max |SMD| after IPW" value={fmtNum(a.max_abs_smd_weighted, 3)} tone={a.max_abs_smd_weighted < 0.1 ? 'good' : 'warn'} sub="balance achieved below 0.1" accent={C.arm10} />
        <Stat label="Matched treated" value={fmtPct(a.match_rate, 1)} sub={`${fmtInt(a.n_matched)} of ${fmtInt(a.n_treated)} within caliper`} />
        <Stat label="Extreme propensities" value={fmtPct(a.overlap.share_extreme, 1)} sub="share outside [0.05, 0.95]" tone={a.overlap.share_extreme < 0.05 ? 'good' : 'warn'} />
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader
            title="Covariate balance (love plot)"
            subtitle="Standardised mean difference between customers who got the discount and those who did not. Shaded band = |SMD| < 0.1."
          />
          <Plot
            data={love}
            height={460}
            layout={{
              margin: { l: 150 },
              xaxis: { title: 'Standardised mean difference', zeroline: true },
              yaxis: { automargin: true },
              shapes: [
                { type: 'rect', xref: 'x', yref: 'paper', x0: -0.1, x1: 0.1, y0: 0, y1: 1, fillcolor: tc('rgba(52,211,153,0.07)'), line: { width: 0 } },
                { type: 'line', xref: 'x', yref: 'paper', x0: 0, x1: 0, y0: 0, y1: 1, line: { color: C.zero, width: 1 } },
              ],
            }}
          />
        </Card>

        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader title="Propensity overlap" subtitle={`P(receive $${arm} | X) for customers in each group. Positivity requires the two distributions to overlap.`} />
            <Plot data={overlap} height={240} layout={{ xaxis: { title: 'Propensity score', range: [0, 1] }, yaxis: { title: 'Density' }, legend: { y: 1.2 } }} />
          </Card>
          <Card>
            <CardHeader title="Effect estimates" subtitle={`$${arm} vs no discount`} />
            <KeyValue k="Naive difference in means" v={<span className="text-rose-300">{fmtPts(a.naive_effect)}</span>} />
            <KeyValue k="Inverse probability weighting (ATE)" v={fmtPts(a.ipw_effect)} />
            <KeyValue k="Propensity score matching (ATT)" v={fmtPts(a.psm_att)} />
            <KeyValue k="Effective sample size (treated)" v={fmtInt(a.effective_sample_size.treated)} />
            <KeyValue k="Effective sample size (control)" v={fmtInt(a.effective_sample_size.control)} />
          </Card>
        </div>
      </div>

      <Callout tone="info">
        <Legend
          items={[
            { color: C.legacy, label: 'Before adjustment' },
            { color: tc('#818cf8'), label: '1:1 caliper matching on logit propensity' },
            { color: C.arm10, label: 'Inverse probability weighting (Hajek)' },
          ]}
        />
        <p className="mt-2">
          IPW and matching only remove bias from <em>observed</em> confounders. Double ML goes further: it residualises both treatment and outcome
          with flexible models, so mistakes in the propensity model do not bias the final effect (Neyman orthogonality).
        </p>
      </Callout>
    </div>
  )
}
