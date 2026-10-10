import { useEffect, useRef, useState } from 'react'
import { DEMO, REPO_URL, api } from './api/client'
import type { Status } from './api/types'
import { MobileNav, OfflineScreen, PipelineProgress, RunDrawer, Sidebar, Topbar } from './components/Shell'
import { CommandPalette, Toasts } from './components/Overlays'
import { useToasts } from './store/useToasts'
import Lab from './pages/Lab'
import { useApp } from './store/useApp'
import Overview from './pages/Overview'
import DataStudio from './pages/DataStudio'
import CausalGraph from './pages/CausalGraph'
import Balance from './pages/Balance'
import Effects from './pages/Effects'
import UpliftPage from './pages/Uplift'
import Audit from './pages/Audit'
import Optimizer from './pages/Optimizer'
import DriftPage from './pages/Drift'

const PAGES = {
  overview: Overview,
  lab: Lab,
  data: DataStudio,
  graph: CausalGraph,
  balance: Balance,
  effects: Effects,
  uplift: UpliftPage,
  audit: Audit,
  optimizer: Optimizer,
  drift: DriftPage,
}

function useStatusPolling() {
  const setStatus = useApp((s) => s.setStatus)
  const [offline, setOffline] = useState(false)
  useEffect(() => {
    let alive = true
    let timer: number
    const poll = async () => {
      let delay = 4000
      try {
        const s = await api<Status>('/api/status')
        if (!alive) return
        setStatus(s)
        setOffline(false)
        if (s.state === 'running' || s.refutation === 'running' || s.comparison === 'running') delay = 1200
      } catch {
        if (alive) setOffline(true)
        delay = 2500
      }
      if (alive) timer = window.setTimeout(poll, delay)
    }
    poll()
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [setStatus])
  return offline
}

/** Toast on meaningful background transitions (pipeline done, audit done, failures). */
function useStatusToasts(status: Status | null) {
  const push = useToasts((s) => s.push)
  const prev = useRef<Status | null>(null)
  useEffect(() => {
    const p = prev.current
    prev.current = status
    if (!p || !status) return
    if (p.state === 'running' && status.state === 'ready')
      push({ tone: 'good', title: 'Pipeline complete', body: `Champion model: ${status.run?.model ?? '—'}. All pages refreshed.` })
    if (p.state === 'running' && status.state === 'error') push({ tone: 'bad', title: 'Pipeline failed', body: status.error ?? undefined })
    if (p.refutation === 'running' && status.refutation === 'ready')
      push({ tone: 'good', title: 'Causal audit finished', body: 'Refutation battery results are ready.' })
    if (p.comparison === 'running' && status.comparison === 'ready')
      push({ tone: 'info', title: 'Challenger models trained', body: 'Champion/challenger table updated.' })
  }, [status, push])
}

export default function App() {
  const offline = useStatusPolling()
  const { page, status, runKey, theme } = useApp()
  const Page = PAGES[page]
  useStatusToasts(status)

  useEffect(() => {
    document.querySelector('main')?.scrollTo({ top: 0 })
  }, [page])

  let body
  if (offline && !status) body = <OfflineScreen />
  else if (!status) body = null
  else if (!runKey) body = <PipelineProgress status={status} />
  else body = <Page key={`${page}-${theme}`} />

  return (
    <div className="relative flex h-full">
      <div className="aurora" aria-hidden>
        <span />
        <span />
        <span />
      </div>
      <Sidebar />
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <Topbar />
        <MobileNav />
        {DEMO && (
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-white/[0.06] bg-gradient-to-r from-teal-400/[0.08] via-violet-400/[0.08] to-amber-400/[0.08] px-6 py-2 text-[12.5px] text-fog-300">
            <span className="rounded-full bg-teal-400/15 px-2 py-0.5 font-mono text-[10.5px] font-semibold uppercase tracking-wider text-teal-300">Live demo</span>
            <span>Static snapshot of a 20,000-customer run. The budget optimiser and What-If Lab compute live in your browser.</span>
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="font-semibold text-arm10 hover:underline">
              Run the full engine locally ↗
            </a>
          </div>
        )}
        {status?.state === 'running' && runKey && <PipelineProgress status={status} compact />}
        {status?.state === 'error' && runKey && (
          <div className="border-b border-rose-400/15 bg-rose-400/[0.06] px-6 py-2 text-[12.5px] text-rose-200">
            Last run failed: {status.error}. Showing the previous successful run.
          </div>
        )}
        <main className="canvas-bg relative flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1440px] px-6 py-8">{body}</div>
        </main>
      </div>
      <RunDrawer />
      <CommandPalette />
      <Toasts />
    </div>
  )
}
