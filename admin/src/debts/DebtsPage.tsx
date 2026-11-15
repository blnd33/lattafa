import { useMemo, useState, type ReactNode } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowDownLeft, ArrowUpRight, BarChart3, ClipboardList, HandCoins, RefreshCw, Scale, Users } from 'lucide-react'
import { RequireAny } from '@/features/NoAccess'
import { CustomerDetail, CustomerForm } from '@/features/customers/CustomersPage'
import { Amt, UsdAmt } from '@/components/ui/Amt'
import { IconButton } from '@/components/ui/Button'
import { Badge, Card, EmptyState, PageHeader, Segmented, Spinner } from '@/components/ui/Controls'
import { SearchInput } from '@/components/ui/Field'
import { cn } from '@/components/ui/cn'
import type { Customer } from '@/data/types'
import { useCustomers } from '@/hooks/queries'
import { useCan } from '@/hooks/useAuth'
import { errorMessage, isRtl, useT } from '@/i18n'
import { fmtDate, fmtDateTime, fmtTime } from '@/lib/date'
import { fmt } from '@/lib/money'
import { useUI } from '@/store/ui'
import { compact, dayDate, dayMonth, plural, weekday } from '../lib'
import { Money } from '../money'
import { SupplierDetail } from '../purchasing/Suppliers'
import { AGES, DEBT_PERIODS, getDebts, type Aging, type DebtMove, type DebtPeriod, type Debts } from './api'

type Tab = 'customers' | 'suppliers' | 'activity'

/** Admin panel → Debts: who owes the shop, whom the shop owes, and every movement of both — apart from the sales. */
export function DebtsPage() {
  return <RequireAny perms={['customers.view', 'purchasing.view']}><DebtsScreen /></RequireAny>
}

function DebtsScreen() {
  const t = useT()
  const [period, setPeriod] = useState<DebtPeriod>('month')
  const q = useQuery({ queryKey: ['debts', period], queryFn: () => getDebts(period), refetchInterval: 60_000, placeholderData: keepPreviousData })
  const d = q.data
  return (
    <div className="mx-auto max-w-[1400px] space-y-4 p-4 md:p-6">
      <PageHeader className="mb-0" title={t('debt.title')} subtitle={t('debt.subtitle')}
        actions={(
          <div className="flex max-w-full flex-wrap items-center gap-2">
            {d && <span className="text-xs text-fg-2">{t('ap.updated', { time: fmtTime(q.dataUpdatedAt) })}</span>}
            <IconButton label={t('ap.refresh')} onClick={() => void q.refetch()} disabled={q.isFetching}><RefreshCw className={cn('size-5', q.isFetching && 'animate-spin')} /></IconButton>
            <Segmented ariaLabel={t('ap.period')} value={period} onChange={setPeriod} options={DEBT_PERIODS.map((p) => ({ value: p, label: t(`debt.period_${p}`) }))} />
          </div>
        )} />
      {q.isLoading ? (
        <div className="grid h-80 place-items-center"><Spinner className="size-10" /></div>
      ) : q.isError || !d ? (
        <Card><EmptyState title={errorMessage(q.error, t)} action={<button type="button" className="font-semibold text-gold-text underline" onClick={() => void q.refetch()}>{t('ap.retry')}</button>} /></Card>
      ) : (
        <Body d={d} />
      )}
    </div>
  )
}

function Body({ d }: { d: Debts }) {
  const t = useT()
  const [tab, setTab] = useState<Tab>(d.receivable ? 'customers' : 'suppliers')
  const r = d.receivable
  const p = d.payable
  const tabs: { value: Tab; label: string }[] = [
    ...(r ? [{ value: 'customers' as const, label: t('debt.tab_customers') }] : []),
    ...(p ? [{ value: 'suppliers' as const, label: t('debt.tab_suppliers') }] : []),
    { value: 'activity', label: t('debt.tab_activity') },
  ]
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {r && (
          <Tile dark icon={<ArrowDownLeft className="size-5" />} label={t('debt.owed_to_us')} value={<Amt n={r.totalIQD} />}
            sub={[plural(t, r.customers, 'ap.debts_1', 'ap.debts_n'), r.overLimit > 0 ? t('debt.over_limit_n', { n: r.overLimit }) : null].filter(Boolean).join(' · ')} />
        )}
        {p && (
          <Tile icon={<ArrowUpRight className="size-5 text-danger" />} label={t('debt.we_owe')}
            value={p.owedUSD > 0 ? <UsdAmt n={p.owedUSD} /> : <Amt n={p.owedIQD} />}
            sub={[
              p.owedUSD > 0 && p.owedIQD > 0 ? `+ ${fmt(p.owedIQD)} ${t('unit.iqd')}` : null,
              p.owedUSD > 0 ? t('ap.sup_total', { amount: fmt(p.totalIQD) }) : null,
              plural(t, p.suppliers, 'ap.sup_1', 'ap.sup_n'),
            ].filter(Boolean).join(' · ')} />
        )}
        {r && (
          <Tile icon={<HandCoins className="size-5 text-gold-text" />} label={t(`debt.given_${d.period}`)} value={<Amt n={r.givenIQD} />}
            sub={[t('debt.collected_amt', { amount: fmt(r.collectedIQD) }), r.returnedIQD > 0 ? t('debt.returned_amt', { amount: fmt(r.returnedIQD) }) : null].filter(Boolean).join(' · ')} />
        )}
        {p && (
          <Tile icon={<ClipboardList className="size-5 text-gold-text" />} label={t(`debt.bought_${d.period}`)} value={<Amt n={p.boughtIQD} />}
            sub={t('debt.paid_amt', { amount: fmt(p.paidIQD) })} />
        )}
      </div>

      {d.netIQD !== null && (
        <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border px-4 py-3 text-sm', d.netIQD >= 0 ? 'border-ok-bg bg-ok-bg text-ok-fg' : 'border-danger-bg bg-danger-bg text-danger-fg')}>
          <Scale className="size-5 shrink-0" />
          <span className="font-semibold">{t('debt.net')}</span>
          <Amt n={Math.abs(d.netIQD)} className="font-serif text-lg font-semibold" />
          <span className="min-w-0 basis-full text-xs sm:basis-auto">{t(d.netIQD >= 0 ? 'debt.net_plus' : 'debt.net_minus')}</span>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="min-w-0 xl:col-span-2">
          <DebtChart d={d} />
        </Card>
        {r ? <AgingCard aging={r.aging} total={r.totalIQD} /> : <ReportsCard />}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented ariaLabel={t('debt.title')} value={tab} onChange={setTab} options={tabs} />
        <Link to="/reports" className="inline-flex h-10 items-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-gold-text hover:underline"><BarChart3 className="size-4" />{t('debt.open_reports')}</Link>
      </div>
      {tab === 'customers' && r && <Debtors rows={r.rows} />}
      {tab === 'suppliers' && p && <Creditors rows={p.rows} />}
      {tab === 'activity' && <Activity rows={d.activity} />}
    </>
  )
}

function Tile({ label, value, sub, icon, dark }: { label: string; value: ReactNode; sub?: string; icon?: ReactNode; dark?: boolean }) {
  return (
    <div className={cn('min-w-0 rounded-2xl border p-4 shadow-soft sm:p-5', dark ? 'border-ink bg-gradient-to-br from-charcoal to-ink text-[#f6f0e4]' : 'border-line bg-surface')}>
      <div className={cn('flex items-start gap-2 text-sm', dark ? 'text-[#cfc5b4]' : 'text-fg-2')}><span className="mt-0.5 shrink-0">{icon}</span><span className="min-w-0">{label}</span></div>
      <div className={cn('mt-1.5 break-words font-serif text-2xl font-semibold leading-tight sm:text-3xl', dark && 'text-gold')}>{value}</div>
      {sub && <div className={cn('mt-1 text-xs', dark ? 'text-[#b9ae9c]' : 'text-fg-2')}>{sub}</div>}
    </div>
  )
}

const AGE_BG: Record<keyof Aging, string> = { age0: 'bg-gold-light', age31: 'bg-gold', age61: 'bg-warning', age91: 'bg-danger' }

/** How old what customers owe is: the longer it waits, the less likely it comes back. */
function AgingCard({ aging, total }: { aging: Aging; total: number }) {
  const t = useT()
  return (
    <Card className="min-w-0">
      <h2 className="mb-1 font-semibold">{t('debt.aging_title')}</h2>
      <p className="mb-3 text-xs text-fg-2">{t('debt.aging_hint')}</p>
      <div className="mb-4 flex h-3 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={AGES.map((a) => `${t(`rc.${a}`)}: ${fmt(aging[a])}`).join(', ')}>
        {total > 0 && AGES.map((a) => aging[a] > 0 && <div key={a} className={AGE_BG[a]} style={{ width: `${(aging[a] / total) * 100}%` }} />)}
      </div>
      <ul className="space-y-2.5">
        {AGES.map((a) => (
          <li key={a} className="flex items-center gap-2.5 text-sm">
            <span className={cn('size-3 shrink-0 rounded-full', AGE_BG[a])} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{t(`rc.${a}`)}</span>
            <Amt n={aging[a]} className={cn('font-semibold', a === 'age91' && aging[a] > 0 && 'text-danger')} />
          </li>
        ))}
      </ul>
    </Card>
  )
}

function ReportsCard() {
  const t = useT()
  return (
    <Card className="flex min-w-0 flex-col items-start justify-center gap-3">
      <BarChart3 className="size-8 text-gold-text" />
      <p className="text-sm text-fg-2">{t('debt.reports_hint')}</p>
      <Link to="/reports" className="font-semibold text-gold-text hover:underline">{t('debt.open_reports')}</Link>
    </Card>
  )
}

/** A round number at or above `n` for the top of the axis. */
function niceCeil(n: number): number {
  if (n <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(n))
  return ([1, 2, 2.5, 5, 10].find((m) => m * p >= n) ?? 10) * p
}

/** Debt added and paid down over the window, side by side for each hour or day. */
function DebtChart({ d }: { d: Debts }) {
  const t = useT()
  const lang = useUI((s) => s.lang)
  const [side, setSide] = useState<'customer' | 'supplier'>(d.receivable ? 'customer' : 'supplier')
  const both = !!d.receivable && !!d.payable
  const up = side === 'customer' ? 'givenIQD' : 'boughtIQD'
  const down = side === 'customer' ? 'collectedIQD' : 'paidIQD'
  const points = useMemo(() => {
    if (d.series.unit !== 'hour') return d.series.points
    const first = d.series.points.findIndex((p) => p[up] + p[down] > 0)
    return d.series.points.slice(Math.min(first === -1 ? 8 : first, 8))
  }, [d.series, up, down])
  const label = (key: string) => (d.series.unit === 'hour' ? `${key}:00` : points.length <= 7 ? weekday(dayDate(key), lang) : dayMonth(dayDate(key), lang))
  const max = niceCeil(Math.max(0, ...points.flatMap((p) => [p[up], p[down]])))
  const H = 220, top = 12, base = 184, axis = 46
  const slot = points.length > 45 ? 16 : points.length > 14 ? 26 : points.length > 8 ? 40 : 64
  const W = axis + points.length * slot + 8
  const rtl = isRtl(lang)
  const plotStart = rtl ? 8 : axis
  const plotEnd = rtl ? W - axis : W - 8
  const slotX = (i: number) => (rtl ? plotEnd - (i + 1) * slot : plotStart + i * slot)
  const barW = Math.max(3, Math.min(14, slot * 0.34))
  const y = (v: number) => base - (v / max) * (base - top)
  const every = points.length > 45 ? 10 : points.length > 20 ? 5 : points.length > 14 ? 2 : 1
  const any = points.some((p) => p[up] + p[down] > 0)
  const upLabel = t(side === 'customer' ? 'debt.legend_given' : 'debt.legend_bought')
  const downLabel = t(side === 'customer' ? 'debt.legend_collected' : 'debt.legend_paid')
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{t('debt.chart_title')}</h2>
        {both && <Segmented size="sm" ariaLabel={t('debt.chart_title')} value={side} onChange={setSide} options={[{ value: 'customer', label: t('debt.tab_customers') }, { value: 'supplier', label: t('debt.tab_suppliers') }]} />}
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-2">
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-danger" />{upLabel}</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-success" />{downLabel}</span>
      </div>
      {!any ? <EmptyState title={t('debt.no_moves')} className="py-14" /> : (
        <div className="-mx-1 overflow-x-auto px-1 scroll-hide">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-56 w-full" style={{ minWidth: Math.min(W, 560) }} role="img" aria-label={t('debt.chart_title')}>
            {[0, 0.25, 0.5, 0.75, 1].map((f) => (
              <g key={f}>
                <line x1={plotStart} x2={plotEnd} y1={y(max * f)} y2={y(max * f)} className="stroke-line" strokeDasharray={f === 0 ? undefined : '3 4'} />
                <text x={rtl ? plotEnd + 8 : plotStart - 8} y={y(max * f) + 3.5} textAnchor={rtl ? 'start' : 'end'} direction="ltr" className="num fill-fg-2 text-[10px]">{compact(max * f)}</text>
              </g>
            ))}
            {points.map((p, i) => {
              const cx = slotX(i) + slot / 2
              const hu = base - y(p[up])
              const hd = base - y(p[down])
              const first = rtl ? cx : cx - barW - 1
              const second = rtl ? cx - barW - 1 : cx + 1
              return (
                <g key={p.key}>
                  <title>{`${label(p.key)} — ${upLabel}: ${fmt(p[up])} · ${downLabel}: ${fmt(p[down])} ${t('unit.iqd')}`}</title>
                  <rect x={slotX(i)} y={top} width={slot} height={base - top} fill="transparent" />
                  {hu > 0 && <rect x={first} y={base - hu} width={barW} height={hu} rx={Math.min(3, barW / 2)} className="fill-danger" />}
                  {hd > 0 && <rect x={second} y={base - hd} width={barW} height={hd} rx={Math.min(3, barW / 2)} className="fill-success" />}
                  {(i % every === 0 || i === points.length - 1) && <text x={cx} y={base + 18} textAnchor="middle" className="num fill-fg-2 text-[10px]">{label(p.key)}</text>}
                </g>
              )
            })}
          </svg>
        </div>
      )}
    </>
  )
}

/** Everyone who owes the shop; a tap opens their account to collect a payment. */
function Debtors({ rows }: { rows: NonNullable<Debts['receivable']>['rows'] }) {
  const t = useT()
  const [q, setQ] = useState('')
  const [age, setAge] = useState<'all' | 'late'>('all')
  const [openId, setOpenId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Customer | null>(null)
  const customers = useCustomers()
  const open = customers.data?.find((c) => c.id === openId) ?? null
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return rows.filter((r) => (age === 'all' || r.age61 + r.age91 > 0) && (!s || r.name.toLowerCase().includes(s) || r.phone.replace(/\s/g, '').includes(s.replace(/\s/g, ''))))
  }, [rows, q, age])
  return (
    <Card pad={false} className="min-w-0">
      <div className="grid grid-cols-1 gap-2.5 border-b border-line p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:p-4 [&>*]:min-w-0">
        <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('cust.search')} />
        <Segmented ariaLabel={t('debt.aging_title')} value={age} onChange={setAge} options={[{ value: 'all', label: t('common.all') }, { value: 'late', label: t('debt.late') }]} />
      </div>
      {!rows.length ? <EmptyState title={t('ap.debts_none')} className="py-12" /> : !list.length ? <EmptyState title={t('debt.no_match')} className="py-12" /> : (
        <ul className="divide-y divide-line">
          {list.map((r) => {
            const over = r.creditLimitIQD > 0 && r.balanceIQD > r.creditLimitIQD
            return (
              <li key={r.id}>
                <button type="button" onClick={() => setOpenId(r.id)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3 text-start transition hover:bg-surface-2/60 active:bg-surface-2 sm:px-4">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-danger-bg text-danger-fg"><Users className="size-5" /></span>
                  <span className="min-w-0 flex-1 basis-40">
                    <span className="flex flex-wrap items-center gap-1.5"><span className="truncate font-semibold">{r.name}</span>{over && <Badge tone="danger">{t('debt.over_limit')}</Badge>}</span>
                    <span className="block truncate text-xs text-fg-2">
                      <span dir="ltr" className="num">{r.phone || '—'}</span>
                      {' · '}{r.lastPaymentAt ? t('debt.last_paid', { date: fmtDate(r.lastPaymentAt) }) : t('debt.never_paid')}
                    </span>
                  </span>
                  <span className="ms-auto flex flex-col items-end gap-1">
                    <Amt n={r.balanceIQD} className="font-semibold text-danger" />
                    <span className="text-xs text-fg-2">{r.oldestDays === null ? t('debt.oldest_opening') : r.oldestDays === 0 ? t('debt.oldest_today') : t('debt.oldest_days', { n: r.oldestDays })}</span>
                  </span>
                  <AgeBar r={r} total={r.balanceIQD} />
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <CustomerDetail customer={open} onClose={() => setOpenId(null)} onEdit={(c) => { setOpenId(null); setEditing(c) }} />
      <CustomerForm value={editing} onClose={() => setEditing(null)} />
    </Card>
  )
}

function AgeBar({ r, total }: { r: Aging; total: number }) {
  if (!total) return null
  return (
    <span className="flex h-1.5 w-full basis-full overflow-hidden rounded-full bg-surface-2" aria-hidden>
      {AGES.map((a) => r[a] > 0 && <span key={a} className={AGE_BG[a]} style={{ width: `${(r[a] / total) * 100}%` }} />)}
    </span>
  )
}

/** Every supplier the shop still owes; a tap opens their statement to record a payment. */
function Creditors({ rows }: { rows: NonNullable<Debts['payable']>['rows'] }) {
  const t = useT()
  const [openId, setOpenId] = useState<string | null>(null)
  const canBuy = useCan('purchasing.view')
  return (
    <Card pad={false} className="min-w-0">
      {!rows.length ? <EmptyState title={t('ap.sup_none')} className="py-12" /> : (
        <ul className="divide-y divide-line">
          {rows.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => setOpenId(s.id)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-3 text-start transition hover:bg-surface-2/60 active:bg-surface-2 sm:px-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-gold-soft text-gold-text dark:bg-gold/15"><ClipboardList className="size-5" /></span>
                <span className="min-w-0 flex-1 basis-40">
                  <span className="flex items-center gap-1.5"><span className="truncate font-semibold">{s.name}</span><Badge>{s.currency}</Badge></span>
                  <span className="block truncate text-xs text-fg-2">
                    {t('debt.received_paid', { received: fmt(s.received), paid: fmt(s.paid) })}
                    {' · '}{s.lastPaymentAt ? t('debt.last_paid', { date: fmtDate(s.lastPaymentAt) }) : t('debt.never_paid')}
                  </span>
                </span>
                <span className="ms-auto text-end">
                  <Money v={s.balance} currency={s.currency} className="font-semibold text-danger" />
                  {s.currency === 'USD' && <span className="block text-xs text-fg-2">≈ <Amt n={s.balanceIQD} /></span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {canBuy && openId && <SupplierDetail id={openId} onClose={() => setOpenId(null)} />}
    </Card>
  )
}

const MOVE_ICON: Record<DebtMove['kind'], string> = {
  debt_sale: 'bg-danger-bg text-danger-fg', purchase: 'bg-danger-bg text-danger-fg',
  collection: 'bg-ok-bg text-ok-fg', debt_return: 'bg-ok-bg text-ok-fg', supplier_payment: 'bg-ok-bg text-ok-fg',
}

/** The latest movements of both sides, newest first. */
function Activity({ rows }: { rows: DebtMove[] }) {
  const t = useT()
  return (
    <Card pad={false} className="min-w-0">
      {!rows.length ? <EmptyState title={t('debt.no_moves')} className="py-12" /> : (
        <ul className="divide-y divide-line">
          {rows.map((m) => (
            <li key={`${m.kind}-${m.id}`} className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
              <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg', MOVE_ICON[m.kind])}>
                {m.sign > 0 ? <ArrowUpRight className="size-4" /> : <ArrowDownLeft className="size-4" />}
              </span>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-sm font-medium">{t(`debt.kind_${m.kind}`)} · {m.party || '—'}</span>
                <span className="block truncate text-xs text-fg-2">
                  <span className="num">{fmtDateTime(m.at)}</span>{m.ref ? <> · <span className="num">{m.ref}</span></> : null}{m.by ? ` · ${m.by}` : ''}{m.note ? ` · ${m.note}` : ''}
                </span>
              </span>
              <span className={cn('shrink-0 text-end text-sm font-semibold', m.sign > 0 ? 'text-danger' : 'text-success')}>
                <span aria-hidden>{m.sign > 0 ? '+' : '−'}</span><Money v={m.amount} currency={m.currency} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
