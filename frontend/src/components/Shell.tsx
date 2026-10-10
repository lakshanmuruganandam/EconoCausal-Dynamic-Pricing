import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Activity,
  BarChart3,
  Database,
  FlaskConical,
  GitFork,
  LayoutDashboard,
  Play,
  Radar,
  Scale,
  Moon,
  Search,
  ShieldCheck,
  Sparkles,
  Sun,
  Upload,
  Wallet,
  X,
} from 'lucide-react'
import { DEMO, REPO_URL, api, post, fileHref } from '../api/client'
import type { Status } from '../api/types'
import { useApp, type Page } from '../store/useApp'
import { Badge, Button, Callout, ErrorBox, Segmented, Slider, Spinner } from './ui'
import { cx } from '../lib/cx'
import { fmtInt } from '../lib/format'

const NAV: { group: string; items: { page: Page; label: string; icon: ReactNode }[] }[] = [
  {
    group: 'Command',
    items: [
      { page: 'overview', label: 'Overview', icon: <LayoutDashboard size={16} /> },
      { page: 'lab', label: 'What-If Lab', icon: <Sparkles size={16} /> },
    ],
  },
  {
    group: 'Causal inference',
    items: [
      { page: 'data', label: 'Data Studio', icon: <Database size={16} /> },
      { page: 'graph', label: 'Causal Graph', icon: <GitFork size={16} /> },
      { page: 'balance', label: 'Propensity & Balance', icon: <Scale size={16} /> },
      { page: 'effects', label: 'Treatment Effects', icon: <FlaskConical size={16} /> },
      { page: 'uplift', label: 'Uplift & Segments', icon: <BarChart3 size={16} /> },
      { page: 'audit', label: 'Causal Audit', icon: <ShieldCheck size={16} /> },
    ],
  },
  {
    group: 'Decisions',
    items: [
      { page: 'optimizer', label: 'Budget Optimizer', icon: <Wallet size={16} /> },
      { page: 'drift', label: 'Drift Monitor', icon: <Radar size={16} /> },
    ],
  },
]

const PAGE_TITLES: Record<Page, string> = Object.fromEntries(NAV.flatMap((g) => g.items.map((i) => [i.page, i.label]))) as Record<Page, string>

function Logo() {
  return (
    <div className="flex items-center gap-3 px-2">
      <svg viewBox="0 0 32 32" className="h-9 w-9">
        <rect width="32" height="32" rx="9" fill="#121725" stroke="rgba(255,255,255,0.08)" />
        <circle cx="9" cy="10" r="3.2" fill="#2dd4bf" />
        <circle cx="23" cy="10" r="3.2" fill="#a78bfa" />
        <circle cx="16" cy="23" r="3.6" fill="#fbbf24" />
        <path d="M11.4 12.4 14.5 20M20.6 12.4 17.5 20M12.3 10h7.4" stroke="#eef0f6" strokeWidth="1.5" strokeLinecap="round" opacity=".7" />
      </svg>
      <div>
        <div className="font-display text-[17px] font-bold tracking-tight text-fog-100">EconoCausal</div>
        <div className="whitespace-nowrap font-mono text-[9.5px] uppercase tracking-[0.12em] text-fog-500">Causal pricing engine</div>
      </div>
    </div>
  )
}

export function Sidebar() {
  const { page, setPage, status } = useApp()
  const st = status?.state
  return (
    <aside data-theme="night" className="relative z-10 hidden w-[248px] shrink-0 flex-col border-r border-white/[0.05] bg-ink-900/80 px-3 py-5 lg:flex">
      <Logo />
      <nav className="mt-8 flex-1 space-y-6 overflow-y-auto">
        {NAV.map((g) => (
          <div key={g.group}>
            <div className="mb-2 px-3 font-mono text-[10px] uppercase tracking-[0.16em] text-fog-500">{g.group}</div>
            <div className="space-y-0.5">
              {g.items.map((i) => (
                <button
                  key={i.page}
                  onClick={() => setPage(i.page)}
                  className={cx(
                    'group relative flex w-full items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium transition-all',
                    page === i.page ? 'bg-white/[0.06] text-fog-100' : 'text-fog-400 hover:bg-white/[0.03] hover:text-fog-200',
                  )}
                >
                  {page === i.page && <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-arm10" />}
                  <span className={cx(page === i.page ? 'text-arm10' : 'text-fog-500 group-hover:text-fog-300')}>{i.icon}</span>
                  {i.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="mt-4 rounded-xl border border-white/[0.06] bg-ink-850 p-3">
        <div className="flex items-center justify-between">
          <span className="text-[11.5px] font-medium text-fog-400">Engine</span>
          <span className="flex items-center gap-1.5 text-[11.5px] font-medium">
            <span
              className={cx(
                'h-2 w-2 rounded-full',
                st === 'ready' && 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]',
                st === 'running' && 'animate-pulse bg-amber-400',
                st === 'error' && 'bg-rose-400',
                (!st || st === 'idle') && 'bg-fog-500',
              )}
            />
            <span className="text-fog-200">{st === 'ready' ? 'Online' : st === 'running' ? 'Training' : st === 'error' ? 'Error' : 'Offline'}</span>
          </span>
        </div>
        {status?.run && (
          <div className="mt-2 space-y-1 font-mono text-[10.5px] text-fog-500">
            <div>{fmtInt(status.run.n)} customers · seed {status.run.seed}</div>
            <div className="truncate">model: {status.run.model}{status.run.estimator === 'auto' ? ' (auto)' : ''}</div>
          </div>
        )}
      </div>
    </aside>
  )
}

export function MobileNav() {
  const { page, setPage } = useApp()
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-white/[0.05] bg-ink-900 px-3 py-2 lg:hidden">
      {NAV.flatMap((g) => g.items).map((i) => (
        <button
          key={i.page}
          onClick={() => setPage(i.page)}
          className={cx('flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px]', page === i.page ? 'bg-white/[0.07] text-fog-100' : 'text-fog-400')}
        >
          {i.icon}
          {i.label}
        </button>
      ))}
    </div>
  )
}

export function Topbar() {
  const { page, status, openRunDrawer, setPalette, theme, setTheme } = useApp()
  const run = status?.run
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-4 border-b border-white/[0.05] bg-ink-950/75 px-6 backdrop-blur-xl">
      <div className="flex min-w-0 items-center gap-3 text-[13px]">
        <span className="text-fog-500">EconoCausal</span>
        <span className="text-fog-600">/</span>
        <span className="truncate font-medium text-fog-100">{PAGE_TITLES[page]}</span>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setTheme(theme === 'dawn' ? 'midnight' : 'dawn')}
          title={theme === 'dawn' ? 'Switch to Midnight' : 'Switch to Dawn'}
          className="relative flex h-8 w-14 items-center rounded-full border border-white/10 bg-white/[0.04] p-0.5 transition hover:border-white/20"
        >
          <span
            className={cx(
              'flex h-7 w-7 items-center justify-center rounded-full shadow transition-all duration-500',
              theme === 'dawn' ? 'translate-x-0 bg-amber-400 text-white' : 'translate-x-6 bg-indigo-500 text-white',
            )}
          >
            {theme === 'dawn' ? <Sun size={14} /> : <Moon size={14} />}
          </span>
        </button>
        <button
          onClick={() => setPalette(true)}
          className="hidden items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[12.5px] text-fog-400 transition hover:border-white/20 hover:text-fog-200 sm:flex"
        >
          <Search size={14} />
          Search
          <kbd className="ml-3 rounded border border-white/10 px-1 font-mono text-[10px]">⌘K</kbd>
        </button>
        {run && (
          <div className="hidden items-center gap-2 md:flex">
            <Badge tone={run.source === 'synthetic' ? 'teal' : 'violet'}>{run.source === 'synthetic' ? 'Synthetic SCM' : run.source}</Badge>
            {run.oracle && <Badge tone="warn">Oracle available</Badge>}
            {status?.refutation === 'running' && (
              <Badge tone="info">
                <Spinner className="h-3 w-3" /> Audit running
              </Badge>
            )}
          </div>
        )}
        <Button icon={<Play size={14} />} onClick={() => openRunDrawer(true)} disabled={status?.state === 'running'}>
          New run
        </Button>
      </div>
    </header>
  )
}

function useElapsed(since: number | null) {
  const [now, setNow] = useState(() => Date.now() / 1000)
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now() / 1000), 1000)
    return () => window.clearInterval(t)
  }, [])
  return since ? Math.max(0, now - since) : 0
}

export function PipelineProgress({ status, compact = false }: { status: Status; compact?: boolean }) {
  const elapsed = useElapsed(status.started_at)
  if (compact) {
    return (
      <div className="border-b border-amber-400/15 bg-amber-400/[0.05] px-6 py-2.5">
        <div className="flex items-center gap-3 text-[12.5px] text-amber-100">
          <Spinner className="text-amber-300" />
          <span className="font-medium">{status.message}</span>
          <span className="num text-amber-200/60">
            step {Math.min(status.stage_index + 1, status.stages.length)}/{status.stages.length} · {elapsed.toFixed(0)}s
          </span>
          <span className="text-amber-200/50">Showing the previous run until this one finishes.</span>
        </div>
      </div>
    )
  }
  return (
    <div className="mx-auto mt-16 max-w-xl">
      <div className="rounded-2xl border border-white/[0.06] bg-ink-850/80 p-8">
        <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.18em] text-arm10/80">Causal pipeline</div>
        <h2 className="font-display text-[22px] font-semibold text-fog-100">Building the causal engine…</h2>
        <p className="mt-1 text-[13px] text-fog-400">
          Simulating the campaign, de-confounding with Double ML and solving the budget allocation. This takes about a minute.
        </p>
        <ol className="mt-6 space-y-3">
          {status.stages.map((s, i) => {
            const done = i < status.stage_index || status.state === 'ready'
            const active = i === status.stage_index && status.state === 'running'
            return (
              <li key={s} className="flex items-center gap-3">
                <span
                  className={cx(
                    'flex h-6 w-6 items-center justify-center rounded-full font-mono text-[11px] ring-1',
                    done && 'bg-emerald-400/15 text-emerald-300 ring-emerald-400/30',
                    active && 'bg-amber-400/15 text-amber-300 ring-amber-400/40',
                    !done && !active && 'text-fog-500 ring-white/10',
                  )}
                >
                  {done ? '✓' : active ? <Spinner className="h-3 w-3" /> : i + 1}
                </span>
                <span className={cx('text-[13.5px]', done ? 'text-fog-300' : active ? 'font-medium text-fog-100' : 'text-fog-500')}>
                  {active ? status.message : s}
                </span>
              </li>
            )
          })}
        </ol>
        <div className="mt-6 h-1 overflow-hidden rounded-full bg-ink-700">
          <div
            className="h-full rounded-full bg-gradient-to-r from-teal-400 to-violet-400 transition-all duration-700"
            style={{ width: `${(Math.max(status.stage_index, 0.3) / status.stages.length) * 100}%` }}
          />
        </div>
        {status.state === 'error' && <div className="mt-4"><ErrorBox message={status.error ?? 'Pipeline failed'} /></div>}
        {status.state === 'idle' && (
          <p className="mt-4 text-[12.5px] text-fog-400">The engine is idle. Start a run with the “New run” button.</p>
        )}
      </div>
    </div>
  )
}

export function OfflineScreen() {
  return (
    <div className="mx-auto mt-24 max-w-lg">
      <Callout tone="bad" title="Cannot reach the EconoCausal API">
        Start the backend from the project root:
        <pre className="mt-2 rounded-lg bg-ink-950/80 p-3 font-mono text-[12px] text-fog-200">
          .venv/bin/uvicorn backend.main:app --port 8000
        </pre>
        This page reconnects automatically.
      </Callout>
    </div>
  )
}

const ESTIMATORS = [
  { value: 'auto', label: 'Auto (champion)' },
  { value: 'causal_forest', label: 'Causal Forest' },
  { value: 'linear_dml', label: 'Linear DML' },
  { value: 'dr_learner', label: 'DR-Learner' },
] as const
type EstimatorKey = (typeof ESTIMATORS)[number]['value']

export function RunDrawer() {
  const { runDrawer, openRunDrawer, setStatus } = useApp()
  const [mode, setMode] = useState<'synthetic' | 'upload'>('synthetic')
  const [n, setN] = useState(20000)
  const [seed, setSeed] = useState(42)
  const [confounding, setConfounding] = useState(1)
  const [estimator, setEstimator] = useState<EstimatorKey>('auto')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  if (!runDrawer) return null

  const launch = async () => {
    setBusy(true)
    setError(null)
    try {
      if (mode === 'synthetic') {
        await post('/api/pipeline/run', { n, seed, confounding, estimator })
      } else {
        if (!file) throw new Error('Choose a CSV file first')
        const fd = new FormData()
        fd.append('file', file)
        fd.append('estimator', estimator)
        await api('/api/data/upload', { method: 'POST', body: fd })
      }
      setStatus(await api<Status>('/api/status'))
      openRunDrawer(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => openRunDrawer(false)} />
      <div className="fade-up relative flex h-full w-full max-w-md flex-col border-l border-white/[0.06] bg-ink-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/[0.05] px-6 py-4">
          <div>
            <div className="font-display text-[17px] font-semibold text-fog-100">New pipeline run</div>
            <div className="text-[12px] text-fog-400">Re-estimate every causal quantity from scratch</div>
          </div>
          <button onClick={() => openRunDrawer(false)} className="rounded-lg p-1.5 text-fog-400 hover:bg-white/5 hover:text-fog-100">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          {DEMO && (
            <Callout tone="warn" title="Static demo">
              Retraining and CSV upload need the Python backend.{' '}
              <a href={REPO_URL} target="_blank" rel="noreferrer" className="font-semibold underline">
                Clone the repo
              </a>{' '}
              and run <code className="font-mono">uvicorn backend.main:app</code> to use them.
            </Callout>
          )}
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: 'synthetic', label: 'Synthetic campaign' },
              { value: 'upload', label: 'Upload CSV' },
            ]}
          />
          {mode === 'synthetic' ? (
            <div className="space-y-5">
              <Slider label="Customers" value={n} min={2000} max={60000} step={1000} onChange={setN} format={fmtInt} />
              <Slider
                label="Targeting bias (confounding)"
                value={confounding}
                min={0}
                max={2.5}
                step={0.1}
                onChange={setConfounding}
                format={(v) => (v === 0 ? 'RCT' : `${v.toFixed(1)}×`)}
                hint="0 simulates a randomised A/B test. Higher values make historical marketing target lapsing customers more aggressively, so naive analysis gets more wrong."
              />
              <label className="block">
                <div className="mb-1.5 text-[12.5px] font-medium text-fog-300">Random seed</div>
                <input
                  type="number"
                  value={seed}
                  onChange={(e) => setSeed(Number(e.target.value))}
                  className="num w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-[13px] text-fog-100 outline-none focus:border-teal-400/50"
                />
              </label>
            </div>
          ) : (
            <div className="space-y-3">
              <button
                onClick={() => fileRef.current?.click()}
                className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-white/15 bg-ink-950/60 px-4 py-8 text-center hover:border-teal-400/40"
              >
                <Upload size={22} className="text-fog-400" />
                <span className="text-[13px] font-medium text-fog-200">{file ? file.name : 'Choose a campaign CSV'}</span>
                <span className="text-[11.5px] text-fog-500">Columns: 14 customer features, discount ∈ {'{0,10,20}'}, purchased ∈ {'{0,1}'}</span>
              </button>
              <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <a href={fileHref('/api/data/template.csv')} className="inline-block text-[12.5px] font-medium text-arm10 hover:underline">
                Download a template CSV →
              </a>
            </div>
          )}
          <div>
            <div className="mb-2 text-[12.5px] font-medium text-fog-300">CATE estimator</div>
            <div className="grid grid-cols-2 gap-2">
              {ESTIMATORS.map((e) => (
                <button
                  key={e.value}
                  onClick={() => setEstimator(e.value)}
                  className={cx(
                    'rounded-xl px-3 py-2.5 text-left text-[12.5px] font-medium ring-1 ring-inset transition-all',
                    estimator === e.value ? 'bg-teal-400/10 text-teal-200 ring-teal-400/40' : 'text-fog-300 ring-white/10 hover:ring-white/20',
                  )}
                >
                  {e.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11.5px] text-fog-500">
              Auto trains all three and promotes the model with the best hold-out Qini score. It uses observed data only.
            </p>
          </div>
          {error && <ErrorBox message={error} />}
        </div>
        <div className="border-t border-white/[0.05] px-6 py-4">
          <Button className="w-full" onClick={launch} disabled={busy} icon={busy ? <Spinner /> : <Activity size={15} />}>
            Run causal pipeline
          </Button>
        </div>
      </div>
    </div>
  )
}
