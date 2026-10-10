import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Database,
  Download,
  FileCode2,
  FlaskConical,
  GitFork,
  Info,
  LayoutDashboard,
  Play,
  Radar,
  Scale,
  Search,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Wallet,
  X,
  XCircle,
} from 'lucide-react'
import { DEMO, exportAllocationCsv, post } from '../api/client'
import { useApp, type Page } from '../store/useApp'
import { useToasts } from '../store/useToasts'
import { cx } from '../lib/cx'

/* ── Toasts ─────────────────────────────────────────────────────────────── */

export function Toasts() {
  const { toasts, dismiss } = useToasts()
  const icon = {
    good: <CheckCircle2 size={18} className="text-emerald-300" />,
    info: <Info size={18} className="text-sky-300" />,
    warn: <TriangleAlert size={18} className="text-amber-300" />,
    bad: <XCircle size={18} className="text-rose-300" />,
  }
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="toast-in pointer-events-auto flex gap-3 rounded-2xl border border-white/10 bg-ink-800/95 p-4 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.8)] backdrop-blur-xl"
        >
          <div className="mt-0.5">{icon[t.tone]}</div>
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-semibold text-fog-100">{t.title}</div>
            {t.body && <div className="mt-0.5 text-[12.5px] leading-snug text-fog-300">{t.body}</div>}
          </div>
          <button onClick={() => dismiss(t.id)} className="self-start rounded p-0.5 text-fog-500 hover:text-fog-200">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}

/* ── Command palette ────────────────────────────────────────────────────── */

interface Command {
  id: string
  label: string
  hint: string
  group: 'Navigate' | 'Actions' | 'What-If personas'
  icon: ReactNode
  run: () => void
}

export function CommandPalette() {
  const { setPage, openRunDrawer, palette, setPalette } = useApp()
  const push = useToasts((s) => s.push)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette(!useApp.getState().palette)
      }
      if (e.key === 'Escape') setPalette(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setPalette])

  const commands = useMemo<Command[]>(() => {
    const nav = (page: Page, label: string, hint: string, icon: ReactNode): Command => ({
      id: `nav-${page}`,
      label,
      hint,
      group: 'Navigate',
      icon,
      run: () => setPage(page),
    })
    const persona = (p: string): Command => ({
      id: `persona-${p}`,
      label: `Open a typical ${p.replace(/s$/, '')}`,
      hint: 'What-If Lab',
      group: 'What-If personas',
      icon: <Sparkles size={15} />,
      run: () => {
        useApp.setState({ labPersona: p })
        setPage('lab')
      },
    })
    return [
      nav('overview', 'Overview', 'KPIs & recommendation', <LayoutDashboard size={15} />),
      nav('lab', 'What-If Lab', 'Counterfactual simulator', <Sparkles size={15} />),
      nav('data', 'Data Studio', 'Campaign data', <Database size={15} />),
      nav('graph', 'Causal Graph', 'DAG & identification', <GitFork size={15} />),
      nav('balance', 'Propensity & Balance', 'IPW, matching, love plot', <Scale size={15} />),
      nav('effects', 'Treatment Effects', 'Double ML, champion/challenger', <FlaskConical size={15} />),
      nav('uplift', 'Uplift & Segments', 'Qini, quadrant map', <BarChart3 size={15} />),
      nav('audit', 'Causal Audit', 'Refutation tests', <ShieldCheck size={15} />),
      nav('optimizer', 'Budget Optimizer', 'MILP allocation', <Wallet size={15} />),
      nav('drift', 'Drift Monitor', 'PSI & KS', <Radar size={15} />),
      { id: 'run', label: 'Start a new pipeline run', hint: 'Retrain everything', group: 'Actions', icon: <Play size={15} />, run: () => openRunDrawer(true) },
      {
        id: 'audit',
        label: 'Re-run the refutation audit',
        hint: 'DoWhy · ~30s',
        group: 'Actions',
        icon: <ShieldCheck size={15} />,
        run: () =>
          post('/api/causal/refutation')
            .then(() => push({ tone: 'info', title: 'Audit started', body: 'Refutation battery running in the background.' }))
            .catch((e: Error) => push({ tone: 'bad', title: 'Could not start audit', body: e.message })),
      },
      { id: 'csv', label: 'Export prescription CSV', hint: 'Targeted customers', group: 'Actions', icon: <Download size={15} />, run: exportAllocationCsv },
      ...(DEMO
        ? []
        : [{ id: 'docs', label: 'Open API docs', hint: 'OpenAPI / Swagger', group: 'Actions' as const, icon: <FileCode2 size={15} />, run: () => window.open('http://localhost:8000/docs') }]),
      ...['Persuadables', 'Sure Things', 'Lost Causes', 'Sleeping Dogs'].map(persona),
    ]
  }, [setPage, openRunDrawer, push])

  const filtered = commands.filter((c) => (c.label + ' ' + c.hint + ' ' + c.group).toLowerCase().includes(q.toLowerCase()))

  useEffect(() => {
    if (palette) {
      const id = requestAnimationFrame(() => inputRef.current?.focus())
      return () => cancelAnimationFrame(id)
    }
  }, [palette])

  if (!palette) return null

  const exec = (c: Command | undefined) => {
    if (!c) return
    setPalette(false)
    setQ('')
    c.run()
  }

  let lastGroup = ''
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[12vh]">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setPalette(false)} />
      <div className="palette-in relative w-full max-w-xl overflow-hidden rounded-2xl border border-white/10 bg-ink-850/95 shadow-[0_40px_120px_-20px_rgba(0,0,0,0.9)] backdrop-blur-2xl">
        <div className="flex items-center gap-3 border-b border-white/[0.06] px-4">
          <Search size={17} className="text-fog-400" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setActive(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((a) => Math.min(a + 1, filtered.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((a) => Math.max(a - 1, 0))
              } else if (e.key === 'Enter') exec(filtered[active])
            }}
            placeholder="Jump to a page or run an action…"
            className="h-14 flex-1 bg-transparent text-[15px] text-fog-100 outline-none placeholder:text-fog-500"
          />
          <kbd className="rounded-md border border-white/10 px-1.5 py-0.5 font-mono text-[10.5px] text-fog-400">ESC</kbd>
        </div>
        <div className="max-h-[52vh] overflow-y-auto p-2">
          {filtered.length === 0 && <div className="px-3 py-8 text-center text-[13px] text-fog-500">No matches</div>}
          {filtered.map((c, i) => {
            const header = c.group !== lastGroup
            lastGroup = c.group
            return (
              <div key={c.id}>
                {header && <div className="px-3 pb-1 pt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-fog-500">{c.group}</div>}
                <button
                  onMouseEnter={() => setActive(i)}
                  onClick={() => exec(c)}
                  className={cx(
                    'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors',
                    i === active ? 'bg-teal-400/10 text-fog-100' : 'text-fog-300',
                  )}
                >
                  <span className={i === active ? 'text-arm10' : 'text-fog-500'}>{c.icon}</span>
                  <span className="flex-1 text-[13.5px] font-medium">{c.label}</span>
                  <span className="text-[11.5px] text-fog-500">{c.hint}</span>
                  {i === active && <ArrowRight size={14} className="text-arm10" />}
                </button>
              </div>
            )
          })}
        </div>
        <div className="flex items-center gap-4 border-t border-white/[0.06] px-4 py-2 font-mono text-[10.5px] text-fog-500">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>⌘K toggle</span>
        </div>
      </div>
    </div>
  )
}
