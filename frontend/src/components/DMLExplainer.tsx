import { useEffect, useMemo, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { useApi } from '../api/client'
import { fmtPts } from '../lib/format'
import { cx } from '../lib/cx'
import { Skeleton } from './ui'
import { tc } from '../lib/theme'

interface Residuals {
  arm: number
  theta: number
  naive: number
  dml_ate: number
  n_total: number
  points: { t: number[]; y: number[]; jt: number[]; jy: number[]; m: number[]; e: number[]; t_res: number[]; y_res: number[]; recency: number[] }
}

const W = 640
const H = 380
const PAD = 44

const STEPS = [
  {
    title: 'Raw observational data',
    text: 'Each dot is a customer: x = got the discount or not, y = bought or not. Colour = days since last order (a confounder). Lapsing customers (red) got more coupons and buy less, so the naive slope is biased down.',
  },
  {
    title: 'Stage 1 · Partial out the outcome',
    text: 'A cross-fitted LightGBM model predicts purchase from X alone. We keep only the residual Y − m̂(X): the part of buying that customer traits cannot explain.',
  },
  {
    title: 'Stage 2 · Partial out the treatment',
    text: 'A second model predicts who would have received the coupon, ê(X). The residual T − ê(X) is the “surprise” part of the treatment, as good as random given X.',
  },
  {
    title: 'Stage 3 · Regress residual on residual',
    text: 'Fitting the residuals against each other gives θ, the de-confounded causal effect. Because the two errors are orthogonal (Neyman), mistakes in either model barely move θ.',
  },
]

function lerpColor(a: string, b: string, t: number) {
  const pa = a.match(/\w\w/g)!.map((h) => parseInt(h, 16))
  const pb = b.match(/\w\w/g)!.map((h) => parseInt(h, 16))
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(',')})`
}

export default function DMLExplainer({ arm }: { arm: 10 | 20 }) {
  const { data } = useApi<Residuals>(`/api/model/residuals?arm=${arm}&n=450`)
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(true)

  useEffect(() => {
    if (!playing) return
    const t = window.setInterval(() => setStep((s) => (s + 1) % STEPS.length), 3600)
    return () => window.clearInterval(t)
  }, [playing])

  const colors = useMemo(() => {
    if (!data) return []
    const r = data.points.recency
    const sorted = [...r].sort((a, b) => a - b)
    return r.map((v) => lerpColor(tc('#2dd4bf').slice(1), tc('#fb7185').slice(1), sorted.indexOf(v) / Math.max(sorted.length - 1, 1)))
  }, [data])

  if (!data) return <Skeleton h={H} />
  const p = data.points
  const residualX = step >= 2
  const residualY = step >= 1
  const xDom: [number, number] = residualX ? [-1.05, 1.05] : [-0.45, 1.45]
  const yDom: [number, number] = residualY ? [-1.05, 1.05] : [-0.45, 1.45]
  const sx = (v: number) => PAD + ((v - xDom[0]) / (xDom[1] - xDom[0])) * (W - PAD * 1.5)
  const sy = (v: number) => H - PAD - ((v - yDom[0]) / (yDom[1] - yDom[0])) * (H - PAD * 1.6)

  const mean = (arr: number[], mask: boolean[]) => {
    const v = arr.filter((_, i) => mask[i])
    return v.reduce((a, b) => a + b, 0) / Math.max(v.length, 1)
  }
  const treated = p.t.map((v) => v > 0.5)
  const y1 = mean(p.y, treated)
  const y0 = mean(p.y, treated.map((v) => !v))

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="relative rounded-xl border border-white/[0.05] bg-ink-950/50">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
          {/* axes */}
          <line x1={PAD} x2={W - PAD / 2} y1={sy(0)} y2={sy(0)} stroke="rgba(148,163,184,0.25)" />
          <line x1={sx(0)} x2={sx(0)} y1={PAD * 0.6} y2={H - PAD} stroke="rgba(148,163,184,0.25)" />
          <text x={W - PAD / 2} y={H - 12} textAnchor="end" fill={tc('#7c859d')} fontSize="12" fontFamily="JetBrains Mono">
            {residualX ? 'T − ê(X)  (treatment residual)' : `T  (got $${arm}: 0 / 1)`}
          </text>
          <text x={14} y={22} fill={tc('#7c859d')} fontSize="12" fontFamily="JetBrains Mono">
            {residualY ? 'Y − m̂(X)  (outcome residual)' : 'Y  (purchased: 0 / 1)'}
          </text>

          {p.t.map((_, i) => {
            const x = residualX ? p.t_res[i] : p.t[i] + p.jt[i]
            const y = residualY ? p.y_res[i] : p.y[i] + p.jy[i]
            return (
              <circle
                key={i}
                r={3.1}
                cx={0}
                cy={0}
                fill={colors[i]}
                fillOpacity={0.62}
                style={{
                  transform: `translate(${sx(x)}px, ${sy(y)}px)`,
                  transition: `transform 1.1s cubic-bezier(0.65, 0, 0.35, 1) ${(i % 60) * 6}ms`,
                }}
              />
            )
          })}

          {step === 0 && (
            <g key="naive">
              <line x1={sx(0)} y1={sy(y0)} x2={sx(1)} y2={sy(y1)} stroke={tc('#fb7185')} strokeWidth="3" className="draw" style={{ '--len': 400 } as React.CSSProperties} />
              <circle cx={sx(0)} cy={sy(y0)} r={6} fill={tc('#fb7185')} />
              <circle cx={sx(1)} cy={sy(y1)} r={6} fill={tc('#fb7185')} />
              <text x={sx(1) + 10} y={sy(y1) - 10} fill={tc('#fecdd3')} fontSize="13" fontWeight="600">naive {fmtPts(data.naive)}</text>
            </g>
          )}
          {step === 3 && (
            <g key="theta">
              <line
                x1={sx(-1)}
                y1={sy(-data.theta)}
                x2={sx(1)}
                y2={sy(data.theta)}
                stroke={tc('#2dd4bf')}
                strokeWidth="3.5"
                className="draw"
                style={{ '--len': 700 } as React.CSSProperties}
              />
              <text x={sx(0.55)} y={sy(data.theta * 0.55) - 14} fill={tc('#99f6e4')} fontSize="14" fontWeight="700">θ = {fmtPts(data.theta)}</text>
            </g>
          )}
        </svg>
        <div className="absolute bottom-3 left-14 flex items-center gap-2 text-[11px] text-fog-400">
          <span className="h-2 w-16 rounded-full" style={{ background: `linear-gradient(90deg,${tc('#2dd4bf')},${tc('#fb7185')})` }} />
          recent → lapsing customer
        </div>
      </div>

      <div className="flex flex-col">
        <div className="space-y-2">
          {STEPS.map((s, i) => (
            <button
              key={s.title}
              onClick={() => {
                setStep(i)
                setPlaying(false)
              }}
              className={cx(
                'w-full rounded-xl border px-4 py-3 text-left transition-all duration-300',
                step === i ? 'border-teal-400/40 bg-teal-400/[0.07]' : 'border-white/[0.05] bg-ink-900/40 opacity-60 hover:opacity-100',
              )}
            >
              <div className="flex items-center gap-2 text-[13px] font-semibold text-fog-100">
                <span className={cx('flex h-5 w-5 items-center justify-center rounded-full font-mono text-[10.5px]', step === i ? 'bg-teal-400 text-ink-950' : 'bg-white/10 text-fog-300')}>
                  {i + 1}
                </span>
                {s.title}
              </div>
              {step === i && <p className="fade-up mt-1.5 text-[12px] leading-relaxed text-fog-300">{s.text}</p>}
            </button>
          ))}
        </div>
        <div className="mt-auto flex items-center justify-between pt-4">
          <button onClick={() => setPlaying((v) => !v)} className="flex items-center gap-2 rounded-lg px-2 py-1 text-[12px] font-medium text-fog-300 hover:bg-white/5">
            {playing ? <Pause size={14} /> : <Play size={14} />} {playing ? 'Pause' : 'Autoplay'}
          </button>
          <div className="num text-right text-[11.5px] text-fog-500">
            naive {fmtPts(data.naive)} → θ {fmtPts(data.theta)}
            <br />
            sample of 450 / {data.n_total.toLocaleString()} customers
          </div>
        </div>
      </div>
    </div>
  )
}
