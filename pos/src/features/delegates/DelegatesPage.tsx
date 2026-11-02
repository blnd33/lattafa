import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, ExternalLink, MapPin, Navigation, Route, Store, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Avatar, Badge, Card, EmptyState, PageHeader, Segmented, Spinner } from '@/components/ui/Controls'
import { Field, Input } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { cn } from '@/components/ui/cn'
import { useAction } from '@/hooks/queries'
import { pick, useT } from '@/i18n'
import { fmt, fmtUSD } from '@/lib/money'
import { isServer } from '@/services/mode'
import { listSales } from '@/services/sales'
import {
  approveClosing, closingsOf, listDelegates, locationsOf, rejectClosing, visitsOf,
  type ClosingRow, type DelegateRow, type LocationPoint,
} from '@/services/delegates'
import { useUI } from '@/store/ui'

// delegates sell the shop's own stock (no van), so their page is about sales: what, to which shop and where
type Tab = 'sales' | 'location' | 'closings' | 'visits'
const IQD = ({ v, className }: { v: number; className?: string }) => <span className={cn('num whitespace-nowrap', className)}>{fmt(v)} <small className="text-fg-2">IQD</small></span>

/**
 * Managers: every delegate's sales (and where), live location, visits and daily closings.
 * `reports` (the admin panel passes it in): their own reports, as a second tab of this section.
 */
export function DelegatesPage({ reports, prices }: { reports?: ReactNode; prices?: ReactNode }) {
  const t = useT()
  const [selected, setSelected] = useState<string | null>(null)
  const [section, setSection] = useState<'team' | 'prices' | 'reports'>('team')
  const list = useQuery({ queryKey: ['delegates'], queryFn: listDelegates, enabled: isServer(), refetchInterval: 30_000 })
  if (!isServer()) return <div className="p-4"><PageHeader title={t('dlg.title')} /><EmptyState title={t('dlg.needs_server')} /></div>
  const rows = list.data ?? []
  const current = rows.find((d) => d.id === selected) ?? rows[0]

  return (
    <div className={cn('mx-auto space-y-4 p-4', section === 'reports' ? 'max-w-[1400px]' : 'max-w-6xl')}>
      <PageHeader title={t('dlg.title')} subtitle={t('dlg.subtitle')} actions={reports
        ? <Segmented value={section} onChange={setSection} options={(['team', 'prices', 'reports'] as const).filter((x) => x !== 'prices' || prices).map((x) => ({ value: x, label: t(`dlg.sec_${x}`) }))} />
        : undefined} />
      {prices && section === 'prices' ? prices
        : reports && section === 'reports' ? reports
        : list.isLoading ? <Spinner className="mx-auto size-8" /> : rows.length === 0 ? <EmptyState title={t('dlg.none')} hint={t('dlg.none_hint')} /> : (
        <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
          <ul className="space-y-2">
            {rows.map((d) => (
              <li key={d.id}>
                <button type="button" onClick={() => setSelected(d.id)}
                  className={cn('flex w-full items-center gap-3 rounded-2xl border bg-surface p-3 text-start transition', current?.id === d.id ? 'border-gold' : 'border-line hover:border-gold/50')}>
                  <Avatar name={d.name} color={d.color} size={44} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{d.name}</p>
                    <p className="text-xs text-fg-2">{t('dlg.today')} <IQD v={d.todaySalesIQD} /></p>
                    <LastSeen p={d.lastLocation} className="mt-0.5" />
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {d.openRequests > 0 && <Badge tone="warn">{t('dlg.req_n', { n: d.openRequests })}</Badge>}
                    {d.pendingClosings > 0 && <Badge tone="gold">{t('dlg.closing_n', { n: d.pendingClosings })}</Badge>}
                  </div>
                </button>
              </li>
            ))}
          </ul>
          {current && <Detail d={current} />}
        </div>
      )}
    </div>
  )
}

function Detail({ d }: { d: DelegateRow }) {
  const t = useT()
  const [tab, setTab] = useState<Tab>('sales')
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        {([['dlg.today_sales', d.todaySalesIQD], ['dlg.today_collected', d.todayCollectionsIQD]] as const).map(([k, v]) => (
          <Card key={k} className="!p-3"><p className="text-xs text-fg-2">{t(k)}</p><IQD v={v} className="text-lg font-semibold" /></Card>
        ))}
        <Card className="!p-3"><p className="text-xs text-fg-2">{t('dlg.today_visits')}</p><p className="num text-lg font-semibold">{d.todayVisits}</p></Card>
      </div>
      <Segmented value={tab} onChange={setTab} options={(['sales', 'location', 'closings', 'visits'] as Tab[]).map((x) => ({ value: x, label: t(`dlg.tab_${x}`) }))} />
      {tab === 'sales' && <SalesTab d={d} />}
      {tab === 'location' && <LocationTab d={d} />}
      {tab === 'closings' && <ClosingsTab d={d} />}
      {tab === 'visits' && <VisitsTab d={d} />}
    </div>
  )
}

/** One day of a delegate's sales: which shop, where (map), what and for how much — dollars when billed in dollars. */
function SalesTab({ d }: { d: DelegateRow }) {
  const t = useT()
  const lang = useUI((s) => s.lang)
  const [day, setDay] = useState(today())
  const [y, m, dd] = day.split('-').map(Number)
  const from = new Date(y, m - 1, dd).getTime()
  const q = useQuery({
    queryKey: ['delegates', d.id, 'sales', day],
    queryFn: async () => (await listSales({ from, to: from + 86_400_000 - 1, userId: d.id })).filter((s) => s.channel === 'delegate' && s.status !== 'voided'),
    refetchInterval: 30_000,
  })
  const sales = q.data ?? []
  const amount = (s: (typeof sales)[number]) => (s.currency === 'USD' && s.exchangeRate > 0
    ? <span className="num whitespace-nowrap font-semibold">${fmtUSD(s.totalIQD / s.exchangeRate)}</span> : <IQD v={s.totalIQD} className="font-semibold" />)
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Field label={t('dlg.route_day')}>{(id) => <Input id={id} type="date" className="num !w-44" value={day} max={today()} onChange={(e) => e.target.value && setDay(e.target.value)} />}</Field>
        {sales.length > 0 && <p className="text-sm text-fg-2">{t('dlg.sales_n', { n: sales.length })}</p>}
      </div>
      {q.isLoading ? <Spinner /> : !sales.length ? <p className="text-sm text-fg-2">{t('dlg.no_sales')}</p> : (
        <ul className="divide-y divide-line">
          {sales.map((s) => (
            <li key={s.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-3 text-sm">
              <span className="num w-12 shrink-0 text-fg-2">{new Date(s.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 font-semibold"><Store className="size-4 shrink-0 text-gold-text" />{s.customerName || t('dlg.no_customer')}</p>
                {s.note && <p className="mt-0.5 text-fg-2">{s.note}</p>}
                <p className="mt-0.5 text-xs text-fg-2">{s.items.map((i) => `${pick(i.name, lang)} ${i.label} ×${i.qty}`).join(', ')}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                {amount(s)}
                {s.dueIQD > 0 && <Badge tone="warn">{t('dlg.on_debt')} <IQD v={s.dueIQD} /></Badge>}
                {s.lat != null && s.lng != null && (
                  <a className="inline-flex items-center gap-1 text-xs font-semibold text-gold-text underline" target="_blank" rel="noopener noreferrer" href={mapsLink({ lat: s.lat, lng: s.lng })}>
                    <MapPin className="size-3" />{t('dlg.map')}
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function ClosingsTab({ d }: { d: DelegateRow }) {
  const t = useT()
  const closings = useQuery({ queryKey: ['delegates', d.id, 'closings'], queryFn: () => closingsOf(d.id) })
  const [review, setReview] = useState<ClosingRow | null>(null)
  if (closings.isLoading) return <Spinner />
  if (!closings.data?.length) return <Card><p className="text-sm text-fg-2">{t('dlg.no_closings')}</p></Card>
  return (
    <div className="space-y-2">
      {closings.data.map((c) => (
        <Card key={c.id} className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="num font-semibold">{c.day}</p>
            <p className="text-sm text-fg-2">{t('dlg.sales')}: <IQD v={c.salesIQD} /> · {t('dlg.expected')}: <IQD v={c.expectedCashIQD} /> · {t('dlg.counted')}: <IQD v={c.countedCashIQD} /></p>
            {c.varianceIQD !== 0 && <p className={cn('num text-sm font-semibold', c.varianceIQD < 0 ? 'text-danger' : 'text-warn-fg')}>{t('dlg.variance')}: {c.varianceIQD > 0 ? '+' : ''}{fmt(c.varianceIQD)}</p>}
            {(c.expectedCashUSD || c.countedCashUSD) ? <p className="text-sm text-fg-2">{t('dlg.expected_usd')}: <span className="num">${fmtUSD(c.expectedCashUSD ?? 0)}</span> · {t('dlg.counted_usd')}: <span className="num">${fmtUSD(c.countedCashUSD ?? 0)}</span></p> : null}
            {(c.varianceUSD ?? 0) !== 0 && <p className={cn('num text-sm font-semibold', (c.varianceUSD ?? 0) < 0 ? 'text-danger' : 'text-warn-fg')}>{t('dlg.variance_usd')}: {(c.varianceUSD ?? 0) > 0 ? '+' : '−'}${fmtUSD(Math.abs(c.varianceUSD ?? 0))}</p>}
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={c.status === 'approved' ? 'ok' : c.status === 'rejected' ? 'danger' : 'gold'}>{t(`dlg.cl_${c.status}`)}</Badge>
            {c.status === 'submitted' && <Button size="sm" variant="primary" onClick={() => setReview(c)}>{t('dlg.review')}</Button>}
          </div>
        </Card>
      ))}
      {review && <ReviewSheet c={review} onClose={() => setReview(null)} />}
    </div>
  )
}

function ReviewSheet({ c, onClose }: { c: ClosingRow; onClose: () => void }) {
  const t = useT()
  const [note, setNote] = useState('')
  const approve = useAction(approveClosing, { success: 'dlg.approved' })
  const reject = useAction(rejectClosing, { success: 'dlg.rejected' })
  const rows: [string, number][] = [
    ['dlg.sales', c.salesIQD], ['dlg.cash_sales', c.cashSalesIQD], ['dlg.credit_sales', c.creditSalesIQD], ['dlg.collections', c.collectionsIQD],
    ['dlg.expenses', c.expensesIQD], ['dlg.expected', c.expectedCashIQD], ['dlg.counted', c.countedCashIQD],
  ]
  return (
    <Modal open onClose={onClose} title={`${c.userName} · ${c.day}`}
      footer={<div className="flex gap-2">
        <Button variant="danger" className="flex-1" loading={reject.busy} icon={<X className="size-5" />} onClick={async () => { if (await reject(c.id, note)) onClose() }}>{t('dlg.reject')}</Button>
        <Button variant="primary" className="flex-1" loading={approve.busy} icon={<Check className="size-5" />} onClick={async () => { if (await approve(c.id, note)) onClose() }}>{t('dlg.approve')}</Button>
      </div>}>
      <dl className="space-y-1.5 text-sm">
        {rows.map(([k, v]) => <div key={k} className="flex justify-between"><dt className="text-fg-2">{t(k)}</dt><dd><IQD v={v} /></dd></div>)}
        <div className={cn('flex justify-between border-t border-line pt-2 font-semibold', c.varianceIQD < 0 ? 'text-danger' : '')}><dt>{t('dlg.variance')}</dt><dd className="num">{c.varianceIQD > 0 ? '+' : ''}{fmt(c.varianceIQD)}</dd></div>
        {(c.expectedCashUSD || c.countedCashUSD) ? (
          <>
            <div className="flex justify-between pt-2"><dt className="text-fg-2">{t('dlg.expected_usd')}</dt><dd className="num">${fmtUSD(c.expectedCashUSD ?? 0)}</dd></div>
            <div className="flex justify-between"><dt className="text-fg-2">{t('dlg.counted_usd')}</dt><dd className="num">${fmtUSD(c.countedCashUSD ?? 0)}</dd></div>
            <div className={cn('flex justify-between border-t border-line pt-2 font-semibold', (c.varianceUSD ?? 0) < 0 ? 'text-danger' : '')}><dt>{t('dlg.variance_usd')}</dt><dd className="num">{(c.varianceUSD ?? 0) > 0 ? '+' : (c.varianceUSD ?? 0) < 0 ? '−' : ''}${fmtUSD(Math.abs(c.varianceUSD ?? 0))}</dd></div>
          </>
        ) : null}
        <div className="flex justify-between text-fg-2"><dt>{t('dlg.visits')} · {t('dlg.units_sold')}</dt><dd className="num">{c.visits} · {c.vanUnits}</dd></div>
      </dl>
      {c.note && <p className="mt-3 rounded-xl bg-surface-2 p-3 text-sm">{c.note}</p>}
      <Field label={t('dlg.review_note')} hint={t('dlg.review_note_hint')} className="mt-4">{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
    </Modal>
  )
}

/* ───────── live location ───────── */

const MIN = 60_000
/** "just now" / "12 min ago" / "3 h ago" / "2 d ago". */
function ago(at: number, t: (k: string, v?: Record<string, string | number>) => string) {
  const d = Date.now() - at
  if (d < 2 * MIN) return t('dlg.ago_now')
  if (d < 60 * MIN) return t('dlg.ago_min', { n: Math.round(d / MIN) })
  if (d < 48 * 60 * MIN) return t('dlg.ago_h', { n: Math.round(d / (60 * MIN)) })
  return t('dlg.ago_d', { n: Math.round(d / (24 * 60 * MIN)) })
}
/** green = seen in the last 10 minutes, amber = within the hour, grey = older */
const freshness = (at: number) => (Date.now() - at < 10 * MIN ? 'bg-success' : Date.now() - at < 60 * MIN ? 'bg-warning' : 'bg-fg-2/40')
const mapsLink = (p: { lat: number; lng: number }) => `https://www.google.com/maps?q=${p.lat},${p.lng}`
/** Google Maps directions through up to 10 points of the day, in order — the route the delegate took. */
function routeLink(points: LocationPoint[]) {
  const n = Math.min(10, points.length)
  const pick = Array.from({ length: n }, (_, i) => points[Math.round((i * (points.length - 1)) / Math.max(1, n - 1))])
  return `https://www.google.com/maps/dir/${pick.map((p) => `${p.lat},${p.lng}`).join('/')}`
}
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

function LastSeen({ p, className }: { p: LocationPoint | null; className?: string }) {
  const t = useT()
  return (
    <p className={cn('flex items-center gap-1.5 text-xs text-fg-2', className)}>
      <span className={cn('size-2 shrink-0 rounded-full', p ? freshness(p.at) : 'bg-fg-2/30')} aria-hidden />
      {p ? t('dlg.last_seen', { ago: ago(p.at, t) }) : t('dlg.never_seen')}
    </p>
  )
}

function LocationTab({ d }: { d: DelegateRow }) {
  const t = useT()
  const [day, setDay] = useState(today())
  // refreshes by itself: the owner can leave this open and watch
  const q = useQuery({ queryKey: ['delegates', d.id, 'locations', day], queryFn: () => locationsOf(d.id, day), refetchInterval: 30_000 })
  const last = q.data?.last ?? d.lastLocation
  const points = q.data?.points ?? []
  const pad = 0.006
  return (
    <div className="space-y-3">
      <Card className="space-y-3">
        {last ? (
          <>
            <iframe title={t('dlg.tab_location')} referrerPolicy="no-referrer"
              className="h-72 w-full rounded-xl border border-line bg-surface-2 sm:h-96"
              src={`https://www.openstreetmap.org/export/embed.html?bbox=${last.lng - pad}%2C${last.lat - pad}%2C${last.lng + pad}%2C${last.lat + pad}&layer=mapnik&marker=${last.lat}%2C${last.lng}`} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <LastSeen p={last} className="text-sm" />
                <p className="num mt-0.5 text-xs text-fg-2">{new Date(last.at).toLocaleString()}{last.accuracyM != null && ` · ${t('dlg.accuracy', { m: last.accuracyM })}`}</p>
              </div>
              <a className="inline-flex items-center gap-1.5 rounded-xl bg-gold px-3 py-2 text-sm font-semibold text-ink" target="_blank" rel="noopener noreferrer" href={mapsLink(last)}>
                <Navigation className="size-4" />{t('dlg.open_maps')}
              </a>
            </div>
          </>
        ) : <p className="text-sm text-fg-2">{t('dlg.never_seen')}</p>}
        <p className="text-xs text-fg-2">{t('dlg.loc_hint')}</p>
      </Card>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Field label={t('dlg.route_day')}>{(id) => <Input id={id} type="date" className="num !w-44" value={day} max={today()} onChange={(e) => e.target.value && setDay(e.target.value)} />}</Field>
          {points.length >= 2 && (
            <a className="inline-flex items-center gap-1.5 text-sm font-semibold text-gold-text underline" target="_blank" rel="noopener noreferrer" href={routeLink(points)}>
              <Route className="size-4" />{t('dlg.route')}
            </a>
          )}
        </div>
        {q.isLoading ? <Spinner /> : !points.length ? <p className="text-sm text-fg-2">{t('dlg.no_points')}</p> : (
          <>
            <p className="text-xs text-fg-2">{t('dlg.points', { n: points.length })}</p>
            <ul className="max-h-80 divide-y divide-line overflow-y-auto">
              {[...points].reverse().slice(0, 200).map((p) => (
                <li key={p.at} className="flex items-center gap-3 py-2 text-sm">
                  <MapPin className="size-4 shrink-0 text-gold-text" />
                  <span className="num">{new Date(p.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  {p.accuracyM != null && <span className="num text-xs text-fg-2">{t('dlg.accuracy', { m: p.accuracyM })}</span>}
                  <a className="ms-auto inline-flex items-center gap-1 text-xs font-semibold text-gold-text underline" target="_blank" rel="noopener noreferrer" href={mapsLink(p)}>{t('dlg.map')}<ExternalLink className="size-3" /></a>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  )
}

function VisitsTab({ d }: { d: DelegateRow }) {
  const t = useT()
  const visits = useQuery({ queryKey: ['delegates', d.id, 'visits'], queryFn: () => visitsOf(d.id) })
  if (visits.isLoading) return <Spinner />
  if (!visits.data?.length) return <Card><p className="text-sm text-fg-2">{t('dlg.no_visits')}</p></Card>
  return (
    <Card className="divide-y divide-line !p-0">
      {visits.data.map((v) => (
        <div key={v.id} className="flex items-center gap-3 p-3 text-sm">
          <MapPin className="size-5 shrink-0 text-gold-text" />
          <div className="min-w-0 flex-1"><p className="truncate font-medium">{v.customerName || t('dlg.no_customer')}</p><p className="text-xs text-fg-2">{new Date(v.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{v.note ? ` · ${v.note}` : ''}</p></div>
          <Badge>{t(`dl.outcome_${v.outcome === 'sale' || v.outcome === 'collection' ? 'visit' : v.outcome}`)}</Badge>
          {v.lat != null && v.lng != null && <a className="text-xs font-semibold text-gold-text underline" target="_blank" rel="noopener noreferrer" href={`https://www.google.com/maps?q=${v.lat},${v.lng}`}>{t('dlg.map')}</a>}
        </div>
      ))}
    </Card>
  )
}
