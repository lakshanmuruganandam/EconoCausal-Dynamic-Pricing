import { create } from 'zustand'
import type { Status } from '../api/types'
import { applyTheme, type Theme } from '../lib/theme'

function initialTheme(): Theme {
  try {
    const t = localStorage.getItem('econocausal-theme')
    if (t === 'dawn' || t === 'midnight') return t
  } catch {
    /* storage unavailable */
  }
  return 'dawn'
}

const startTheme = initialTheme()
applyTheme(startTheme)

export type Page =
  | 'overview'
  | 'lab'
  | 'data'
  | 'graph'
  | 'balance'
  | 'effects'
  | 'uplift'
  | 'audit'
  | 'optimizer'
  | 'drift'

const PAGES: Page[] = ['overview', 'lab', 'data', 'graph', 'balance', 'effects', 'uplift', 'audit', 'optimizer', 'drift']

function pageFromHash(): Page {
  const h = window.location.hash.replace('#/', '').replace('#', '') as Page
  return PAGES.includes(h) ? h : 'overview'
}

interface AppState {
  page: Page
  status: Status | null
  runKey: string | null
  runDrawer: boolean
  palette: boolean
  labPersona: string | null
  theme: Theme
  setTheme: (t: Theme) => void
  setPalette: (open: boolean) => void
  setPage: (p: Page) => void
  setStatus: (s: Status) => void
  openRunDrawer: (open: boolean) => void
}

export const useApp = create<AppState>((set) => ({
  page: pageFromHash(),
  status: null,
  runKey: null,
  runDrawer: false,
  palette: false,
  labPersona: null,
  theme: startTheme,
  setTheme: (theme) => {
    applyTheme(theme)
    try {
      localStorage.setItem('econocausal-theme', theme)
    } catch {
      /* storage unavailable */
    }
    set({ theme })
  },
  setPalette: (palette) => set({ palette }),
  setPage: (page) => {
    window.location.hash = `/${page}`
    set({ page })
  },
  setStatus: (status) =>
    set((s) => {
      const key = status.run ? String(status.run.created_at) : null
      return { status, runKey: key ?? s.runKey }
    }),
  openRunDrawer: (runDrawer) => set({ runDrawer }),
}))

window.addEventListener('hashchange', () => useApp.setState({ page: pageFromHash() }))
