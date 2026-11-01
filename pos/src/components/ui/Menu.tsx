import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Modal } from './Modal'
import { cn } from './cn'
import { useMedia } from '@/hooks/useDevice'

/**
 * A menu that is a dropdown on tablets/desktops and a bottom sheet on phones.
 * `children` is a render function so items can close the menu.
 */
export function Menu({ trigger, title, children, align = 'end', width = 'w-72' }: { trigger: (p: { open: boolean; toggle: () => void }) => ReactNode; title?: ReactNode; children: (close: () => void) => ReactNode; align?: 'start' | 'end'; width?: string }) {
  const [open, setOpen] = useState(false)
  const wide = useMedia('(min-width: 768px)')
  const ref = useRef<HTMLDivElement>(null)
  const close = () => setOpen(false)

  useEffect(() => {
    if (!open || !wide) return
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open, wide])

  return (
    <div ref={ref} className="relative">
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {wide && open && (
        <div className={cn('absolute top-full z-40 mt-2 animate-pop overflow-hidden rounded-2xl border border-line bg-surface p-1.5 shadow-pop', width, align === 'end' ? 'end-0' : 'start-0')}>
          {children(close)}
        </div>
      )}
      {!wide && (
        <Modal open={open} onClose={close} title={title} size="sm" bodyClassName="p-2">
          {children(close)}
        </Modal>
      )}
    </div>
  )
}

/** A row inside a <Menu>. */
export function MenuItem({ icon, children, onClick, danger, hint, active }: { icon?: ReactNode; children: ReactNode; onClick?: () => void; danger?: boolean; hint?: ReactNode; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-start text-sm font-medium transition hover:bg-surface-2', danger && 'text-danger', active && 'bg-gold-soft text-[#6b4e12] dark:bg-gold/15 dark:text-gold-light')}
    >
      {icon && <span className="shrink-0 opacity-80">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="text-xs text-fg-2">{hint}</span>}
    </button>
  )
}
