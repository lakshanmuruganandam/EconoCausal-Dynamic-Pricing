import { useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { useApi, fileHref } from '../api/client'
import type { DataSummary } from '../api/types'
import Plot from '../components/Plot'
import { Button, Callout, Card, CardHeader, ErrorBox, PageHeader, Select, Skeleton, Stat } from '../components/ui'
import { fmtInt, fmtMoney, fmtNum, fmtPct } from '../lib/format'
import { C, armColor, tc } from '../lib/theme'
import { useApp } from '../store/useApp'

interface Sample {
  columns: string[]
  rows: Record<string, string | number>[]
}

export default function DataStudio() {
  const { data, error } = useApi<DataSummary>('/api/data/summary')
  const sample = useApi<Sample>('/api/data/sample?limit=12')
  const [feature, setFeature] = useState('recency_days')
  const openRunDrawer = useApp((s) => s.openRunDrawer)

  const f = data?.features.find((x) => x.feature === feature)

  const hist = useMemo(() => {
    if (!f) return []
    const centers = f.edges.slice(0, -1).map((e, i) => (e + f.edges[i + 1]) / 2)
    return [
      {
        type: 'bar' as const,
        x: f.binary ? ['No', 'Yes'] : centers,
        y: f.hist,
        marker: { color: tc('rgba(96,165,250,0.55)'), line: { color: tc('#60a5fa'), width: 1 } },
        hovertemplate: '%{x}: %{y} customers<extra></extra>',
      },
    ]
  }, [f])

  const byArm = useMemo(() => {
    if (!f) return []
    const arms = ['0', '10', '20']
    return [
      {
        type: 'bar' as const,
        x: arms.map((a) => (a === '0' ? 'No discount' : `$${a}`)),
        y: arms.map((a) => f.mean_by_arm[a]),
        marker: { color: arms.map((a) => armColor(Number(a))) },
        text: arms.map((a) => fmtNum(f.mean_by_arm[a], f.binary ? 2 : 1)),
        textposition: 'outside' as const,
        textfont: { color: C.text, family: 'JetBrains Mono' },
        hovertemplate: '%{x}: mean %{y:.2f}<extra></extra>',
      },
    ]
  }, [f])

  if (error) return <ErrorBox message={error} />
  if (!data) return <Skeleton h={600} />

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Week 1 · Data engineering"
        title="Historical campaign data"
        description="A log of past promotions: who got which discount and who bought. The discounts were not handed out at random, and that targeting bias is what the causal engine has to remove."
        right={
          <div className="flex gap-2">
            <a href={fileHref('/api/data/template.csv')}>
              <Button variant="outline" icon={<Download size={14} />}>
                CSV template
              </Button>
            </a>
            <Button onClick={() => openRunDrawer(true)}>Generate / upload</Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Stat label="Customers" value={fmtInt(data.rows)} sub={`${fmtInt(data.train_rows)} train · ${fmtInt(data.test_rows)} hold-out`} />
        <Stat label="Conversion rate" value={fmtPct(data.conversion_rate)} sub="purchase within 14 days" />
        <Stat label="Avg order value" value={fmtMoney(data.avg_order_value, 2)} sub="drives incremental profit" />
        <Stat label="Data source" value={data.source === 'synthetic' ? 'SCM' : 'CSV'} sub={data.oracle ? 'counterfactual truth known' : 'real data: no oracle'} />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {data.arms.map((a) => (
          <Card key={a.arm} className="relative overflow-hidden">
            <div className="absolute inset-y-0 left-0 w-1" style={{ background: armColor(a.arm) }} />
            <div className="flex items-baseline justify-between">
              <span className="font-display text-[15px] font-semibold text-fog-100">{a.arm === 0 ? 'Control (no discount)' : `$${a.arm} discount`}</span>
              <span className="num text-[12px] text-fog-400">{fmtPct(a.share, 0)} of customers</span>
            </div>
            <div className="mt-3 flex items-end gap-6">
              <div>
                <div className="num text-[24px] font-semibold text-fog-100">{fmtInt(a.count)}</div>
                <div className="text-[11.5px] text-fog-500">customers</div>
              </div>
              <div>
                <div className="num text-[24px] font-semibold" style={{ color: armColor(a.arm) }}>
                  {fmtPct(a.conversion)}
                </div>
                <div className="text-[11.5px] text-fog-500">raw conversion</div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Callout tone="warn" title="Raw conversion rates are misleading">
        The $20 group can convert <em>less</em> than the control group even though the discount helps. Marketing gave the biggest coupons to lapsing
        customers who were unlikely to buy in the first place. Pick a feature below to see the imbalance.
      </Callout>

      <Card>
        <CardHeader
          title="Feature explorer"
          subtitle="Distribution of a covariate, and its average within each historical discount group"
          right={
            <Select
              value={feature}
              onChange={setFeature}
              options={data.features.map((x) => ({ value: x.feature, label: x.label }))}
            />
          }
        />
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <div className="mb-2 text-[12px] font-medium text-fog-400">Distribution · {f?.label}</div>
            <Plot data={hist} height={260} layout={{ xaxis: { title: f?.label, type: f?.binary ? 'category' : 'linear' }, yaxis: { title: 'Customers' }, showlegend: false }} />
          </div>
          <div>
            <div className="mb-2 text-[12px] font-medium text-fog-400">Mean by discount group (targeting bias)</div>
            <Plot data={byArm} height={260} layout={{ xaxis: { type: 'category' }, yaxis: { title: `Mean ${f?.label ?? ''}` }, showlegend: false }} />
          </div>
        </div>
        {f && (
          <div className="num mt-4 grid grid-cols-4 gap-3 border-t border-white/[0.05] pt-4 text-[12px] text-fog-300">
            <span>mean {fmtNum(f.mean, 2)}</span>
            <span>std {fmtNum(f.std, 2)}</span>
            <span>min {fmtNum(f.min, 2)}</span>
            <span>max {fmtNum(f.max, 2)}</span>
          </div>
        )}
      </Card>

      <Card pad={false}>
        <div className="p-5 pb-3">
          <CardHeader title="Sample records" subtitle="First rows of the campaign log as the model sees it. Oracle columns are hidden." />
        </div>
        <div className="overflow-x-auto">
          {sample.data && (
            <table className="w-full text-left text-[12px]">
              <thead>
                <tr className="border-y border-white/[0.05] bg-ink-900/60 text-fog-400">
                  {sample.data.columns.map((c) => (
                    <th key={c} className="whitespace-nowrap px-3 py-2 font-medium">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sample.data.rows.map((r, i) => (
                  <tr key={i} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                    {sample.data!.columns.map((c) => (
                      <td key={c} className="num whitespace-nowrap px-3 py-1.5 text-fog-200">
                        {String(r[c])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </div>
  )
}
