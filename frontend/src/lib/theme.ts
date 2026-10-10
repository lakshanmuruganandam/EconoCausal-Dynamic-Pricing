import type { Segment } from '../api/types'

export type Theme = 'dawn' | 'midnight'

/**
 * Midnight is the "source" palette; Dawn maps every colour to a deeper,
 * ink-on-paper equivalent so charts and SVG diagrams stay legible on the
 * warm light canvas. `tc()` translates any hex or rgba literal.
 */
const DAWN: Record<string, string> = {
  '#2dd4bf': '#0d9488', // $10 arm · teal
  '#a78bfa': '#7c3aed', // $20 arm · violet
  '#fbbf24': '#d97706', // oracle · amber
  '#fb7185': '#e11d48', // legacy / confounder · rose
  '#f87171': '#dc2626', // bad
  '#34d399': '#059669', // good · persuadables
  '#60a5fa': '#2563eb', // blue
  '#818cf8': '#4f46e5', // indigo
  '#7c859d': '#857f73', // muted text / lines
  '#5a6379': '#a39d90', // faint
  '#3a4560': '#d3ccbf', // dim edges / "no offer"
  '#d5d9e5': '#2b3140', // body text
  '#eef0f6': '#141821', // strongest text / markers
  '#121725': '#fffdf9', // node fill
  '#0e121d': '#fbf8f2', // panel
  '#0a0d16': '#fbf8f2',
  '#1d2436': '#e8e1d5', // tracks
  '#115e59': '#8fd3c7', // heatmap mid
  '#99f6e4': '#0f766e',
  '#fecdd3': '#be123c',
  '#94a3b8': '#6e685c', // slate grey (from rgba(148,163,184,…))
  '#64748b': '#6b7280',
  '#96a3b8': '#6e685c',
}

let current: Theme = 'dawn'

const toHex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')

/** Theme-aware colour: returns the literal for Midnight, its mapped twin for Dawn. */
export function tc(color: string): string {
  if (current === 'midnight') return color
  if (color.startsWith('#')) return DAWN[color.toLowerCase()] ?? color
  const m = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/)
  if (!m) return color
  const hex = toHex(+m[1], +m[2], +m[3])
  const mapped = DAWN[hex]
  if (!mapped) return color
  const [r, g, b] = mapped.match(/\w\w/g)!.map((h) => parseInt(h, 16))
  const a = m[4] === undefined ? 1 : Math.min(1, +m[4] * 1.6) // light canvas needs a bit more ink
  return `rgba(${r},${g},${b},${a})`
}

const BASE = {
  arm10: '#2dd4bf',
  arm20: '#a78bfa',
  control: '#64748b',
  truth: '#fbbf24',
  legacy: '#fb7185',
  random: '#5a6379',
  good: '#34d399',
  warn: '#fbbf24',
  bad: '#f87171',
  text: '#d5d9e5',
  muted: '#7c859d',
  strong: '#eef0f6',
  grid: 'rgba(148, 163, 184, 0.09)',
  zero: 'rgba(148, 163, 184, 0.28)',
  panel: '#0e121d',
  surface: '#121725',
  track: '#1d2436',
  hover: '#121725',
  hoverBorder: '#283146',
}

/** One colour system for every chart: arms, baselines, oracle and segments. */
export const C = { ...BASE }

const SEGMENT_BASE: Record<Segment, string> = {
  Persuadables: '#34d399',
  'Sure Things': '#60a5fa',
  'Lost Causes': '#7c859d',
  'Sleeping Dogs': '#f87171',
}
export const SEGMENT_COLOR: Record<Segment, string> = { ...SEGMENT_BASE }

const ROLE_BASE = {
  treatment: '#2dd4bf',
  outcome: '#fbbf24',
  confounder: '#fb7185',
  modifier: '#60a5fa',
  latent: '#7c859d',
}
export const ROLE_COLOR = { ...ROLE_BASE }

/** Switch the active palette. Pages re-mount on theme change and pick up the new values. */
export function applyTheme(theme: Theme) {
  current = theme
  document.documentElement.dataset.theme = theme
  for (const k of Object.keys(BASE) as (keyof typeof BASE)[]) C[k] = tc(BASE[k])
  if (theme === 'dawn') {
    C.grid = 'rgba(60, 52, 40, 0.08)'
    C.zero = 'rgba(60, 52, 40, 0.3)'
    C.hover = '#fffdf9'
    C.hoverBorder = '#e2dacd'
  }
  for (const k of Object.keys(SEGMENT_BASE) as Segment[]) SEGMENT_COLOR[k] = tc(SEGMENT_BASE[k])
  for (const k of Object.keys(ROLE_BASE) as (keyof typeof ROLE_BASE)[]) ROLE_COLOR[k] = tc(ROLE_BASE[k])
}

export const armColor = (arm: number) => (arm === 20 ? C.arm20 : arm === 10 ? C.arm10 : C.control)

export const SEGMENT_BLURB: Record<Segment, string> = {
  Persuadables: 'Buy only because of the discount. The only profitable target.',
  'Sure Things': 'Buy anyway. A coupon is pure margin give-away.',
  'Lost Causes': 'Will not buy either way. Spend is wasted.',
  'Sleeping Dogs': 'A discount backfires – purchase odds drop.',
}
