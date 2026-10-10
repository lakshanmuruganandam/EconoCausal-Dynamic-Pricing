import { useEffect, useState } from 'react'
import { CheckCircle2, RefreshCw, ShieldCheck, XCircle } from 'lucide-react'
import { post, useApi } from '../api/client'
import type { Refutation } from '../api/types'
import { Badge, Button, Callout, Card, CardHeader, ErrorBox, PageHeader, Skeleton, Spinner } from '../components/ui'
import { fmtP, fmtPts } from '../lib/format'
import { armColor } from '../lib/theme'
import { useApp } from '../store/useApp'

function EffectBar({ original, next, color }: { original: number; next: number | null; color: string }) {
  const max = Math.max(Math.abs(original), Math.abs(next ?? 0), 1e-6) * 1.15
  const w = (v: number) => `${(Math.abs(v) / max) * 100}%`
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="w-16 text-[11px] text-fog-500">original</span>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-700">
          <div className="h-full rounded-full" style={{ width: w(original), background: color }} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-16 text-[11px] text-fog-500">refuted</span>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-700">
          {next !== null && <div className="h-full rounded-full bg-fog-300" style={{ width: w(next) }} />}
        </div>
      </div>
    </div>
  )
}

export default function Audit() {
  const { data, error, refetch } = useApi<Refutation>('/api/causal/refutation')
  const refutationStatus = useApp((s) => s.status?.refutation)
  const [starting, setStarting] = useState(false)

  // Re-fetch when the background audit finishes
  useEffect(() => {
    if (refutationStatus === 'ready' || refutationStatus?.startsWith('error')) refetch()
  }, [refutationStatus, refetch])

  const rerun = async () => {
    setStarting(true)
    try {
      await post('/api/causal/refutation')
      refetch()
    } finally {
      setStarting(false)
    }
  }

  if (error) return <ErrorBox message={error} />
  if (!data) return <Skeleton h={600} />
  const r = data.result
  const running = refutationStatus === 'running'

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Mid-project review · Causal audit"
        title="Refutation tests"
        description="An estimate is only trusted if it survives tests built to break it. DoWhy re-estimates the effect after scrambling the treatment, adding fake confounders, sub-sampling and simulating hidden confounding. A real causal effect should behave as predicted every time."
        right={
          <Button variant="outline" onClick={rerun} disabled={running || starting} icon={running ? <Spinner /> : <RefreshCw size={14} />}>
            {running ? 'Running…' : 'Re-run audit'}
          </Button>
        }
      />

      {!r && (
        <Card>
          <div className="flex items-center gap-3 text-[13.5px] text-fog-300">
            <Spinner className="text-arm10" />
            The refutation battery runs in the background after training (about 30 seconds). This page updates automatically.
          </div>
        </Card>
      )}

      {r && (
        <>
          <div
            className={`fade-up flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-6 ${
              r.verdict === 'PASS' ? 'border-emerald-400/25 bg-emerald-400/[0.06]' : r.verdict === 'PARTIAL' ? 'border-amber-400/25 bg-amber-400/[0.06]' : 'border-rose-400/25 bg-rose-400/[0.06]'
            }`}
          >
            <div className="flex items-center gap-4">
              <div className={`rounded-2xl p-3 ${r.verdict === 'PASS' ? 'bg-emerald-400/15 text-emerald-300' : 'bg-amber-400/15 text-amber-300'}`}>
                <ShieldCheck size={28} />
              </div>
              <div>
                <div className="font-display text-[22px] font-semibold text-fog-100">
                  {r.verdict === 'PASS' ? 'Causal effect survives every refutation' : r.verdict === 'PARTIAL' ? 'Most refutations passed' : 'Estimate failed refutation'}
                </div>
                <div className="text-[13px] text-fog-300">
                  {r.passed} of {r.total} tests passed across both discount levels · estimator: back-door linear regression on the DoWhy-identified estimand
                </div>
              </div>
            </div>
            <div className="num text-[40px] font-semibold text-fog-100">
              {r.passed}
              <span className="text-fog-500">/{r.total}</span>
            </div>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            {r.arms.map((a) => (
              <Card key={a.arm}>
                <CardHeader
                  title={<span style={{ color: armColor(a.arm) }}>${a.arm} discount</span>}
                  subtitle={`Original estimate ${fmtPts(a.estimate)} · n = ${a.n.toLocaleString()} (sampled for speed)`}
                />
                <div className="space-y-3">
                  {a.tests.map((t) => (
                    <div key={t.key} className="rounded-xl border border-white/[0.05] bg-ink-900/60 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-[13.5px] font-semibold text-fog-100">
                            {t.passed ? <CheckCircle2 size={16} className="text-emerald-400" /> : <XCircle size={16} className="text-rose-400" />}
                            {t.label}
                          </div>
                          <p className="mt-1 text-[12px] leading-snug text-fog-400">{t.description}</p>
                        </div>
                        <Badge tone={t.passed ? 'good' : 'bad'}>{t.passed ? 'PASS' : 'FAIL'}</Badge>
                      </div>
                      <div className="mt-3 grid grid-cols-[1fr_auto] items-center gap-4">
                        <EffectBar original={t.original} next={t.new_effect} color={armColor(a.arm)} />
                        <div className="num text-right text-[12px] leading-relaxed">
                          <div className="text-fog-200">{t.new_effect !== null ? fmtPts(t.new_effect, 2) : '—'}</div>
                          <div className="text-fog-500">p {fmtP(t.p_value)}</div>
                        </div>
                      </div>
                      <div className="mt-2 text-[11.5px] text-fog-500">{t.note}</div>
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>

          <Callout tone="info" title="How to read this">
            <b>Placebo</b>: after randomly shuffling who received the discount, the effect should vanish. <b>Random common cause</b> and <b>data subset</b>:
            the estimate should barely move. <b>Bootstrap</b>: resampling should give a stable effect. <b>Unobserved confounder</b>: a simulated hidden
            confounder of moderate strength should not flip the sign of the effect.
          </Callout>
        </>
      )}
    </div>
  )
}
