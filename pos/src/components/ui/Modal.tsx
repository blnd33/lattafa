import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useT } from '@/i18n'
import { Button, IconButton } from './Button'
import { cn } from './cn'

const SIZES = {
  sm: 'md:max-w-sm',
  md: 'md:max-w-lg',
  lg: 'md:max-w-2xl',
  xl: 'md:max-w-4xl',
  '2xl': 'md:max-w-6xl',
  full: 'md:max-w-[min(96vw,1400px)]',
} as const

let lockCount = 0
function lockScroll() {
  if (lockCount++ === 0) document.body.style.overflow = 'hidden'
  return () => { if (--lockCount === 0) document.body.style.overflow = '' }
}

/** Open dialogs, oldest first. Only the top-most one reacts to Esc / Tab (e.g. a PIN approval opened over the payment dialog). */
const stack: HTMLElement[] = []

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  size?: keyof typeof SIZES
  children: ReactNode
  footer?: ReactNode
  /** false = backdrop tap / Esc don't close (payment in progress etc.) */
  dismissible?: boolean
  /** slide in from the side instead of centring (tablet cart) */
  side?: boolean
  className?: string
  bodyClassName?: string
  /** print-friendly: adds the .print-area class to the panel */
  printArea?: boolean
}

/**
 * Responsive dialog: a bottom sheet on phones, a centred card from `md` up
 * (or a side drawer with `side`). Traps focus, closes on Esc, locks page scroll.
 */
export function Modal({ open, onClose, title, size = 'md', children, footer, dismissible = true, side, className, bodyClassName, printArea }: ModalProps) {
  const t = useT()
  const panel = useRef<HTMLDivElement>(null)
  const prev = useRef<Element | null>(null)
  const titleId = useId() // screen readers announce the dialog by its title

  useEffect(() => {
    if (!open) return
    prev.current = document.activeElement
    const unlock = lockScroll()
    const el = panel.current
    if (el) stack.push(el)
    const first = el?.querySelector<HTMLElement>('[data-autofocus]') ?? el?.querySelector<HTMLElement>('input,select,textarea')
    ;(first ?? el)?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (!el || stack[stack.length - 1] !== el) return
      if (e.key === 'Escape' && dismissible) { e.stopPropagation(); onClose(); return }
      if (e.key !== 'Tab' || !el) return
      const f = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null)
      if (!f.length) return
      const a = f[0], z = f[f.length - 1]
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus() }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus() }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      const at = el ? stack.indexOf(el) : -1
      if (at >= 0) stack.splice(at, 1)
      unlock()
      if (prev.current instanceof HTMLElement) prev.current.focus({ preventScroll: true })
    }
  }, [open, dismissible, onClose])

  if (!open) return null
  return createPortal(
    <div
      className={cn('no-print-bg fixed inset-0 z-50 flex justify-center bg-overlay backdrop-blur-[2px] animate-fade', side ? 'items-stretch md:justify-end' : 'items-end md:items-center md:p-6')}
      onMouseDown={(e) => { if (dismissible && e.target === e.currentTarget) onClose() }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title !== undefined ? titleId : undefined}
        tabIndex={-1}
        className={cn(
          'flex w-full flex-col bg-surface text-fg shadow-pop outline-none',
          side ? 'max-h-dvh animate-rise md:max-w-md md:animate-fade md:rounded-s-3xl' : cn('max-h-[94dvh] animate-rise rounded-t-3xl md:max-h-[90dvh] md:animate-pop md:rounded-3xl', SIZES[size]),
          printArea && 'print-area',
          className,
        )}
      >
        {title !== undefined && (
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-5 py-3.5 no-print">
            <h2 id={titleId} className="min-w-0 truncate font-serif text-xl font-semibold">{title}</h2>
            {dismissible && <IconButton label={t('common.close')} variant="ghost" onClick={onClose}><X className="size-5" /></IconButton>}
          </div>
        )}
        <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain p-5', bodyClassName)}>{children}</div>
        {footer && <div className="shrink-0 border-t border-line bg-surface-2/60 px-5 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] no-print md:rounded-b-3xl">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

/* ───────── confirm dialogs ───────── */

interface ConfirmOpts {
  title: string
  message?: ReactNode
  confirmLabel?: string
  danger?: boolean
}
type ConfirmFn = (o: ConfirmOpts) => Promise<boolean>
const ConfirmCtx = createContext<ConfirmFn>(async () => false)

/** `const confirm = useConfirm(); if (await confirm({title:'Delete?'})) …` */
export const useConfirm = () => useContext(ConfirmCtx)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const t = useT()
  const [state, setState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null)
  const confirm = useCallback<ConfirmFn>((o) => new Promise((resolve) => setState({ ...o, resolve })), [])
  const close = (v: boolean) => { state?.resolve(v); setState(null) }
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Modal
        open={!!state}
        onClose={() => close(false)}
        title={state?.title}
        size="sm"
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button size="lg" variant="secondary" onClick={() => close(false)}>{t('common.cancel')}</Button>
            <Button size="lg" variant={state?.danger ? 'danger' : 'primary'} onClick={() => close(true)} data-autofocus>{state?.confirmLabel ?? t('common.confirm')}</Button>
          </div>
        }
      >
        {state?.message && <div className="text-sm leading-relaxed text-fg-2">{state.message}</div>}
      </Modal>
    </ConfirmCtx.Provider>
  )
}
