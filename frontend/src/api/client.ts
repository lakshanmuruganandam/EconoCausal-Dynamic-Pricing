import { useCallback, useEffect, useState } from 'react'
import { useApp } from '../store/useApp'
import { demoApi, downloadAllocationCsv } from '../demo/engine'

/** Static GitHub Pages build: every request is served by the in-browser demo engine. */
export const DEMO = import.meta.env.VITE_DEMO === '1'
export const REPO_URL = 'https://github.com/lakshanmuruganandam/EconoCausal-Dynamic-Pricing'

/** URL for a downloadable file (template CSV etc.) in either mode. */
export const fileHref = (path: string) => (DEMO ? `${import.meta.env.BASE_URL}demo/${path.split('/').pop()}` : path)

export function exportAllocationCsv() {
  if (DEMO) downloadAllocationCsv()
  else window.open('/api/optimize/allocation.csv')
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function detailMessage(detail: unknown): string {
  if (typeof detail === 'string') return detail
  if (detail && typeof detail === 'object' && 'problems' in detail) {
    return (detail as { problems: string[] }).problems.join('; ')
  }
  return JSON.stringify(detail)
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  if (DEMO) return demoApi<T>(path, init)
  const res = await fetch(path, {
    ...init,
    headers: init?.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json', ...init?.headers } : init?.headers,
  })
  if (!res.ok) {
    let msg = res.statusText
    try {
      const body = await res.json()
      msg = detailMessage(body.detail ?? body)
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, msg)
  }
  return res.json() as Promise<T>
}

export const post = <T,>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

/**
 * Fetch `path` and re-fetch automatically whenever a new pipeline run lands
 * (runKey changes) or `refetch` is called. Pass null to skip.
 */
export function useApi<T>(path: string | null) {
  const runKey = useApp((s) => s.runKey)
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean; key: string | null }>({
    data: null,
    error: null,
    loading: path !== null,
    key: null,
  })
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!path || !runKey) return
    let alive = true
    const key = `${path}|${runKey}|${tick}`
    api<T>(path)
      .then((data) => alive && setState({ data, error: null, loading: false, key }))
      .catch((e: Error) => alive && setState((s) => ({ ...s, error: e.message, loading: false, key })))
    return () => {
      alive = false
    }
  }, [path, runKey, tick])

  const refetch = useCallback(() => setTick((t) => t + 1), [])
  const loading = state.key !== `${path}|${runKey}|${tick}`
  return { data: state.data, error: state.error, loading, refetch, setData: (data: T) => setState((s) => ({ ...s, data })) }
}
