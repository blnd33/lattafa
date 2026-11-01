import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { useToast } from '@/store/toast'
import { cn } from './cn'

export function Toaster() {
  const items = useToast((s) => s.items)
  const dismiss = useToast((s) => s.dismiss)
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex flex-col items-center gap-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))] md:bottom-0 md:top-auto md:pb-6" aria-live="polite">
      {items.map((t) => (
        <div
          key={t.id}
          role={t.kind === 'error' ? 'alert' : 'status'}
          className={cn(
            'pointer-events-auto flex w-full max-w-md animate-pop items-start gap-3 rounded-2xl border px-4 py-3 text-sm font-medium shadow-pop',
            t.kind === 'error' ? 'border-danger/40 bg-danger-bg text-danger-fg' : t.kind === 'success' ? 'border-ok-fg/30 bg-ok-bg text-ok-fg' : 'border-gold/40 bg-ink text-[#f6f0e4]',
          )}
        >
          {t.kind === 'error' ? <AlertTriangle className="mt-0.5 size-5 shrink-0" /> : t.kind === 'success' ? <CheckCircle2 className="mt-0.5 size-5 shrink-0" /> : <Info className="mt-0.5 size-5 shrink-0 text-gold" />}
          <span className="min-w-0 flex-1 break-words">{t.text}</span>
          <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)} className="-m-1 rounded-lg p-1 opacity-70 hover:opacity-100"><X className="size-4" /></button>
        </div>
      ))}
    </div>
  )
}
