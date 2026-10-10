import { useMemo, useState } from 'react'
import { useApi } from '../api/client'
import type { Effect, Graph, GraphNode, Identification } from '../api/types'
import { Badge, Card, CardHeader, ErrorBox, PageHeader, Segmented, Skeleton } from '../components/ui'
import Counter from '../components/Counter'
import { fmtPts } from '../lib/format'
import { C, ROLE_COLOR, armColor, tc } from '../lib/theme'

const W = 980
const H = 600

const ROLE_TEXT: Record<GraphNode['role'], string> = {
  treatment: 'The intervention we control: which discount (if any) a customer receives.',
  outcome: 'What we want to change: whether the customer purchases within 14 days.',
  confounder: 'Drove both the historical discount decision and purchasing. Opens a back-door path, so it must be adjusted for.',
  modifier: 'Affects purchasing and how strongly a customer responds to a discount (effect heterogeneity), but did not drive targeting.',
  latent: 'Unobserved trait. Mostly explained by observed features, so the DML final stage can recover its effect on uplift.',
}

function layout(nodes: GraphNode[]) {
  const pos: Record<string, { x: number; y: number }> = {}
  const conf = nodes.filter((n) => n.role === 'confounder')
  const mods = nodes.filter((n) => n.role === 'modifier')
  conf.forEach((n, i) => (pos[n.id] = { x: 205 + (i * (775 - 205)) / Math.max(conf.length - 1, 1), y: 92 }))
  mods.forEach((n, i) => (pos[n.id] = { x: 110 + (i * (W - 220)) / Math.max(mods.length - 1, 1), y: i % 2 ? 530 : 470 }))
  nodes.forEach((n) => {
    if (n.role === 'treatment') pos[n.id] = { x: 140, y: 285 }
    if (n.role === 'outcome') pos[n.id] = { x: 840, y: 285 }
    if (n.role === 'latent') pos[n.id] = { x: 610, y: 372 }
  })
  return pos
}

const boxW = (label: string) => Math.max(92, label.length * 7.1 + 30)
const BOX_H = 34

function trim(x1: number, y1: number, x2: number, y2: number, w1: number, w2: number) {
  const dx = x2 - x1
  const dy = y2 - y1
  const t1 = Math.min(w1 / 2 / Math.abs(dx || 1e-6), BOX_H / 2 / Math.abs(dy || 1e-6), 0.5)
  const t2 = Math.min(w2 / 2 / Math.abs(dx || 1e-6), BOX_H / 2 / Math.abs(dy || 1e-6), 0.5)
  return { x1: x1 + dx * t1, y1: y1 + dy * t1, x2: x2 - dx * (t2 + 0.012), y2: y2 - dy * (t2 + 0.012) }
}

export default function CausalGraph() {
  const graph = useApi<Graph>('/api/causal/graph')
  const ident = useApi<Identification>('/api/causal/identification')
  const effects = useApi<{ effects: Effect[] }>('/api/causal/effects')
  const [hover, setHover] = useState<string | null>(null)
  const [selected, setSelected] = useState<string>('discount')
  const [adjusted, setAdjusted] = useState(false)

  const pos = useMemo(() => (graph.data ? layout(graph.data.nodes) : {}), [graph.data])

  if (graph.error) return <ErrorBox message={graph.error} />
  if (!graph.data) return <Skeleton h={640} />

  const g = graph.data
  const labelOf = Object.fromEntries(g.nodes.map((n) => [n.id, n.label]))
  const focus = hover ?? null
  const sel = g.nodes.find((n) => n.id === selected)
  const isBackdoor = (s: string, t: string) =>
    g.adjustment_set.includes(s) && (t === 'discount' || t === 'purchased')

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Week 1 · Causal graphing (DoWhy)"
        title="Causal graph and identification"
        description="Domain knowledge written as a directed acyclic graph. DoWhy uses the back-door criterion to find which variables we must adjust for so the discount → purchase effect can be estimated without bias."
      />

      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardHeader
            title="Structural causal model"
            subtitle="Red particles = confounding leaking through back-door paths. Adjust for the confounders to block them and watch the estimate move from naive to causal."
            right={
              <Segmented
                size="sm"
                value={adjusted ? 'adj' : 'naive'}
                onChange={(v) => setAdjusted(v === 'adj')}
                options={[
                  { value: 'naive', label: 'Naive (open back-doors)' },
                  { value: 'adj', label: 'Adjusted (blocked)' },
                ]}
              />
            }
          />
          {effects.data && (
            <div className="mb-3 flex flex-wrap items-center gap-3">
              {effects.data.effects.map((e) => (
                <div
                  key={e.arm}
                  className={`flex items-center gap-3 rounded-xl border px-4 py-2 transition-colors duration-500 ${adjusted ? 'border-teal-400/30 bg-teal-400/[0.06]' : 'border-rose-400/30 bg-rose-400/[0.06]'}`}
                >
                  <span className="text-[12px] text-fog-400">Effect of ${e.arm}</span>
                  <span className={`num text-[18px] font-semibold ${adjusted ? 'text-teal-200' : 'text-rose-200'}`}>
                    <Counter value={adjusted ? e.dml.value : e.naive} format={fmtPts} />
                  </span>
                  <span className="text-[11px] text-fog-500">{adjusted ? 'Double ML' : 'naive'}</span>
                </div>
              ))}
              {effects.data.effects[0].truth !== null && (
                <span className="text-[12px] text-fog-500">
                  truth: {effects.data.effects.map((e) => fmtPts(e.truth ?? 0)).join(' / ')}
                </span>
              )}
            </div>
          )}
          <div className="overflow-x-auto">
            <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto min-w-[760px]" style={{ width: '100%', maxHeight: 580 }}>
              <defs>
                {[tc('#7c859d'), C.legacy, C.arm10, tc('#60a5fa'), tc('#3a4560')].map((c) => (
                  <marker key={c} id={`arrow-${c.replace('#', '')}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill={c} />
                  </marker>
                ))}
                <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="4" result="b" />
                  <feMerge>
                    <feMergeNode in="b" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* zone labels */}
              <text x={20} y={60} fill={tc('#5a6379')} fontSize="10.5" fontFamily="JetBrains Mono" letterSpacing="2">CONFOUNDERS · ADJUSTMENT SET</text>
              <text x={20} y={588} fill={tc('#5a6379')} fontSize="10.5" fontFamily="JetBrains Mono" letterSpacing="2">OUTCOME DRIVERS · EFFECT MODIFIERS</text>

              {g.edges.map((e, i) => {
                const a = pos[e.source]
                const b = pos[e.target]
                if (!a || !b) return null
                const t = trim(a.x, a.y, b.x, b.y, boxW(labelOf[e.source] ?? ''), boxW(labelOf[e.target] ?? ''))
                const back = isBackdoor(e.source, e.target)
                const cut = adjusted && back && e.target === 'discount'
                const main = e.source === 'discount' && e.target === 'purchased'
                const touches = focus && (e.source === focus || e.target === focus)
                const dim = focus && !touches
                let color = tc('#3a4560')
                if (main) color = C.arm10
                else if (back && !adjusted) color = C.legacy
                else if (back) color = tc('#7c859d')
                else if (touches) color = tc('#60a5fa')
                else if (e.kind !== 'causal') color = tc('#7c859d')
                const d = `M ${t.x1} ${t.y1} L ${t.x2} ${t.y2}`
                const particles = main ? 3 : back && !adjusted ? 2 : 0
                const mx = (t.x1 + t.x2) / 2
                const my = (t.y1 + t.y2) / 2
                return (
                  <g key={i}>
                    <path
                      id={`edge-${i}`}
                      d={d}
                      stroke={color}
                      strokeWidth={main ? 3 : back || touches ? 1.8 : 1.1}
                      strokeOpacity={dim ? 0.12 : cut ? 0.25 : main || back || touches ? 0.95 : 0.55}
                      strokeDasharray={cut ? '3 5' : !main && (e.kind === 'latent' || e.kind === 'modifier') ? '5 4' : undefined}
                      className={main ? 'edge-flow' : undefined}
                      style={{ transition: 'stroke 0.5s, stroke-opacity 0.5s' }}
                      fill="none"
                      markerEnd={`url(#arrow-${color.replace('#', '')})`}
                    />
                    {!dim &&
                      Array.from({ length: particles }).map((_, k) => (
                        <circle key={k} r={main ? 4 : 3} fill={main ? C.arm10 : C.legacy} filter="url(#glow)">
                          <animateMotion dur={main ? '1.8s' : '2.6s'} begin={`${-k * (main ? 0.6 : 1.3) - (i % 5) * 0.4}s`} repeatCount="indefinite">
                            <mpath href={`#edge-${i}`} />
                          </animateMotion>
                        </circle>
                      ))}
                    {cut && (
                      <g transform={`translate(${mx}, ${my})`} className="fade-up">
                        <circle r={9} fill={tc('#0e121d')} stroke={tc('#fb7185')} strokeWidth="1.5" />
                        <path d="M -4 -4 L 4 4 M 4 -4 L -4 4" stroke={tc('#fb7185')} strokeWidth="2" strokeLinecap="round" />
                      </g>
                    )}
                  </g>
                )
              })}

              {g.nodes.map((n) => {
                const p = pos[n.id]
                if (!p) return null
                const w = boxW(n.label)
                const color = ROLE_COLOR[n.role]
                const big = n.role === 'treatment' || n.role === 'outcome'
                const dim = focus && focus !== n.id && !g.edges.some((e) => (e.source === focus && e.target === n.id) || (e.target === focus && e.source === n.id))
                return (
                  <g
                    key={n.id}
                    transform={`translate(${p.x - w / 2}, ${p.y - BOX_H / 2})`}
                    onMouseEnter={() => setHover(n.id)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => setSelected(n.id)}
                    style={{ cursor: 'pointer', opacity: dim ? 0.3 : 1, transition: 'opacity .2s' }}
                  >
                    <rect
                      width={w}
                      height={BOX_H}
                      rx={big ? 17 : 10}
                      fill={big ? `${color}22` : tc('#121725')}
                      stroke={selected === n.id ? tc('#eef0f6') : color}
                      strokeWidth={selected === n.id ? 1.8 : big ? 1.6 : 1}
                      strokeDasharray={n.role === 'latent' ? '4 3' : undefined}
                      filter={big ? 'url(#glow)' : undefined}
                    />
                    <circle cx={13} cy={BOX_H / 2} r={3.5} fill={color} />
                    {adjusted && n.role === 'confounder' && (
                      <rect x={-4} y={-4} width={w + 8} height={BOX_H + 8} rx={14} fill="none" stroke={tc('#2dd4bf')} strokeWidth="1.2" strokeDasharray="4 3" className="fade-up" />
                    )}
                    <text x={w / 2 + 6} y={BOX_H / 2 + 4.2} textAnchor="middle" fill={tc('#eef0f6')} fontSize={big ? 13 : 12} fontWeight={big ? 600 : 500} fontFamily="Inter">
                      {n.label}
                    </text>
                  </g>
                )
              })}
            </svg>
          </div>
          <div className="mt-3 flex flex-wrap gap-4 border-t border-white/[0.05] pt-3 text-[11.5px] text-fog-300">
            {(Object.keys(ROLE_COLOR) as GraphNode['role'][]).map((r) => (
              <span key={r} className="flex items-center gap-1.5 capitalize">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: ROLE_COLOR[r] }} />
                {r}
              </span>
            ))}
          </div>
        </Card>

        <div className="space-y-6">
          {sel && (
            <Card>
              <div className="mb-2 flex items-center gap-2">
                <Badge tone={sel.role === 'confounder' ? 'bad' : sel.role === 'treatment' ? 'teal' : sel.role === 'outcome' ? 'warn' : 'info'}>{sel.role}</Badge>
              </div>
              <div className="font-display text-[17px] font-semibold text-fog-100">{sel.label}</div>
              <p className="mt-2 text-[13px] leading-relaxed text-fog-300">{ROLE_TEXT[sel.role]}</p>
              <div className="mt-3 text-[12px] text-fog-500">
                Parents: {g.edges.filter((e) => e.target === sel.id).map((e) => labelOf[e.source]).join(', ') || 'none'}
                <br />
                Children: {g.edges.filter((e) => e.source === sel.id).map((e) => labelOf[e.target]).join(', ') || 'none'}
              </div>
            </Card>
          )}
          <Card>
            <CardHeader title="Identified estimand" subtitle={ident.data?.method} />
            {ident.data ? (
              <>
                <div className="rounded-xl bg-ink-950/70 p-3 font-mono text-[12px] leading-relaxed text-teal-200">{ident.data.expression}</div>
                <div className="mt-4 text-[12px] font-medium text-fog-400">Back-door adjustment set</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {ident.data.backdoor_variables.map((v) => (
                    <Badge key={v} tone="bad">
                      {labelOf[v] ?? v}
                    </Badge>
                  ))}
                </div>
                <div className="mt-4 text-[12px] font-medium text-fog-400">Identifying assumptions</div>
                <ul className="mt-2 space-y-2">
                  {ident.data.assumptions.map((a) => (
                    <li key={a} className="text-[12.5px] leading-snug text-fog-300">
                      <span className="font-semibold text-fog-100">{a.split(':')[0]}:</span>
                      {a.split(':').slice(1).join(':')}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <Skeleton h={200} />
            )}
          </Card>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {effects.data?.effects.map((e) => (
          <Card key={e.arm}>
            <CardHeader
              title={<span style={{ color: armColor(e.arm) }}>${e.arm} discount: naive vs causal</span>}
              subtitle="Average change in purchase probability"
            />
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl bg-rose-400/[0.06] p-3 ring-1 ring-inset ring-rose-400/15">
                <div className="text-[11px] uppercase tracking-wide text-rose-300/80">Naive</div>
                <div className="num mt-1 text-[20px] font-semibold text-rose-200">{fmtPts(e.naive)}</div>
              </div>
              <div className="rounded-xl bg-teal-400/[0.06] p-3 ring-1 ring-inset ring-teal-400/20">
                <div className="text-[11px] uppercase tracking-wide text-teal-300/80">Double ML</div>
                <div className="num mt-1 text-[20px] font-semibold text-teal-200">{fmtPts(e.dml.value)}</div>
              </div>
              <div className="rounded-xl bg-amber-400/[0.06] p-3 ring-1 ring-inset ring-amber-400/15">
                <div className="text-[11px] uppercase tracking-wide text-amber-300/80">Truth</div>
                <div className="num mt-1 text-[20px] font-semibold text-amber-200">{e.truth !== null ? fmtPts(e.truth) : 'n/a'}</div>
              </div>
            </div>
            <p className="mt-4 text-[13px] leading-relaxed text-fog-300">{e.story}</p>
          </Card>
        ))}
      </div>
    </div>
  )
}
