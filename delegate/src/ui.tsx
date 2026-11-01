import { useState, type ReactNode } from 'react'
import { Cloud, CloudOff, MapPin, MapPinOff, RefreshCw } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { cn } from '@/components/ui/cn'
import { LANGS, useT } from '@/i18n'
import { useUI } from '@/store/ui'
import { fmt } from '@/lib/money'
import { useOnline } from '@/hooks/useDevice'
import { usePending } from './hooks'
import { syncNow } from './sync'
import { useTracker } from './tracker'
import { toast } from '@/store/toast'

/** Screen title row with the sync pill. */
export function TopBar({ title, subtitle, children }: { title: ReactNode; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 border-b border-line/70 bg-bg/90 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate font-serif text-2xl font-semibold">{title}</h1>
          {subtitle && <p className="truncate text-sm text-fg-2">{subtitle}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2"><LocationPill /><SyncPill /></div>
      </div>
      {children && <div className="mt-3">{children}</div>}
    </header>
  )
}

/** Live location: a green pin while the shop can see where you are, a red one when the phone can't share it. */
export function LocationPill() {
  const t = useT()
  const state = useTracker((s) => s.state)
  if (state === 'off') return null
  const on = state === 'on' || state === 'starting'
  const msg = t(state === 'on' ? 'dl.loc_on' : state === 'starting' ? 'dl.locating' : state === 'denied' ? 'dl.loc_denied' : 'dl.loc_unavailable')
  return (
    <button type="button" aria-label={msg} title={msg} onClick={() => (on ? toast.info(msg) : toast.error(msg))}
      className={cn('relative grid size-9 shrink-0 place-items-center rounded-full', state === 'on' ? 'bg-ok-bg text-success' : on ? 'bg-surface-2 text-fg-2' : 'bg-danger-bg text-danger')}>
      {on ? <MapPin className="size-4" /> : <MapPinOff className="size-4" />}
      {state === 'on' && <span className="absolute end-1.5 top-1.5 size-2 animate-pulse rounded-full bg-success" />}
    </button>
  )
}

/** Online/offline + how much is waiting to be sent. Tap = sync now. */
export function SyncPill() {
  const t = useT()
  const online = useOnline()
  const { data: pending = 0 } = usePending()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const run = async () => { if (busy) return; setBusy(true); try { await syncNow(); await qc.invalidateQueries() } finally { setBusy(false) } }
  return (
    <button type="button" onClick={run} aria-label={t('sync.now')}
      className={cn('inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold', online ? 'bg-surface-2 text-fg' : 'bg-warn-bg text-warn-fg')}>
      {busy ? <RefreshCw className="size-4 animate-spin" /> : online ? <Cloud className="size-4" /> : <CloudOff className="size-4" />}
      {online ? (pending ? t('dl.pending', { n: pending }) : t('dl.synced')) : t('dl.offline_n', { n: pending })}
    </button>
  )
}

export function IQD({ value, className, big }: { value: number; className?: string; big?: boolean }) {
  const t = useT()
  return <span className={cn('num whitespace-nowrap', className)}>{fmt(value)}<small className={cn('ms-1 font-sans font-medium opacity-70', big ? 'text-sm' : 'text-[0.7em]')}>{t('dl.iqd')}</small></span>
}

/** "$25" / "$24.66" — cents only when there are some. */
export const fmtDollars = (n: number) => {
  const c = Math.round(n * 100) / 100
  return Number.isInteger(c) ? fmt(c) : c.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function USD({ value, className, big }: { value: number; className?: string; big?: boolean }) {
  return <span className={cn('num whitespace-nowrap', className)}><small className={cn('me-0.5 font-sans font-medium opacity-70', big ? 'text-sm' : 'text-[0.8em]')}>$</small>{value < 0 ? '−' : ''}{fmtDollars(Math.abs(value))}</span>
}

/** An amount kept in IQD, shown in the bill's currency (dollars at the shop's rate). */
export function Money({ iqd, currency, rate, className, big }: { iqd: number; currency: 'IQD' | 'USD'; rate: number; className?: string; big?: boolean }) {
  return currency === 'USD' && rate > 0 ? <USD value={iqd / rate} className={className} big={big} /> : <IQD value={iqd} className={className} big={big} />
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return <div className="mb-2 mt-6 flex items-center justify-between px-4"><h2 className="font-serif text-lg font-semibold">{children}</h2>{action}</div>
}

export function Stepper({ value, onChange, max, label }: { value: number; onChange: (v: number) => void; max?: number; label: string }) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      <button type="button" aria-label="−" onClick={() => onChange(Math.max(0, value - 1))} className="grid size-11 place-items-center rounded-xl bg-surface-2 text-lg font-bold">−</button>
      <span className="num w-9 text-center text-base font-semibold" aria-live="polite">{value}</span>
      <button type="button" aria-label="+" disabled={max !== undefined && value >= max} onClick={() => onChange(value + 1)} className="grid size-11 place-items-center rounded-xl bg-surface-2 text-lg font-bold disabled:opacity-35">+</button>
    </div>
  )
}

/** Language switch (the preference is shared with the POS and menu on this domain — not the sign-in). */
export function LangSwitch() {
  const lang = useUI((s) => s.lang)
  const setLang = useUI((s) => s.setLang)
  return (
    <div role="group" aria-label="Language" className="flex gap-1 rounded-full border border-line bg-surface p-1">
      {LANGS.map((l) => (
        <button key={l.code} type="button" aria-pressed={lang === l.code} onClick={() => setLang(l.code)}
          className={cn('min-h-9 rounded-full px-3 text-sm font-semibold', lang === l.code ? 'bg-gold text-ink' : 'text-fg-2')}>{l.label}</button>
      ))}
    </div>
  )
}
