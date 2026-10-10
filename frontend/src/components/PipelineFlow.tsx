import type { ReactNode } from 'react'
import { useApp, type Page } from '../store/useApp'

export interface FlowStage {
  key: string
  title: string
  metric: ReactNode
  caption: string
  icon: ReactNode
  color: string
  page: Page
}

const W = 1200
const H = 210
const Y = 70

/**
 * Animated end-to-end pipeline: data particles stream through each stage of
 * the causal engine. Every node is a live metric and a link to its page.
 */
export default function PipelineFlow({ stages }: { stages: FlowStage[] }) {
  const setPage = useApp((s) => s.setPage)
  const n = stages.length
  const xs = stages.map((_, i) => 90 + (i * (W - 180)) / (n - 1))

  return (
    <div className="relative overflow-x-auto">
      <div className="relative min-w-[920px]" style={{ aspectRatio: `${W} / ${H}` }}>
        <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" aria-hidden>
          <defs>
            {stages.slice(0, -1).map((s, i) => (
              <linearGradient key={s.key} id={`flow-g-${i}`} x1="0" x2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity="0.9" />
                <stop offset="100%" stopColor={stages[i + 1].color} stopOpacity="0.9" />
              </linearGradient>
            ))}
            <filter id="flow-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {stages.slice(0, -1).map((s, i) => {
            const x1 = xs[i] + 40
            const x2 = xs[i + 1] - 40
            const mid = (x1 + x2) / 2
            const bend = i % 2 ? 16 : -16
            const d = `M ${x1} ${Y} C ${mid} ${Y + bend}, ${mid} ${Y - bend}, ${x2} ${Y}`
            return (
              <g key={s.key}>
                <path d={d} stroke={`url(#flow-g-${i})`} strokeOpacity="0.25" strokeWidth="2" fill="none" />
                <path id={`flow-p-${i}`} d={d} stroke={`url(#flow-g-${i})`} strokeWidth="2" fill="none" className="edge-flow" strokeOpacity="0.7" />
                {[0, 1, 2].map((k) => (
                  <circle key={k} r={k === 0 ? 4 : 2.6} fill={k === 0 ? stages[i + 1].color : s.color} filter="url(#flow-glow)">
                    <animateMotion dur={`${2.2 + k * 0.35}s`} begin={`${-k * 0.8 - i * 0.3}s`} repeatCount="indefinite" rotate="auto">
                      <mpath href={`#flow-p-${i}`} />
                    </animateMotion>
                  </circle>
                ))}
              </g>
            )
          })}
          {/* pulse on the final decision node */}
          <circle cx={xs[n - 1]} cy={Y} r={34} fill="none" stroke={stages[n - 1].color} strokeWidth="2" className="pulse-ring" />
        </svg>

        {stages.map((s, i) => (
          <button
            key={s.key}
            onClick={() => setPage(s.page)}
            className="group absolute flex -translate-x-1/2 flex-col items-center text-center"
            style={{ left: `${(xs[i] / W) * 100}%`, top: `${((Y - 34) / H) * 100}%`, width: 170 }}
          >
            <span
              className="flex h-[68px] w-[68px] items-center justify-center rounded-2xl border transition-all duration-300 group-hover:-translate-y-1 group-hover:scale-105"
              style={{
                borderColor: `${s.color}55`,
                background: `radial-gradient(circle at 30% 20%, ${s.color}33, var(--color-ink-850) 70%)`,
                boxShadow: `0 0 0 4px ${s.color}10, 0 12px 30px -10px ${s.color}80`,
                color: s.color,
              }}
            >
              {s.icon}
            </span>
            <span className="mt-3 text-[11px] font-medium uppercase tracking-[0.12em] text-fog-400 group-hover:text-fog-200">{s.title}</span>
            <span className="num mt-0.5 text-[17px] font-semibold text-fog-100">{s.metric}</span>
            <span className="text-[11px] text-fog-500">{s.caption}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
