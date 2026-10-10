import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from 'lucide-react'
import { cx } from '../lib/cx'
import { tc } from '../lib/theme'

export function Card({ children, className, pad = true }: { children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <div
      className={cx(
        'card-surface fade-up rounded-2xl border border-white/[0.06] bg-ink-850/80 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_20px_40px_-24px_rgba(0,0,0,0.6)] backdrop-blur',
        pad && 'p-5',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function CardHeader({ title, subtitle, right, icon }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h3 className="flex items-center gap-2 font-display text-[15px] font-semibold tracking-tight text-fog-100">
          {icon && <span className="text-fog-400">{icon}</span>}
          {title}
        </h3>
        {subtitle && <p className="mt-1 text-[12.5px] leading-relaxed text-fog-400">{subtitle}</p>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  )
}

export function PageHeader({ eyebrow, title, description, right }: { eyebrow: string; title: string; description: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-3xl">
        <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.18em] text-arm10/80">{eyebrow}</div>
        <h1 className="page-title text-[30px] font-semibold leading-tight tracking-tight text-fog-100">{title}</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-fog-300">{description}</p>
      </div>
      {right}
    </div>
  )
}

export function Stat({
  label,
  value,
  sub,
  tone = 'default',
  accent,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: 'default' | 'good' | 'bad' | 'warn'
  accent?: string
}) {
  const toneCls = { default: 'text-fog-100', good: 'text-emerald-300', bad: 'text-rose-300', warn: 'text-amber-300' }[tone]
  return (
    <Card className="relative overflow-hidden">
      {accent && <div className="absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, ${accent}, transparent)` }} />}
      <div className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-fog-400">{label}</div>
      <div className={cx('num mt-2 text-[26px] font-semibold leading-none tracking-tight', toneCls)}>{value}</div>
      {sub && <div className="mt-2 text-[12px] text-fog-400">{sub}</div>}
    </Card>
  )
}

const BADGE = {
  neutral: 'bg-white/[0.05] text-fog-300 ring-white/10',
  good: 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/25',
  bad: 'bg-rose-400/10 text-rose-300 ring-rose-400/25',
  warn: 'bg-amber-400/10 text-amber-300 ring-amber-400/25',
  info: 'bg-sky-400/10 text-sky-300 ring-sky-400/25',
  teal: 'bg-teal-400/10 text-teal-300 ring-teal-400/25',
  violet: 'bg-violet-400/10 text-violet-300 ring-violet-400/25',
}

export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: keyof typeof BADGE; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset', BADGE[tone], className)}>
      {children}
    </span>
  )
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  size = 'md',
}: {
  options: { value: T; label: ReactNode }[]
  value: T
  onChange: (v: T) => void
  size?: 'sm' | 'md'
}) {
  return (
    <div className="inline-flex rounded-xl bg-ink-950/70 p-1 ring-1 ring-white/[0.06]">
      {options.map((o) => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-lg font-medium transition-all',
            size === 'sm' ? 'px-2.5 py-1 text-[11.5px]' : 'px-3.5 py-1.5 text-[12.5px]',
            value === o.value ? 'bg-ink-700 text-fog-100 shadow-sm ring-1 ring-white/10' : 'text-fog-400 hover:text-fog-200',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function ArmToggle({ value, onChange }: { value: 10 | 20; onChange: (v: 10 | 20) => void }) {
  return (
    <Segmented
      size="sm"
      value={value}
      onChange={onChange}
      options={[
        { value: 10, label: <span className="flex items-center gap-1.5"><Dot color={tc('#2dd4bf')} />$10 offer</span> },
        { value: 20, label: <span className="flex items-center gap-1.5"><Dot color={tc('#a78bfa')} />$20 offer</span> },
      ]}
    />
  )
}

export function Dot({ color, size = 8 }: { color: string; size?: number }) {
  return <span className="inline-block shrink-0 rounded-full" style={{ background: color, width: size, height: size }} />
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled,
  icon,
  className,
  type = 'button',
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'ghost' | 'outline'
  disabled?: boolean
  icon?: ReactNode
  className?: string
  type?: 'button' | 'submit'
}) {
  const v = {
    primary: 'btn-primary bg-gradient-to-b from-teal-300 to-teal-400 text-ink-950 shadow-[0_8px_24px_-8px_rgba(45,212,191,0.6)] hover:from-teal-200 hover:to-teal-300',
    ghost: 'text-fog-300 hover:bg-white/[0.05] hover:text-fog-100',
    outline: 'text-fog-200 ring-1 ring-inset ring-white/10 hover:bg-white/[0.04] hover:ring-white/20',
  }[variant]
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-[13px] font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50',
        v,
        className,
      )}
    >
      {icon}
      {children}
    </button>
  )
}

export function Skeleton({ h = 280, className }: { h?: number; className?: string }) {
  return <div className={cx('skeleton rounded-xl', className)} style={{ height: h }} />
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('animate-spin', className)} size={16} />
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-rose-400/20 bg-rose-400/[0.06] p-3 text-[13px] text-rose-200">
      <XCircle size={16} className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  )
}

export function Callout({ children, tone = 'info', title }: { children: ReactNode; tone?: 'info' | 'good' | 'warn' | 'bad'; title?: ReactNode }) {
  const map = {
    info: { cls: 'border-sky-400/20 bg-sky-400/[0.05] text-sky-100', icon: <Info size={16} className="text-sky-300" /> },
    good: { cls: 'border-emerald-400/20 bg-emerald-400/[0.05] text-emerald-50', icon: <CheckCircle2 size={16} className="text-emerald-300" /> },
    warn: { cls: 'border-amber-400/25 bg-amber-400/[0.06] text-amber-50', icon: <AlertTriangle size={16} className="text-amber-300" /> },
    bad: { cls: 'border-rose-400/25 bg-rose-400/[0.06] text-rose-50', icon: <XCircle size={16} className="text-rose-300" /> },
  }[tone]
  return (
    <div className={cx('flex gap-3 rounded-xl border p-4 text-[13px] leading-relaxed', map.cls)}>
      <div className="mt-0.5 shrink-0">{map.icon}</div>
      <div className="min-w-0">
        {title && <div className="mb-1 font-semibold">{title}</div>}
        {children}
      </div>
    </div>
  )
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  onCommit,
  format,
  hint,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  onCommit?: () => void
  format: (v: number) => string
  hint?: string
}) {
  const fill = ((value - min) / (max - min)) * 100
  return (
    <label className="block">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[12.5px] font-medium text-fog-300">{label}</span>
        <span className="num text-[13px] font-semibold text-fog-100">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--fill': `${fill}%` } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
        onMouseUp={onCommit}
        onTouchEnd={onCommit}
        onKeyUp={onCommit}
      />
      {hint && <div className="mt-1 text-[11.5px] leading-snug text-fog-500">{hint}</div>}
    </label>
  )
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  className?: string
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className={cx(
        'rounded-lg border border-white/10 bg-ink-900 px-2.5 py-1.5 text-[12.5px] text-fog-200 outline-none focus:border-teal-400/50',
        className,
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function Legend({ items }: { items: { color: string; label: string; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-fog-300">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span
            className="inline-block h-[3px] w-4 rounded-full"
            style={i.dashed ? { backgroundImage: `linear-gradient(90deg, ${i.color} 50%, transparent 50%)`, backgroundSize: '6px 3px' } : { background: i.color }}
          />
          {i.label}
        </span>
      ))}
    </div>
  )
}

export function KeyValue({ k, v, mono = true }: { k: ReactNode; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-white/[0.04] py-2 last:border-0">
      <span className="text-[12.5px] text-fog-400">{k}</span>
      <span className={cx('text-[13px] text-fog-100', mono && 'num')}>{v}</span>
    </div>
  )
}
