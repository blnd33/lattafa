import { useEffect, useRef } from 'react'
import { Delete } from 'lucide-react'
import { useT } from '@/i18n'
import { cn } from './cn'

/** Big touch numpad. Always left-to-right, even in Arabic/Kurdish layouts. */
export function Numpad({ onKey, extra = '000', compact, className }: { onKey: (k: string) => void; extra?: '000' | '.' | '00' | ''; compact?: boolean; className?: string }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', extra, '0', 'del']
  return (
    <div dir="ltr" className={cn('grid grid-cols-3 gap-2', className)}>
      {keys.map((k, i) =>
        k === '' ? <span key={i} aria-hidden /> : (
          <button
            key={i}
            type="button"
            aria-label={k === 'del' ? 'Backspace' : k}
            onClick={() => onKey(k)}
            className={cn('grid place-items-center rounded-2xl bg-surface-2 font-sans text-2xl font-semibold text-fg transition active:scale-95 active:bg-gold-soft dark:active:bg-charcoal', compact ? 'h-12' : 'h-16')}
          >
            {k === 'del' ? <Delete className="size-6" /> : k}
          </button>
        ),
      )}
    </div>
  )
}

/** PIN dots + numpad. Calls onComplete when `length` digits are entered. */
export function PinPad({ value, onChange, length = 6, minLength = 4, error, onSubmit, disabled, keyboard }: { value: string; onChange: (v: string) => void; length?: number; minLength?: number; error?: boolean; onSubmit: (pin: string) => void; disabled?: boolean; keyboard?: boolean }) {
  const t = useT()
  const press = (k: string) => {
    if (disabled) return
    if (k === 'del') return onChange(value.slice(0, -1))
    if (!/^\d$/.test(k)) return
    if (value.length >= length) return
    const next = value + k
    onChange(next)
    if (next.length === length) onSubmit(next)
  }
  // `keyboard`: a till or laptop keyboard works too — digits, Backspace, Enter. Only on sign-in screens, so a barcode
  // scanned while a manager-approval pad is open can never type into it.
  const submitTyped = () => { if (!disabled && value.length >= minLength) onSubmit(value) }
  const latest = useRef({ press, submit: submitTyped })
  latest.current = { press, submit: submitTyped }
  useEffect(() => {
    if (!keyboard) return
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (e.ctrlKey || e.metaKey || e.altKey || el?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (e.key === 'Enter' && el?.closest('button')) return // the focused button handles its own Enter
      if (/^[0-9]$/.test(e.key)) latest.current.press(e.key)
      else if (e.key === 'Backspace') latest.current.press('del')
      else if (e.key === 'Enter') latest.current.submit()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [keyboard])
  return (
    <div className="mx-auto w-full max-w-[19rem]">
      <div dir="ltr" className={cn('mb-5 flex justify-center gap-3.5', error && 'animate-shake')} aria-label={`${value.length} digits entered`}>
        {Array.from({ length }).map((_, i) => (
          <span key={i} className={cn('size-3.5 rounded-full border-2 transition', i < value.length ? 'border-gold bg-gold shadow-[0_0_10px_rgba(212,165,72,.7)]' : error ? 'border-danger' : 'border-gold/60')} />
        ))}
      </div>
      <Numpad onKey={press} extra="" />
      <button
        type="button"
        disabled={disabled || value.length < minLength}
        onClick={() => onSubmit(value)}
        className="mt-3 h-12 w-full rounded-2xl bg-gradient-to-b from-gold to-gold-dark font-semibold text-ink transition active:scale-[.98] disabled:opacity-40"
      >
        {t('common.ok')}
      </button>
    </div>
  )
}
