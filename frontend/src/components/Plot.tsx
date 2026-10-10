import { useEffect, useRef } from 'react'
import Plotly from 'plotly.js-dist-min'
import type { Config, Data, DataTitle, Layout, LayoutAxis } from 'plotly.js'
import { C, tc } from '../lib/theme'

const axisStyle = () => ({
  gridcolor: C.grid,
  zerolinecolor: C.zero,
  linecolor: tc('rgba(148,163,184,0.18)'),
  tickfont: { color: C.muted, size: 11, family: 'JetBrains Mono, monospace' },
  title: { font: { color: C.muted, size: 11.5 } },
  automargin: true,
})

const baseLayout = (): Partial<Layout> => ({
  paper_bgcolor: 'rgba(0,0,0,0)',
  plot_bgcolor: 'rgba(0,0,0,0)',
  font: { family: 'Inter, sans-serif', color: C.text, size: 12 },
  margin: { l: 52, r: 16, t: 12, b: 44 },
  hoverlabel: {
    bgcolor: C.hover,
    bordercolor: C.hoverBorder,
    font: { family: 'Inter, sans-serif', color: C.strong, size: 12 },
  },
  legend: {
    orientation: 'h',
    x: 0,
    y: 1.12,
    font: { color: C.text, size: 11.5 },
    bgcolor: 'rgba(0,0,0,0)',
  },
  bargap: 0.18,
})

const CONFIG: Partial<Config> = {
  displaylogo: false,
  responsive: true,
  modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d', 'toggleSpikelines'],
}

/** Axis input that also accepts a plain string title. */
type AxisIn = Omit<Partial<LayoutAxis>, 'title'> & { title?: string | Partial<DataTitle> }
export type LayoutIn = Omit<Partial<Layout>, 'xaxis' | 'yaxis' | 'xaxis2' | 'yaxis2'> & {
  xaxis?: AxisIn
  yaxis?: AxisIn
  xaxis2?: AxisIn
  yaxis2?: AxisIn
}

function mergeAxis(ax: AxisIn | undefined): Partial<LayoutAxis> {
  const AXIS = axisStyle()
  return {
    ...AXIS,
    ...ax,
    title: typeof ax?.title === 'string' ? { ...AXIS.title, text: ax.title } : { ...AXIS.title, ...(ax?.title ?? {}) },
  }
}

interface Props {
  data: Data[]
  layout?: LayoutIn
  height?: number
  className?: string
}

/** Thin Plotly wrapper with the dashboard's dark theme baked in. */
export default function Plot({ data, layout, height = 320, className }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const { xaxis2, yaxis2, ...rest } = layout ?? {}
    const BASE_LAYOUT = baseLayout()
    const merged: Partial<Layout> = {
      ...BASE_LAYOUT,
      ...rest,
      height,
      xaxis: mergeAxis(layout?.xaxis),
      yaxis: mergeAxis(layout?.yaxis),
      margin: { ...BASE_LAYOUT.margin, ...layout?.margin },
      legend: { ...BASE_LAYOUT.legend, ...layout?.legend },
    }
    if (yaxis2) merged.yaxis2 = mergeAxis(yaxis2)
    if (xaxis2) merged.xaxis2 = mergeAxis(xaxis2)
    Plotly.react(el, data, merged, CONFIG)
  }, [data, layout, height])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      if (el.offsetParent !== null) Plotly.Plots.resize(el)
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      Plotly.purge(el)
    }
  }, [])

  return <div ref={ref} className={className} style={{ width: '100%', minHeight: height }} />
}
