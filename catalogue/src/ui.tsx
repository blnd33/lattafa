import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Perfume } from './api'
import { useT } from './words'

/** Tailwind classes glued together, skipping anything falsy. */
export const cx = (...parts: (string | false | null | undefined)[]): string => parts.filter(Boolean).join(' ')

/* ───────────────────────── the bottle ───────────────────────── */

/**
 * A perfume's photograph, or — until the shop has one — a drawn bottle in its own two colours.
 *
 * The brief is firm that no stand-in photograph may ever be passed off as real Lattafa stock, so the fallback is
 * plainly a drawing: a silhouette in the colours the product carries, never someone else's perfume.
 */
export function Bottle({ perfume, className, eager }: { perfume: Perfume; className?: string; eager?: boolean }) {
  const [broken, setBroken] = useState(false)
  const { c1, c2 } = perfume.art ?? { c1: '#C9A227', c2: '#7A5C12' }

  if (perfume.image && !broken) {
    return (
      <img
        src={perfume.image}
        alt={perfume.name}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        onError={() => setBroken(true)}
        className={cx('h-full w-full object-contain', className)}
      />
    )
  }

  return (
    <svg viewBox="0 0 120 170" role="img" aria-label={perfume.name} className={cx('h-full w-full', className)}>
      <defs>
        <linearGradient id={`g-${perfume.id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c1} stopOpacity="0.95" />
          <stop offset="100%" stopColor={c2} stopOpacity="0.95" />
        </linearGradient>
      </defs>
      <rect x="49" y="12" width="22" height="20" rx="4" fill={c2} opacity="0.9" />
      <rect x="54" y="30" width="12" height="12" fill={c2} opacity="0.7" />
      <rect x="26" y="42" width="68" height="112" rx="14" fill={`url(#g-${perfume.id})`} />
      <rect x="36" y="56" width="14" height="80" rx="7" fill="#fff" opacity="0.18" />
      <text x="60" y="112" textAnchor="middle" fill="#fff" fillOpacity="0.85" fontSize="13" fontFamily="serif" letterSpacing="2">
        {(perfume.brand || 'L').slice(0, 1).toUpperCase()}
      </text>
    </svg>
  )
}

/* ───────────────────────── small pieces ───────────────────────── */

export function Pill({ children, tone = 'gold' }: { children: ReactNode; tone?: 'gold' | 'quiet' }) {
  return (
    <span className={cx(
      'inline-block rounded-full px-2.5 py-0.5 text-[0.65rem] font-semibold tracking-[0.12em] uppercase',
      tone === 'gold' ? 'bg-gold-soft text-gold-text' : 'bg-surface-2 text-fg-2',
    )}>{children}</span>
  )
}

export function Rule({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cx('flex items-center justify-center gap-3', className)}>
      <span className="h-px w-10 bg-line" />
      <span className="h-1.5 w-1.5 rotate-45 bg-gold" />
      <span className="h-px w-10 bg-line" />
    </span>
  )
}

export function SectionTitle({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <h2 className="font-serif text-2xl sm:text-3xl">{title}</h2>
      {action}
    </div>
  )
}

export function Button({ children, onClick, variant = 'primary', type = 'button', disabled, className, full }: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'quiet' | 'ghost'
  type?: 'button' | 'submit'
  disabled?: boolean
  className?: string
  full?: boolean
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold tracking-wide transition disabled:opacity-45',
        variant === 'primary' && 'bg-ink text-white hover:bg-charcoal',
        variant === 'quiet' && 'border border-line bg-surface text-fg hover:border-gold',
        variant === 'ghost' && 'text-fg-2 hover:text-fg',
        full && 'w-full',
        className,
      )}
    >{children}</button>
  )
}

export function Spinner({ className }: { className?: string }) {
  const t = useT()
  return <span role="status" aria-label={t('cat.loading')} className={cx('inline-block animate-spin rounded-full border-2 border-gold/30 border-t-gold', className ?? 'size-8')} />
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <Rule />
      <p className="font-serif text-xl">{title}</p>
      {hint && <p className="max-w-sm text-sm text-fg-2">{hint}</p>}
      {action}
    </div>
  )
}

/* ───────────────────────── how many bottles ───────────────────────── */

/**
 * The quantity control.
 *
 * It moves in the steps the shop sells in: where a size goes six at a time, + takes it from 6 to 12, not to 7,
 * and the first + from nothing lands on the smallest quantity allowed. The server checks all of this again —
 * this is only so the buyer does not have to guess.
 */
export function Quantity({ qty, minQty, step, onChange, disabled }: {
  qty: number
  minQty: number
  step: number
  onChange: (qty: number) => void
  disabled?: boolean
}) {
  const t = useT()
  const jump = Math.max(1, step)
  const floor = Math.max(minQty, step > 1 ? step : 1)

  const up = () => onChange(qty === 0 ? floor : qty + jump)
  const down = () => onChange(qty - jump < floor ? 0 : qty - jump)

  return (
    <div className="inline-flex items-center rounded-full border border-line bg-surface">
      <button type="button" onClick={down} disabled={disabled || qty === 0} aria-label={t('cat.remove')}
        className="grid size-11 place-items-center rounded-full text-lg text-fg-2 transition hover:text-fg disabled:opacity-35">−</button>
      <span className="num w-10 text-center text-sm font-semibold">{qty}</span>
      <button type="button" onClick={up} disabled={disabled} aria-label={t('cat.add_to_order')}
        className="grid size-11 place-items-center rounded-full text-lg text-fg-2 transition hover:text-fg disabled:opacity-35">+</button>
    </div>
  )
}

/* ───────────────────────── a panel that slides in ───────────────────────── */

export function Drawer({ open, onClose, title, children, footer }: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
}) {
  const t = useT()
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    panel.current?.focus()
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = overflow }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label={t('cat.close')} onClick={onClose} className="absolute inset-0 bg-overlay motion-safe:animate-fade" />
      <div ref={panel} tabIndex={-1} className="relative flex h-full w-full max-w-md flex-col bg-bg shadow-pop outline-none motion-safe:animate-rise">
        <div className="flex items-center justify-between border-b border-line px-5 pt-safe">
          <h2 className="font-serif text-xl">{title}</h2>
          <button type="button" onClick={onClose} aria-label={t('cat.close')} className="-me-2 grid size-11 place-items-center rounded-full text-fg-2 transition hover:text-fg">✕</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
        {footer && <div className="border-t border-line px-5 py-4 pb-safe">{footer}</div>}
      </div>
    </div>
  )
}
