import { type ReactNode } from 'react'
import { Check, Minus } from 'lucide-react'
import { cn } from './cn'

/** iOS-style switch, 48×28 — large enough for a fingertip. */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn('relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50', checked ? 'bg-gold' : 'bg-line')}
    >
      <span className={cn('absolute top-0.5 size-6 rounded-full bg-white shadow transition-all', checked ? 'start-[1.375rem]' : 'start-0.5')} />
    </button>
  )
}

/** Checkbox with optional "some" (mixed) state — used by the permission matrix. */
export function Checkbox({ checked, mixed, onChange, label, disabled }: { checked: boolean; mixed?: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={mixed ? 'mixed' : checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn('grid size-6 shrink-0 place-items-center rounded-md border-2 transition disabled:opacity-40', checked || mixed ? 'border-gold bg-gold text-ink' : 'border-line bg-surface hover:border-gold')}
    >
      {mixed ? <Minus className="size-4" strokeWidth={3} /> : checked ? <Check className="size-4" strokeWidth={3} /> : null}
    </button>
  )
}

export interface SegOption<T extends string | number> { value: T; label: ReactNode; disabled?: boolean }

/** Segmented control (pill group). */
export function Segmented<T extends string | number>({ value, onChange, options, className, size = 'md', ariaLabel }: { value: T; onChange: (v: T) => void; options: SegOption<T>[]; className?: string; size?: 'sm' | 'md' | 'lg'; ariaLabel?: string }) {
  const h = size === 'sm' ? 'h-8 text-xs px-2.5' : size === 'lg' ? 'h-12 text-base px-4' : 'h-10 text-sm px-3.5'
  return (
    <div role="group" aria-label={ariaLabel} className={cn('inline-flex max-w-full gap-1 overflow-x-auto rounded-xl bg-surface-2 p-1 scroll-hide', className)}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          disabled={o.disabled}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn('whitespace-nowrap rounded-lg font-semibold transition disabled:opacity-40', h, o.value === value ? 'bg-gold text-ink shadow-sm' : 'text-fg-2 hover:text-fg')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Horizontally scrolling filter chips. */
export function Chips<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; className?: string }) {
  return (
    <div className={cn('flex gap-2 overflow-x-auto pb-1 scroll-hide', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn('h-11 shrink-0 whitespace-nowrap rounded-full border px-5 text-sm font-medium transition', o.value === value ? 'border-ink bg-ink text-gold-light dark:border-gold dark:bg-gold dark:text-ink' : 'border-line bg-surface text-fg hover:border-gold')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'gold' | 'ok' | 'warn' | 'danger'; className?: string }) {
  const tones = {
    neutral: 'bg-surface-2 text-fg-2',
    gold: 'bg-gold-soft text-[#6b4e12] dark:bg-gold/20 dark:text-gold-light',
    ok: 'bg-ok-bg text-ok-fg',
    warn: 'bg-warn-bg text-warn-fg',
    danger: 'bg-danger-bg text-danger-fg',
  }
  return <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold', tones[tone], className)}>{children}</span>
}

export function Card({ children, className, pad = true }: { children: ReactNode; className?: string; pad?: boolean }) {
  return <div className={cn('rounded-2xl border border-line bg-surface shadow-soft', pad && 'p-4 sm:p-5', className)}>{children}</div>
}

export function Avatar({ name, color, size = 40, className }: { name: string; color: string; size?: number; className?: string }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')
  return (
    <span
      aria-hidden
      className={cn('inline-grid shrink-0 place-items-center rounded-full font-bold text-ink', className)}
      style={{ width: size, height: size, background: `linear-gradient(135deg, ${color}, ${color}bb)`, fontSize: size * 0.36 }}
    >
      {initials || '?'}
    </span>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <span role="status" aria-label="Loading" className={cn('inline-block size-6 animate-spin rounded-full border-2 border-gold/30 border-t-gold', className)} />
}

export function EmptyState({ title, hint, action, className }: { title: ReactNode; hint?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-4 py-14 text-center text-fg-2', className)}>
      <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" className="h-24 opacity-30" draggable={false} />
      <p className="text-base font-semibold text-fg">{title}</p>
      {hint && <p className="max-w-sm text-sm">{hint}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

export function PageHeader({ title, subtitle, actions, className }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-4 flex flex-wrap items-end justify-between gap-3', className)}>
      <div className="min-w-0">
        <h1 className="font-serif text-2xl font-semibold leading-tight sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-fg-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

/** A stat tile for dashboards / summaries. */
export function Stat({ label, value, sub, tone }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: 'gold' | 'ok' | 'danger' }) {
  return (
    <div className={cn('rounded-2xl border p-4', tone === 'gold' ? 'border-ink bg-gradient-to-br from-charcoal to-ink text-[#f6f0e4]' : 'border-line bg-surface')}>
      <div className={cn('text-xs', tone === 'gold' ? 'text-[#b9ae9c]' : 'text-fg-2')}>{label}</div>
      <div className={cn('mt-1 font-serif text-2xl font-semibold leading-tight', tone === 'gold' && 'text-gold', tone === 'ok' && 'text-ok-fg', tone === 'danger' && 'text-danger')}>{value}</div>
      {sub && <div className={cn('mt-0.5 text-xs', tone === 'gold' ? 'text-[#b9ae9c]' : 'text-fg-2')}>{sub}</div>}
    </div>
  )
}
