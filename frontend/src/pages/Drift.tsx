import { useMemo, useState } from 'react'
import { Radar } from 'lucide-react'
import { post, useApi } from '../api/client'
import type { Drift, Scenario } from '../api/types'
import Plot from '../components/Plot'
import { Badge, Button, Callout, Card, CardHeader, ErrorBox, PageHeader, Skeleton, Slider, Spinner, Stat } from '../components/ui'
import { cx } from '../lib/cx'
import { fmtInt, fmtNum, fmtP, fmtPts } from '../lib/format'
import { C, tc } from '../lib/theme'

const LEVEL_COLOR = { ok: C.good, warn: C.warn, alert: C.bad }

export default function DriftPage() {
  const scenarios = useApi<{ scenarios: Scenario[] }>('/api/drift/scenarios')
  const last = useApi<Drift | Record<string, never>>('/api/drift')
  const [scenario, setScenario] = useState('price_war')
  const [n, setN] = useState(5000)
  const [result, setResult] = useState<Drift | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const d: Drift | null = result ?? (last.data && 'features' in last.data ? (last.data as Drift) : null)

  const run = async () => {
    setBusy(true)
    setErr(null)
    try {
      setResult(await post<Drift>('/api/drift', { scenario, n, seed: Math.floor(Math.random() * 100000) }))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const psiChart = useMemo(() => {
    if (!d) return []
    const rows = [...d.features].reverse()
    return [
      {
        type: 'bar' as const,
        orientation: 'h' as const,
        y: rows.map((r) => r.label),
        x: rows.map((r) => r.psi),
        marker: { color: rows.map((r) => LEVEL_COLOR[r.level]) },
        hovertemplate: '%{y}: PSI %{x:.3f}<extra></extra>',
      },
    ]
  }, [d])

  const predChart = useMemo(() => {
    if (!d?.prediction) return []
    const p = d.prediction
    return [
      { type: 'scatter' as const, mode: 'lines' as const, name: 'Training reference', x: p.bins.map((b) => b * 100), y: p.ref_hist, line: { color: C.control, width: 2, shape: 'spline' as const }, fill: 'tozeroy' as const, fillcolor: tc('rgba(100,116,139,0.15)') },
      { type: 'scatter' as const, mode: 'lines' as const, name: 'Incoming batch', x: p.bins.map((b) => b * 100), y: p.cur_hist, line: { color: LEVEL_COLOR[p.level], width: 2, shape: 'spline' as const }, fill: 'tozeroy' as const, fillcolor: tc('rgba(251,113,133,0.10)') },
    ]
  }, [d])

  if (scenarios.error) return <ErrorBox message={scenarios.error} />

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Week 4 · Automated drift detection"
        title="Is the causal model still valid?"
        description="Effects learned from last quarter’s customers go stale when the population changes. Score a new batch of customers and compare it with the training data using the Population Stability Index, Kolmogorov–Smirnov tests and drift in the predicted uplift."
      />

      <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="h-fit">
          <CardHeader title="Simulate an incoming batch" icon={<Radar size={15} />} />
          {!scenarios.data ? (
            <Skeleton h={300} />
          ) : (
            <div className="space-y-2">
              {scenarios.data.scenarios.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setScenario(s.key)}
                  className={cx(
                    'w-full rounded-xl px-4 py-3 text-left ring-1 ring-inset transition-all',
                    scenario === s.key ? 'bg-teal-400/[0.07] ring-teal-400/40' : 'ring-white/[0.07] hover:ring-white/15',
                  )}
                >
                  <div className="text-[13px] font-semibold text-fog-100">{s.label}</div>
                  <div className="mt-0.5 text-[11.5px] leading-snug text-fog-400">{s.description}</div>
                </button>
              ))}
            </div>
          )}
          <div className="mt-5">
            <Slider label="Batch size" value={n} min={1000} max={20000} step={500} onChange={setN} format={fmtInt} />
          </div>
          <Button className="mt-5 w-full" onClick={run} disabled={busy} icon={busy ? <Spinner /> : <Radar size={15} />}>
            Score batch and check drift
          </Button>
          {err && <div className="mt-3"><ErrorBox message={err} /></div>}
        </Card>

        <div className="space-y-6">
          {!d && (
            <Card>
              <div className="py-16 text-center">
                <Radar className="mx-auto text-fog-500" size={32} />
                <div className="mt-3 font-display text-[16px] text-fog-200">No batch scored yet</div>
                <div className="mt-1 text-[13px] text-fog-500">Pick a market scenario and run the drift check.</div>
              </div>
            </Card>
          )}
          {d && (
            <>
              <Callout tone={d.status === 'alert' ? 'bad' : d.status === 'warn' ? 'warn' : 'good'} title={d.status === 'alert' ? 'Drift alert' : d.status === 'warn' ? 'Drift warning' : 'Population stable'}>
                {d.recommendation}
              </Callout>
              <div className="grid grid-cols-2 gap-4 2xl:grid-cols-4">
                <Stat label="Features in alert" value={d.drifted.length} tone={d.drifted.length ? 'bad' : 'good'} sub="PSI ≥ 0.25" />
                <Stat label="Features in warning" value={d.warnings.length} tone={d.warnings.length ? 'warn' : 'good'} sub="0.10 ≤ PSI < 0.25" />
                <Stat label="Prediction PSI" value={fmtNum(d.prediction?.psi, 3)} tone={d.prediction?.level === 'alert' ? 'bad' : d.prediction?.level === 'warn' ? 'warn' : 'good'} sub="drift in predicted uplift" />
                <Stat label="Batch vs reference" value={fmtInt(d.n_current)} sub={`vs ${fmtInt(d.n_reference)} training rows`} />
              </div>
              <div className="grid gap-6 2xl:grid-cols-2">
                <Card>
                  <CardHeader title="Population Stability Index by feature" subtitle="Dashed lines: warning at 0.10, alert at 0.25" />
                  <Plot
                    data={psiChart}
                    height={400}
                    layout={{
                      margin: { l: 150 },
                      xaxis: { title: 'PSI' },
                      showlegend: false,
                      shapes: [0.1, 0.25].map((x) => ({ type: 'line' as const, xref: 'x' as const, yref: 'paper' as const, x0: x, x1: x, y0: 0, y1: 1, line: { color: x === 0.1 ? C.warn : C.bad, dash: 'dash' as const, width: 1 } })),
                    }}
                  />
                </Card>
                <Card>
                  <CardHeader
                    title="Predicted uplift distribution"
                    subtitle={d.prediction ? `Mean τ̂($10): ${fmtPts(d.prediction.ref_mean)} in training → ${fmtPts(d.prediction.cur_mean)} in the new batch` : ''}
                  />
                  <Plot data={predChart} height={400} layout={{ xaxis: { title: 'τ̂($10) (pts)' }, yaxis: { title: 'Share' }, legend: { y: 1.12 } }} />
                </Card>
              </div>
              <Card pad={false}>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left text-[12.5px]">
                    <thead>
                      <tr className="border-b border-white/[0.06] text-[11px] uppercase tracking-wide text-fog-500">
                        <th className="px-5 py-3 font-medium">Feature</th>
                        <th className="px-3 py-3 font-medium">PSI</th>
                        <th className="px-3 py-3 font-medium">KS p-value</th>
                        <th className="px-3 py-3 font-medium">Reference mean</th>
                        <th className="px-3 py-3 font-medium">Batch mean</th>
                        <th className="px-3 py-3 font-medium">Shift (σ)</th>
                        <th className="px-3 py-3 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.features.map((f) => (
                        <tr key={f.feature} className="border-b border-white/[0.03]">
                          <td className="px-5 py-2.5 font-medium text-fog-100">{f.label}</td>
                          <td className="num px-3 py-2.5 text-fog-200">{fmtNum(f.psi, 3)}</td>
                          <td className="num px-3 py-2.5 text-fog-200">{fmtP(f.ks_pvalue)}</td>
                          <td className="num px-3 py-2.5 text-fog-300">{fmtNum(f.ref_mean, 2)}</td>
                          <td className="num px-3 py-2.5 text-fog-300">{fmtNum(f.cur_mean, 2)}</td>
                          <td className="num px-3 py-2.5 text-fog-300">{f.mean_shift >= 0 ? '+' : ''}{fmtNum(f.mean_shift, 2)}</td>
                          <td className="px-3 py-2.5">
                            <Badge tone={f.level === 'alert' ? 'bad' : f.level === 'warn' ? 'warn' : 'good'}>{f.level}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
