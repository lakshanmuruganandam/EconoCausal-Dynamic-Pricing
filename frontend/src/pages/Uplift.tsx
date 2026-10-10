import { useMemo, useState } from 'react'
import { useApi } from '../api/client'
import type { ArmKey, Scatter, Segment, Uplift } from '../api/types'
import Plot from '../components/Plot'
import { ArmToggle, Callout, Card, CardHeader, Dot, ErrorBox, PageHeader, Segmented, Skeleton, Stat } from '../components/ui'
import { fmtInt, fmtNum, fmtPct, fmtPts } from '../lib/format'
import { C, SEGMENT_BLURB, SEGMENT_COLOR, armColor, tc } from '../lib/theme'

export default function UpliftPage() {
  const { data, error } = useApi<Uplift>('/api/uplift')
  const quad = useApi<Scatter & { p0: number[] }>('/api/model/scatter?feature=email_open_rate&arm=10&n=3000')
  const [arm, setArm] = useState<10 | 20>(10)
  const [basis, setBasis] = useState<'observed' | 'true'>('observed')
  const key = String(arm) as ArmKey
  const q = data?.arms[key]
  const useTrue = basis === 'true' && !!q?.true_curves

  const qini = useMemo(() => {
    if (!q) return []
    const x = q.fraction.map((f) => f * 100)
    const curves = useTrue ? q.true_curves! : q.curves
    const traces = [
      {
        type: 'scatter' as const,
        mode: 'lines' as const,
        name: 'Causal uplift model',
        x,
        y: curves.causal_model,
        line: { color: armColor(arm), width: 3, shape: 'spline' as const },
        fill: 'tonexty' as const,
        fillcolor: arm === 10 ? tc('rgba(45,212,191,0.08)') : tc('rgba(167,139,250,0.08)'),
      },
      {
        type: 'scatter' as const,
        mode: 'lines' as const,
        name: 'Traditional ML (purchase propensity)',
        x,
        y: curves.response_model,
        line: { color: C.legacy, width: 2, shape: 'spline' as const },
      },
    ]
    const base = {
      type: 'scatter' as const,
      mode: 'lines' as const,
      name: 'Random targeting',
      x,
      y: curves.random,
      line: { color: C.random, width: 1.5, dash: 'dash' as const },
    }
    const out: object[] = [base, ...traces]
    if (useTrue && q.true_curves) {
      out.push({
        type: 'scatter' as const,
        mode: 'lines' as const,
        name: 'Perfect (oracle) ranking',
        x,
        y: q.true_curves.perfect,
        line: { color: C.truth, width: 1.5, dash: 'dot' as const },
      })
    }
    return out
  }, [q, useTrue, arm])

  const deciles = useMemo(() => {
    if (!data) return []
    const rows = data.deciles[key]
    const x = rows.map((r) => `D${r.decile}`)
    const t: object[] = [
      { type: 'bar', name: 'Predicted τ̂', x, y: rows.map((r) => r.predicted * 100), marker: { color: armColor(arm) } },
      { type: 'bar', name: 'Observed (IPW)', x, y: rows.map((r) => (r.observed ?? 0) * 100), marker: { color: tc('rgba(148,163,184,0.45)') } },
    ]
    if (data.oracle) t.push({ type: 'scatter', mode: 'lines+markers', name: 'True τ', x, y: rows.map((r) => (r.true ?? 0) * 100), line: { color: C.truth, width: 2 }, marker: { size: 7 } })
    return t
  }, [data, key, arm])

  const confusion = useMemo(() => {
    const c = data?.segments.confusion
    if (!c) return null
    const totals = c.matrix.map((row) => row.reduce((a, b) => a + b, 0) || 1)
    return [
      {
        type: 'heatmap' as const,
        z: c.matrix.map((row, i) => row.map((v) => v / totals[i])),
        x: c.labels.map((l) => `Pred: ${l}`),
        y: c.labels.map((l) => `True: ${l}`),
        text: c.matrix.map((row) => row.map((v) => fmtInt(v))) as unknown as string[],
        texttemplate: '%{text}',
        textfont: { color: tc('#eef0f6'), family: 'JetBrains Mono', size: 12 },
        colorscale: [
          [0, tc('#0e121d')],
          [0.5, tc('#115e59')],
          [1, tc('#2dd4bf')],
        ] as [number, string][],
        showscale: false,
        hovertemplate: '%{y} → %{x}<br>%{z:.0%} of row<extra></extra>',
      },
    ]
  }, [data])

  const quadrant = useMemo(() => {
    const d = quad.data
    if (!d) return []
    const segs: Segment[] = ['Persuadables', 'Sure Things', 'Lost Causes', 'Sleeping Dogs']
    return segs.map((seg) => {
      const idx = d.segment.map((v, i) => (v === seg ? i : -1)).filter((i) => i >= 0)
      return {
        type: 'scattergl' as const,
        mode: 'markers' as const,
        name: seg,
        x: idx.map((i) => d.p0[i] * 100),
        y: idx.map((i) => d.ite[i] * 100),
        marker: { color: SEGMENT_COLOR[seg], size: 5, opacity: 0.55 },
        hovertemplate: `${seg}<br>baseline %{x:.0f}%<br>uplift %{y:.1f} pts<extra></extra>`,
      }
    })
  }, [quad.data])

  const yMax = quad.data ? Math.max(...quad.data.ite) * 100 + 3 : 30
  const yMin = quad.data ? Math.min(-3, Math.min(...quad.data.ite) * 100 - 2) : -3

  if (error) return <ErrorBox message={error} />
  if (!data || !q) return <Skeleton h={700} />

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Week 2 · Uplift evaluation"
        title="Does the model rank the right customers first?"
        description="Qini curves show the extra purchases gained by giving the discount to the top x% of customers ranked by each model. Curves are inverse-propensity weighted on the hold-out set, so the observational data acts like a randomised test."
        right={
          <div className="flex gap-2">
            {data.oracle && (
              <Segmented
                size="sm"
                value={basis}
                onChange={setBasis}
                options={[
                  { value: 'observed', label: 'Observed (IPW)' },
                  { value: 'true', label: 'Ground truth' },
                ]}
              />
            )}
            <ArmToggle value={arm} onChange={setArm} />
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Stat label="Qini coefficient (causal)" value={fmtNum(q.qini_coefficient, 4)} sub="area above random, per customer" accent={armColor(arm)} tone="good" />
        <Stat label="Qini (traditional ML)" value={fmtNum(q.qini_response, 4)} sub="ranks by who will buy anyway" accent={C.legacy} tone={q.qini_response < 0 ? 'bad' : 'default'} />
        <Stat
          label="Normalised Qini"
          value={q.normalized_qini !== undefined ? fmtPct(q.normalized_qini, 0) : '—'}
          sub="share of the perfect-ranking area"
          accent={C.truth}
        />
        <Stat label="Hold-out customers" value={fmtInt(q.n)} sub={`$${arm} vs control, IPW-adjusted`} />
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader
            title="Qini curve"
            subtitle="The causal model collects most of the available gain from the first 30–40% of customers. Ranking by purchase propensity hugs the random line, because it targets customers who would buy anyway."
          />
          <Plot
            data={qini as never}
            height={380}
            layout={{
              xaxis: { title: '% of customers targeted (ranked by model)', ticksuffix: '%' },
              yaxis: { title: 'Incremental purchases' },
              legend: { y: 1.16 },
            }}
          />
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title="Calibration by decile" subtitle="D1 = customers with the highest predicted uplift. Predicted and observed effects should both fall from left to right." />
          <Plot data={deciles as never} height={380} layout={{ barmode: 'group', yaxis: { title: 'Lift (pts)' }, legend: { y: 1.16 } }} />
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Uplift quadrant map"
          subtitle="Every dot is a customer: how likely they are to buy anyway (x) vs how much a $10 coupon changes that (y). Only the top band is worth paying for."
        />
        <Plot
          data={quadrant}
          height={420}
          layout={{
            xaxis: { title: 'Baseline purchase probability without coupon (%)', range: [0, 100] },
            yaxis: { title: 'Predicted uplift from $10 (pts)', range: [yMin, yMax], autorange: false },
            legend: { y: 1.1 },
            shapes: [
              { type: 'rect', xref: 'x', yref: 'y', x0: 0, x1: 100, y0: 7, y1: 60, fillcolor: tc('rgba(52,211,153,0.05)'), line: { width: 0 }, layer: 'below' },
              { type: 'rect', xref: 'x', yref: 'y', x0: 0, x1: 100, y0: -30, y1: -1, fillcolor: tc('rgba(248,113,113,0.06)'), line: { width: 0 }, layer: 'below' },
              { type: 'line', xref: 'x', yref: 'y', x0: 0, x1: 100, y0: 7, y1: 7, line: { color: tc('rgba(52,211,153,0.6)'), dash: 'dash', width: 1 } },
              { type: 'line', xref: 'x', yref: 'y', x0: 45, x1: 45, y0: -1, y1: 7, line: { color: tc('rgba(148,163,184,0.4)'), dash: 'dot', width: 1 } },
            ],
            annotations: [
              { x: 50, y: 7, yshift: 14, text: 'PERSUADABLES ▲ target', showarrow: false, font: { color: tc('#34d399'), size: 11, family: 'JetBrains Mono' } },
              { x: 22, y: 3, text: 'LOST CAUSES', showarrow: false, font: { color: tc('#7c859d'), size: 11, family: 'JetBrains Mono' } },
              { x: 75, y: 3, text: 'SURE THINGS', showarrow: false, font: { color: tc('#60a5fa'), size: 11, family: 'JetBrains Mono' } },
            ],
          }}
        />
      </Card>

      <div className="grid gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader title="Uplift segments" subtitle="Rule: Sleeping Dogs τ̂ < −1 pt · Persuadables τ̂ ≥ 7 pts · otherwise Sure Things if baseline ≥ 45%, else Lost Causes" />
          <div className="grid gap-3 sm:grid-cols-2">
            {data.segments.segments.map((s) => (
              <div key={s.segment} className="rounded-xl border border-white/[0.05] bg-ink-900/60 p-4" style={{ boxShadow: `inset 3px 0 0 ${SEGMENT_COLOR[s.segment]}` }}>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-[13.5px] font-semibold text-fog-100">
                    <Dot color={SEGMENT_COLOR[s.segment]} size={9} /> {s.segment}
                  </span>
                  <span className="num text-[13px] text-fog-300">{fmtInt(s.count)}</span>
                </div>
                <p className="mt-1.5 text-[12px] text-fog-400">{SEGMENT_BLURB[s.segment]}</p>
                <div className="num mt-3 grid grid-cols-3 gap-2 text-[12px]">
                  <div>
                    <div className="text-fog-500">share</div>
                    <div className="text-fog-100">{fmtPct(s.share, 1)}</div>
                  </div>
                  <div>
                    <div className="text-fog-500">uplift</div>
                    <div className="text-fog-100">{fmtPts(s.avg_uplift)}</div>
                  </div>
                  <div>
                    <div className="text-fog-500">baseline</div>
                    <div className="text-fog-100">{fmtPct(s.avg_baseline, 0)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
        {confusion ? (
          <Card className="xl:col-span-2">
            <CardHeader
              title="Segment recovery vs truth"
              subtitle={`Rows: true segment from the oracle · accuracy ${fmtPct(data.segments.confusion!.accuracy, 1)}`}
            />
            <Plot data={confusion} height={330} layout={{ margin: { l: 130, b: 90 }, xaxis: { tickangle: -25 } }} />
          </Card>
        ) : (
          <div className="xl:col-span-2">
            <Callout tone="info" title="No oracle on real data">
              Segment accuracy can only be measured on simulated data, where the counterfactual is known. On real campaign data, rely on the IPW Qini curve and
              decile calibration.
            </Callout>
          </div>
        )}
      </div>
    </div>
  )
}
