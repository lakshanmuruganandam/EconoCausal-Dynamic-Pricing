import { useMemo } from 'react'
import { ArrowRight, BarChart3, Database, FlaskConical, GitFork, Scale, Sparkles, Wallet } from 'lucide-react'
import { useApi } from '../api/client'
import type { Compare, Identification, PropensityArm, Report } from '../api/types'
import Counter from '../components/Counter'
import PipelineFlow from '../components/PipelineFlow'
import Plot from '../components/Plot'
import { Badge, Card, CardHeader, Dot, ErrorBox, PageHeader, Skeleton, Stat } from '../components/ui'
import { fmtInt, fmtMoney, fmtMoneyCompact, fmtNum, fmtPct, fmtPts } from '../lib/format'
import { C, SEGMENT_BLURB, SEGMENT_COLOR, tc } from '../lib/theme'
import { useApp } from '../store/useApp'

export default function Overview() {
  const { data, error } = useApi<Report>('/api/report')
  const prop = useApi<{ arms: PropensityArm[] }>('/api/causal/propensity')
  const cmp = useApi<Compare>('/api/model/compare')
  const ident = useApi<Identification>('/api/causal/identification')
  const { setPage, status } = useApp()

  const estimatorChart = useMemo(() => {
    if (!data) return null
    const methods = [
      { key: 'naive', label: 'Naive diff-in-means', color: C.legacy },
      { key: 'ipw', label: 'IPW', color: tc('#60a5fa') },
      { key: 'psm', label: 'PSM (ATT)', color: tc('#818cf8') },
      { key: 'dml', label: 'Double ML', color: C.arm10 },
      ...(data.metric_basis === 'oracle' ? [{ key: 'truth', label: 'Ground truth', color: C.truth }] : []),
    ]
    const val = (e: Report['effects'][number], k: string) =>
      k === 'naive' ? e.naive : k === 'ipw' ? e.ipw : k === 'psm' ? e.psm_att : k === 'dml' ? e.dml.value : (e.truth ?? 0)
    return methods.map((m) => ({
      type: 'bar' as const,
      name: m.label,
      x: data.effects.map((e) => `$${e.arm} discount`),
      y: data.effects.map((e) => val(e, m.key) * 100),
      marker: { color: m.color, line: { width: 0 } },
      error_y:
        m.key === 'dml'
          ? {
              type: 'data' as const,
              symmetric: false,
              array: data.effects.map((e) => (e.dml.upper - e.dml.value) * 100),
              arrayminus: data.effects.map((e) => (e.dml.value - e.dml.lower) * 100),
              color: tc('#99f6e4'),
              thickness: 1.2,
              width: 4,
            }
          : undefined,
      hovertemplate: `${m.label}: %{y:.1f} pts<extra></extra>`,
    }))
  }, [data])

  if (error) return <ErrorBox message={error} />
  if (!data) return <OverviewSkeleton />

  const k = data.kpis
  const basis = data.metric_basis === 'oracle' ? 'ground-truth' : 'model-predicted'
  const champion = cmp.data?.result?.selection?.champion
  const maxSmd = prop.data ? Math.max(...prop.data.arms.map((a) => a.max_abs_smd_weighted)) : null

  const checks = [
    {
      label: 'Covariate balance after IPW',
      value: maxSmd === null ? '…' : `max |SMD| ${fmtNum(maxSmd, 3)}`,
      ok: maxSmd !== null && maxSmd < 0.1,
      page: 'balance' as const,
    },
    {
      label: 'Refutation battery',
      value: k.refutation ?? (status?.refutation === 'running' ? 'running…' : 'pending'),
      ok: k.refutation === 'PASS',
      page: 'audit' as const,
    },
    {
      label: 'Uplift ranking quality (Qini)',
      value: k.normalized_qini_10 !== null ? `${fmtPct(k.normalized_qini_10, 0)} of perfect` : fmtNum(k.qini_10, 4),
      ok: (k.normalized_qini_10 ?? k.qini_10) > 0,
      page: 'uplift' as const,
    },
    {
      label: 'Population drift',
      value: k.drift ?? 'not checked',
      ok: k.drift === 'ok' || k.drift === null,
      page: 'drift' as const,
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Executive overview"
        title="Who should get a discount, and how much?"
        description={
          <>
            EconoCausal estimates how much a $10 or $20 discount <em>changes</em> each customer’s chance of buying, not just who is likely to buy.
            It then spends the budget only on customers the discount actually persuades.
          </>
        }
        right={
          champion && (
            <Badge tone="teal" className="text-[12px]">
              <Sparkles size={12} /> Champion model: {cmp.data?.result?.models.find((m) => m.name === champion)?.label}
            </Badge>
          )
        }
      />

      <Card className="glow-border overflow-hidden !p-0">
        <div className="flex items-center justify-between px-5 pt-4">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-fog-400">Live causal pipeline · click a stage</div>
          <div className="flex items-center gap-2 text-[11.5px] text-emerald-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> streaming
          </div>
        </div>
        <div className="px-2 pb-2">
          <PipelineFlow
            stages={[
              { key: 'data', title: 'Campaign data', metric: <Counter value={k.customers} format={fmtInt} />, caption: 'customers logged', icon: <Database size={26} />, color: tc('#60a5fa'), page: 'data' },
              { key: 'balance', title: 'De-bias', metric: maxSmd === null ? '…' : <Counter value={maxSmd} format={(v) => `SMD ${v.toFixed(3)}`} />, caption: 'balance after IPW', icon: <Scale size={26} />, color: tc('#818cf8'), page: 'balance' },
              { key: 'identify', title: 'Identify', metric: `${ident.data?.backdoor_variables.length ?? '…'} confounders`, caption: 'back-door set (DoWhy)', icon: <GitFork size={26} />, color: tc('#fb7185'), page: 'graph' },
              { key: 'dml', title: 'Double ML', metric: <Counter value={k.ate_10.value * 100} format={(v) => `+${v.toFixed(1)} pts`} />, caption: 'causal lift of $10', icon: <FlaskConical size={26} />, color: tc('#2dd4bf'), page: 'effects' },
              { key: 'uplift', title: 'Rank uplift', metric: k.normalized_qini_10 !== null ? <Counter value={k.normalized_qini_10 * 100} format={(v) => `${v.toFixed(0)}% Qini`} /> : fmtNum(k.qini_10, 3), caption: 'of perfect ranking', icon: <BarChart3 size={26} />, color: tc('#a78bfa'), page: 'uplift' },
              { key: 'decide', title: 'Decide', metric: <Counter value={k.optimised_profit} format={fmtMoneyCompact} />, caption: 'profit via MILP', icon: <Wallet size={26} />, color: tc('#34d399'), page: 'optimizer' },
            ]}
          />
        </div>
      </Card>

      <div className="stagger grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Stat
          label="Optimised incremental profit"
          value={<Counter value={k.optimised_profit} format={fmtMoneyCompact} />}
          sub={<>on a {fmtMoney(k.budget)} budget · {basis}</>}
          tone={k.optimised_profit > 0 ? 'good' : 'bad'}
          accent={C.good}
        />
        <Stat
          label="vs. blanket $10"
          value={<Counter value={k.uplift_vs_blanket} format={(v) => `${v >= 0 ? '+' : ''}${fmtMoneyCompact(v)}`} />}
          sub={<>vs. traditional ML: {k.uplift_vs_response >= 0 ? '+' : ''}{fmtMoneyCompact(k.uplift_vs_response)}</>}
          tone="good"
          accent={C.legacy}
        />
        <Stat
          label="Causal effect of $10"
          value={<Counter value={k.ate_10.value} format={fmtPts} />}
          sub={<>95% CI {fmtPts(k.ate_10.lower)} to {fmtPts(k.ate_10.upper)}</>}
          accent={C.arm10}
        />
        <Stat
          label="Causal effect of $20"
          value={<Counter value={k.ate_20.value} format={fmtPts} />}
          sub={<>95% CI {fmtPts(k.ate_20.lower)} to {fmtPts(k.ate_20.upper)}</>}
          accent={C.arm20}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader
            title="The confounding trap"
            subtitle="Average lift in purchase probability from each discount. Marketing historically sent bigger coupons to lapsing customers, so the naive comparison badly understates what discounts do."
          />
          {estimatorChart && (
            <Plot
              data={estimatorChart}
              height={300}
              layout={{ barmode: 'group', yaxis: { title: 'Lift in purchase probability (pts)', ticksuffix: '' }, legend: { y: 1.18 } }}
            />
          )}
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader title="What the engine recommends" subtitle="Generated from the optimiser output" icon={<Sparkles size={15} />} />
          <ul className="space-y-3">
            {data.narrative.map((line, i) => (
              <li key={i} className="flex gap-3 text-[13.5px] leading-relaxed text-fog-200">
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-arm10" />
                {line}
              </li>
            ))}
          </ul>
          <button onClick={() => setPage('optimizer')} className="mt-5 flex items-center gap-1.5 text-[12.5px] font-semibold text-arm10 hover:underline">
            Open the budget optimizer <ArrowRight size={14} />
          </button>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader title="Customer response segments" subtitle="Each customer is classified by predicted uplift from a $10 offer and baseline purchase probability" />
          <div className="grid gap-3 sm:grid-cols-2">
            {data.segments.map((s) => (
              <div key={s.segment} className="card-hover rounded-xl border border-white/[0.05] bg-ink-900/60 p-4">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-[13px] font-semibold text-fog-100">
                    <Dot color={SEGMENT_COLOR[s.segment]} size={9} />
                    {s.segment}
                  </span>
                  <span className="num text-[18px] font-semibold text-fog-100">{fmtPct(s.share, 0)}</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-700">
                  <div className="bar-grow h-full rounded-full" style={{ width: `${s.share * 100}%`, background: SEGMENT_COLOR[s.segment] }} />
                </div>
                <p className="mt-2 text-[12px] leading-snug text-fog-400">{SEGMENT_BLURB[s.segment]}</p>
                <div className="num mt-2 flex gap-4 text-[11.5px] text-fog-300">
                  <span>{fmtInt(s.count)} customers</span>
                  <span>uplift {fmtPts(s.avg_uplift)}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader title="Model health" subtitle="Checks that must pass before trusting the allocation" />
          <div className="space-y-2">
            {checks.map((c) => (
              <button
                key={c.label}
                onClick={() => setPage(c.page)}
                className="flex w-full items-center justify-between rounded-xl border border-white/[0.05] bg-ink-900/60 px-4 py-3 text-left transition hover:border-white/15"
              >
                <span className="flex items-center gap-3">
                  <span className={`h-2 w-2 rounded-full ${c.ok ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                  <span className="text-[13px] text-fog-200">{c.label}</span>
                </span>
                <span className="num text-[12.5px] text-fog-300">{c.value}</span>
              </button>
            ))}
          </div>
          <div className="mt-5 grid grid-cols-3 gap-3 border-t border-white/[0.05] pt-4 text-center">
            <div>
              <div className="num text-[17px] font-semibold text-fog-100">{fmtInt(k.customers)}</div>
              <div className="text-[11px] text-fog-500">customers</div>
            </div>
            <div>
              <div className="num text-[17px] font-semibold text-fog-100">{fmtPct(k.conversion_rate)}</div>
              <div className="text-[11px] text-fog-500">conversion</div>
            </div>
            <div>
              <div className="num text-[17px] font-semibold text-fog-100">{fmtPct(k.persuadable_share, 0)}</div>
              <div className="text-[11px] text-fog-500">persuadable</div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}

function OverviewSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton h={80} />
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} h={110} />
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-5">
        <Skeleton h={360} className="xl:col-span-3" />
        <Skeleton h={360} className="xl:col-span-2" />
      </div>
    </div>
  )
}
