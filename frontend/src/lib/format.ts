export const fmtInt = (x: number) => Math.round(x).toLocaleString('en-US')

export const fmtMoney = (x: number, digits = 0) => {
  const sign = x < 0 ? '−' : ''
  return `${sign}$${Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
}

export const fmtMoneyCompact = (x: number) => {
  const a = Math.abs(x)
  const sign = x < 0 ? '−' : ''
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`
  if (a >= 1e4) return `${sign}$${(a / 1e3).toFixed(1)}k`
  return `${sign}$${Math.round(a).toLocaleString('en-US')}`
}

export const fmtPct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`

/** Probability difference in percentage points, signed. */
export const fmtPts = (x: number, digits = 1) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(digits)} pts`

export const fmtNum = (x: number | null | undefined, digits = 3) =>
  x === null || x === undefined || Number.isNaN(x) ? '—' : x.toFixed(digits)

export const fmtP = (p: number | null | undefined) => {
  if (p === null || p === undefined) return '—'
  if (p < 0.001) return '<0.001'
  return p.toFixed(3)
}
