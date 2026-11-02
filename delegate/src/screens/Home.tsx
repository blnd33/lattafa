import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Boxes, ChevronRight, ClipboardList, HandCoins, MapPin, MapPinOff, ShoppingBag } from 'lucide-react'
import { Badge } from '@/components/ui/Controls'
import { cn } from '@/components/ui/cn'
import { useT } from '@/i18n'
import { useSession } from '../auth'
import { distanceKm, getPosition, today, type Position } from '../field'
import { useClosings, useCustomers, useMyDay, useShop } from '../hooks'
import { InstallBanner } from '../Install'
import { useWaitingOrders } from '../orders'
import { CheckInSheet } from './Customers'
import { IQD, LocationPill, SectionTitle, SyncPill, USD } from '../ui'
import { useTracker } from '../tracker'

const LOW = 2

/** Shops waiting for an answer — the first thing the delegate sees when he opens the app. */
function OrdersBanner() {
  const t = useT()
  const nav = useNavigate()
  const { data: waiting = 0 } = useWaitingOrders()
  if (!waiting) return null
  return (
    <button type="button" onClick={() => nav('/orders')}
      className="mx-4 mt-3 flex w-[calc(100%-2rem)] items-center gap-3 rounded-2xl border border-gold bg-gold-soft p-3.5 text-start dark:bg-gold/15">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-gold text-ink"><ClipboardList className="size-5" /></span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{t('dl.orders_waiting', { n: waiting })}</span>
        <span className="block text-xs text-fg-2">{t('dl.orders_waiting_hint')}</span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-fg-2 rtl:rotate-180" />
    </button>
  )
}

export function HomeScreen() {
  const t = useT()
  const locState = useTracker((x) => x.state)
  const nav = useNavigate()
  const actor = useSession((s) => s.actor)!
  const { data: day } = useMyDay()
  const { data: shop = [] } = useShop()
  const { data: customers = [] } = useCustomers()
  const { data: closings = [] } = useClosings()
  const [pos, setPos] = useState<Position | null>(null)
  const [checkIn, setCheckIn] = useState(false)
  useEffect(() => { void getPosition(8000).then(setPos) }, [])

  const hour = new Date().getHours()
  const greet = hour < 12 ? t('dl.gm') : hour < 18 ? t('dl.ga') : t('dl.ge')
  const units = shop.reduce((a, r) => a + Math.max(0, r.qty), 0)
  const low = shop.filter((r) => r.qty > 0 && r.qty <= LOW).length
  const todayClosing = closings.find((c) => c.day === today())

  // who to see next: the nearest shops when we know where we are, otherwise those who owe the most
  const next = useMemo(() => {
    const rows = customers.map((c) => ({ c, km: pos && c.lat != null && c.lng != null ? distanceKm(pos, { lat: c.lat, lng: c.lng }) : null }))
    return rows.sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity) || b.c.balanceIQD - a.c.balanceIQD).slice(0, 5)
  }, [customers, pos])

  const actions = [
    { label: t('dl.q_sale'), icon: ShoppingBag, onClick: () => nav('/sell') },
    { label: t('dl.q_collect'), icon: HandCoins, onClick: () => nav('/customers?owing=1') },
    { label: t('dl.q_visit'), icon: MapPin, onClick: () => setCheckIn(true) },
    { label: t('dl.shop_stock'), icon: Boxes, onClick: () => nav('/stock') },
  ]

  return (
    <div>
      <header className="flex items-center justify-between gap-3 px-4 pb-2 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-12 shrink-0 place-items-center rounded-full font-semibold text-ink" style={{ background: actor.color }}>{actor.name.slice(0, 2).toUpperCase()}</span>
          <div className="min-w-0"><p className="text-sm text-fg-2">{greet}</p><h1 className="truncate font-serif text-2xl font-semibold">{actor.name}</h1></div>
        </div>
        <div className="flex shrink-0 items-center gap-2"><LocationPill /><SyncPill /></div>
      </header>

      <OrdersBanner />
      <InstallBanner />
      {(locState === 'denied' || locState === 'unavailable') && (
        <p role="alert" className="mx-4 mt-2 flex items-start gap-2 rounded-2xl bg-danger-bg p-3 text-sm text-danger-fg"><MapPinOff className="mt-0.5 size-4 shrink-0" />{t(locState === 'denied' ? 'dl.loc_denied' : 'dl.loc_unavailable')}</p>
      )}

      <section className="mx-4 mt-3 overflow-hidden rounded-3xl bg-gradient-to-br from-charcoal to-ink p-5 text-[#f6f0e4] shadow-pop">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gold-light">{t('dl.today_sales')}</p>
        <IQD value={day?.salesIQD ?? 0} big className="mt-1 block font-serif text-4xl font-semibold text-gold-light" />
        <div className="mt-4 grid grid-cols-3 gap-2 border-t border-white/10 pt-3 text-sm">
          <div><p className="text-xs text-white/60">{t('dl.collected')}</p><IQD value={day?.collectionsIQD ?? 0} className="font-semibold" /></div>
          <div><p className="text-xs text-white/60">{t('dl.visits')}</p><span className="num font-semibold">{day?.visits ?? 0}</span></div>
          <div><p className="text-xs text-white/60">{t('dl.cash_hand')}</p><IQD value={day?.cashInHandIQD ?? 0} className="block font-semibold" />{(day?.cashInHandUSD ?? 0) > 0 && <USD value={day?.cashInHandUSD ?? 0} className="block font-semibold" />}</div>
        </div>
      </section>

      <div className="mx-4 mt-4 grid grid-cols-4 gap-2">
        {actions.map(({ label, icon: Icon, onClick }) => (
          <button key={label} type="button" onClick={onClick} className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl border border-line bg-surface p-2 text-center text-xs font-medium shadow-soft active:scale-[.97]">
            <span className="grid size-10 place-items-center rounded-xl bg-gold-soft text-gold-text dark:bg-gold/15"><Icon className="size-5" /></span>{label}
          </button>
        ))}
      </div>

      {todayClosing && (
        <div className={cn('mx-4 mt-4 rounded-2xl border p-3 text-sm', todayClosing.status === 'approved' ? 'border-success/40 bg-ok-bg text-ok-fg' : todayClosing.status === 'rejected' ? 'border-danger/40 bg-danger-bg text-danger-fg' : 'border-line bg-surface')}>
          {t(`dl.closing_${todayClosing.status}`)}{todayClosing.reviewNote ? ` — ${todayClosing.reviewNote}` : ''}
        </div>
      )}

      <button type="button" onClick={() => nav('/stock')} className="mx-4 mt-4 flex w-[calc(100%-2rem)] items-center gap-3 rounded-3xl border border-line bg-surface p-4 text-start shadow-soft">
        <span className="grid size-11 place-items-center rounded-2xl bg-surface-2"><Boxes className="size-6" /></span>
        <div className="flex-1">
          <p className="font-semibold">{t('dl.shop_stock')}</p>
          <p className="text-sm text-fg-2"><span className="num font-semibold text-fg">{units}</span> {t('dl.units')}</p>
        </div>
        {low > 0 && <Badge tone="warn">{t('dl.low_n', { n: low })}</Badge>}
        <ChevronRight className="size-5 text-fg-2 rtl:rotate-180" />
      </button>

      <SectionTitle>{t('dl.next')}</SectionTitle>
      <ul className="mx-4 divide-y divide-line overflow-hidden rounded-3xl border border-line bg-surface">
        {next.map(({ c, km }) => (
          <li key={c.id}>
            <button type="button" onClick={() => nav(`/customers?id=${c.id}`)} className="flex w-full items-center gap-3 p-3.5 text-start">
              <span className="grid size-10 place-items-center rounded-full bg-surface-2"><MapPin className="size-5 text-gold-text" /></span>
              <div className="min-w-0 flex-1"><p className="truncate font-medium">{c.name}</p><p className="truncate text-xs text-fg-2">{c.city || '—'}{km != null && ` · ${km.toFixed(1)} ${t('dl.km')}`}</p></div>
              {c.balanceIQD > 0 ? <span className="text-end text-xs text-fg-2">{t('dl.owes')}<br /><IQD value={c.balanceIQD} className="text-sm font-semibold text-warn-fg" /></span> : <Badge tone="ok">{t('dl.settled')}</Badge>}
            </button>
          </li>
        ))}
        {next.length === 0 && <li className="p-4 text-center text-sm text-fg-2">{t('dl.no_customers')}</li>}
      </ul>
      {checkIn && <CheckInSheet customerId={null} onClose={() => setCheckIn(false)} />}
    </div>
  )
}
