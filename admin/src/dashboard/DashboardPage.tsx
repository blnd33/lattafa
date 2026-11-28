import { useState, type ReactNode } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowDownLeft, ArrowDownRight, ArrowUpRight, Check, CheckCircle2, ChevronRight, ClipboardCheck, HandCoins, PackageOpen, PackageX, Plus, RefreshCw, Truck, Wallet } from 'lucide-react'
import { RequireAny } from '@/features/NoAccess'
import { Amt, UsdAmt } from '@/components/ui/Amt'
import { ProductImage } from '@/components/ui/Brand'
import { Button, IconButton } from '@/components/ui/Button'
import { Modal, useConfirm } from '@/components/ui/Modal'
import { useAction } from '@/hooks/queries'
import { Avatar, Badge, Card, EmptyState, Segmented, Spinner } from '@/components/ui/Controls'
import { cn } from '@/components/ui/cn'
import { errorMessage, pick, useT } from '@/i18n'
import { fmtDate, fmtTime } from '@/lib/date'
import { fmt, fmtUSD } from '@/lib/money'
import { useCan } from '@/hooks/useAuth'
import { useSession } from '@/store/session'
import { useUI } from '@/store/ui'
import { ago, change, freshness, greeting, longDate, plural } from '../lib'
import { Money } from '../money'
import { getDashboard, receiveCash, type Dashboard, type Period, type WithDelegates } from './api'
import { DELEGATE_BG, SalesChart, SplitRing, STORE_BG } from './charts'

const FALLBACK_ART = { c1: '#E9CD8A', c2: '#B8892F', shape: 'rect' } as const

export function DashboardPage() {
  return <RequireAny perms={['reports.view']}><Overview /></RequireAny>
}

function Overview() {
  const t = useT()
  const lang = useUI((s) => s.lang)
  const actor = useSession((s) => s.actor)
  const [period, setPeriod] = useState<Period>('today')
  const q = useQuery({ queryKey: ['dashboard', period], queryFn: () => getDashboard(period), refetchInterval: 60_000, placeholderData: keepPreviousData })
  const d = q.data
  const today = longDate(new Date(), lang)

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-serif text-2xl font-semibold leading-tight sm:text-3xl">{greeting(t, actor?.name ?? '')}</h1>
          <p className="mt-1 text-sm text-fg-2">{today}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {d && <span className="text-xs text-fg-2">{t('ap.updated', { time: fmtTime(q.dataUpdatedAt) })}</span>}
          <IconButton label={t('ap.refresh')} onClick={() => void q.refetch()} disabled={q.isFetching}><RefreshCw className={cn('size-5', q.isFetching && 'animate-spin')} /></IconButton>
          <Segmented ariaLabel={t('ap.period')} value={period} onChange={setPeriod} options={(['today', 'week', 'month'] as Period[]).map((p) => ({ value: p, label: t(`ap.period_${p}`) }))} />
        </div>
      </div>

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

function Body({ d }: { d: Dashboard }) {
  const t = useT()
  const vs = t(`ap.vs_${d.period}`)
  const margin = d.totals.profitIQD !== null && d.totals.netIQD > 0 ? Math.round((d.totals.profitIQD / d.totals.netIQD) * 100) : null
  const [cashOpen, setCashOpen] = useState(false)
  const wd = d.withDelegates
  return (
    <>
      {/* the tiles wrap to fit any screen: one per row on a phone, up to five side by side on a wide one */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-4">
        {/* the headline is money that came in; what was sold on debt counts only once it is collected */}
        <Kpi dark label={t('ap.kpi_received')} value={<Amt n={d.totals.receivedIQD} />} delta={change(d.totals.receivedIQD, d.previous.receivedIQD ?? 0)} vs={vs}
          sub={[t('ap.sold_not_paid', { sold: fmt(d.totals.revenueIQD), due: fmt(d.totals.creditIQD) }),
            d.totals.collectedIQD > 0 ? t('ap.received_debts', { amount: fmt(d.totals.collectedIQD) }) : null,
            d.totals.refundsIQD > 0 ? t('ap.refunded', { amount: fmt(d.totals.refundsIQD) }) : null].filter(Boolean).join(' · ')} />
        {d.debts ? (
          <Kpi label={t('ap.kpi_outstanding')} value={<Amt n={d.debts.totalIQD} className={d.debts.totalIQD > 0 ? 'text-danger' : undefined} />} to="/debts"
            sub={[t('ap.outstanding_new', { amount: fmt(d.totals.creditIQD) }), t('ap.debt_collected', { amount: fmt(d.totals.collectedIQD) })].join(' · ')} />
        ) : (
          <Kpi label={t('ap.kpi_debt')} value={<Amt n={d.totals.creditIQD} className={d.totals.creditIQD > 0 ? 'text-danger' : undefined} />} delta={change(d.totals.creditIQD, d.previous.creditIQD)} vs={vs} upIsBad
            sub={t('ap.debt_collected', { amount: fmt(d.totals.collectedIQD) })} />
        )}
        {wd && (
          <Kpi label={t('ap.kpi_with_delegates')} value={<Amt n={wd.totalIQD} className={wd.totalIQD > 0 ? 'text-warn-fg' : undefined} />} onClick={() => setCashOpen(true)}
            sub={wd.delegates.length ? [wd.cashUSD > 0 ? t('ap.wd_mix', { iqd: fmt(wd.cashIQD), usd: fmtUSD(wd.cashUSD) }) : null, t('ap.wd_sub')].filter(Boolean).join(' · ') : t('ap.wd_all_in')} />
        )}
        {d.financial && d.totals.profitIQD !== null && (
          <Kpi label={t('ap.kpi_profit')} value={<Amt n={d.totals.profitIQD} />} delta={change(d.totals.profitIQD, d.previous.profitIQD ?? 0)} vs={vs}
            sub={[margin !== null ? t('ap.margin', { pct: margin }) : null,
              d.totals.creditProfitIQD ? t('ap.profit_on_debt', { amount: fmt(d.totals.creditProfitIQD) }) : null,
              d.expensesIQD !== null ? t('ap.after_expenses', { amount: fmt(d.totals.profitIQD - d.expensesIQD) }) : null,
              d.totals.giftUnits ? t('ap.gifts_cost', { n: d.totals.giftUnits, amount: fmt(d.totals.giftsCostIQD ?? 0) }) : null].filter(Boolean).join(' · ') || undefined} />
        )}
        {d.expenses && (
          <Kpi label={t('ap.kpi_expenses')} value={<Amt n={d.expenses.totalIQD + d.expenses.delegateIQD} />} to="/expenses"
            sub={d.expenses.delegateIQD > 0 ? t('ap.exp_with_delegates', { amount: fmt(d.expenses.delegateIQD) }) : plural(t, d.expenses.count, 'ap.exp_1', 'ap.exp_n')} />
        )}
        <Kpi label={t('ap.kpi_bills')} value={<span className="num">{fmt(d.totals.count)}</span>} delta={change(d.totals.count, d.previous.count)} vs={vs}
          sub={t('ap.avg_bill', { amount: fmt(d.totals.avgBasketIQD) })} />
        <Kpi label={t('ap.kpi_units')} value={<span className="num">{fmt(d.totals.unitsSold)}</span>} sub={d.totals.giftUnits ? t('ap.gifts_given', { n: d.totals.giftUnits }) : undefined} />
      </div>
      {wd && <CashWithDelegates open={cashOpen} onClose={() => setCashOpen(false)} wd={wd} />}

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">{t('ap.chart_title')} <span className="text-sm font-normal text-fg-2">· {t(d.series.unit === 'hour' ? 'ap.chart_hours' : 'ap.chart_days')}</span></h2>
            <div className="flex items-center gap-4 text-xs text-fg-2">
              <span className="flex items-center gap-1.5"><span className={cn('size-2.5 rounded-full', STORE_BG)} />{t('ap.shop')}</span>
              <span className="flex items-center gap-1.5"><span className={cn('size-2.5 rounded-full', DELEGATE_BG)} />{t('ap.delegates')}</span>
            </div>
          </div>
          {d.totals.count === 0 ? <EmptyState title={t('ap.no_sales')} className="py-16" /> : <SalesChart series={d.series} />}
        </Card>
        <Card>
          <h2 className="mb-4 font-semibold">{t('ap.split_title')}</h2>
          <SplitRing channels={d.channels} />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <TopProducts d={d} />
        {d.delegates && <Delegates rows={d.delegates} />}
        <Attention d={d} />
        {d.lowStock && <LowStock low={d.lowStock} />}
        {(d.debts || d.suppliers) && <Debts debts={d.debts} suppliers={d.suppliers} />}
        {d.expenses && <Expenses e={d.expenses} period={d.period} />}
      </div>
    </>
  )
}

/** A card title with an optional "View all" link to the screen behind it. */
function CardHead({ title, icon, to, className }: { title: string; icon?: ReactNode; to?: string; className?: string }) {
  const t = useT()
  return (
    <div className={cn('flex items-center justify-between gap-2', className)}>
      <h2 className="flex items-center gap-2 font-semibold">{icon}{title}</h2>
      {to && <Link to={to} className="inline-flex shrink-0 items-center gap-0.5 text-xs font-semibold text-gold-text hover:underline">{t('ap.view_all')}<ChevronRight className="size-3.5 rtl:rotate-180" /></Link>}
    </div>
  )
}

/** One headline figure. `upIsBad`: a rise is shown in red (more sold on debt is not good news). `to`: the tile opens that screen; `onClick`: it opens a window. */
function Kpi({ label, value, delta, vs, sub, dark, upIsBad, to, onClick }: { label: string; value: ReactNode; delta?: number | null; vs?: string; sub?: string; dark?: boolean; upIsBad?: boolean; to?: string; onClick?: () => void }) {
  const t = useT()
  const up = (delta ?? 0) >= 0
  const good = upIsBad ? !up || delta === 0 : up
  const box = cn('block min-w-0 rounded-2xl border p-4 text-start shadow-soft sm:p-5', dark ? 'border-ink bg-gradient-to-br from-charcoal to-ink text-[#f6f0e4]' : 'border-line bg-surface', (to || onClick) && 'transition hover:border-gold')
  const body = (
    <>
      <div className={cn('flex items-center justify-between gap-2 text-sm', dark ? 'text-[#cfc5b4]' : 'text-fg-2')}>{label}{(to || onClick) && <ChevronRight className="size-4 shrink-0 opacity-60 rtl:rotate-180" />}</div>
      <div className={cn('mt-1.5 break-words font-serif text-2xl font-semibold leading-tight sm:text-3xl', dark && 'text-gold')}>{value}</div>
      {vs !== undefined && (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {delta === null || delta === undefined ? (
            <span className={dark ? 'text-[#b9ae9c]' : 'text-fg-2'}>{t('ap.vs_none')}</span>
          ) : (
            <>
              <span className={cn('num inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 font-semibold', good ? 'bg-ok-bg text-ok-fg' : 'bg-danger-bg text-danger-fg')}>
                {up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
                {Math.abs(delta) >= 1000 ? '999+' : Math.abs(Math.round(delta))}%
              </span>
              <span className={dark ? 'text-[#b9ae9c]' : 'text-fg-2'}>{vs}</span>
            </>
          )}
        </div>
      )}
      {sub && <div className={cn('mt-1 text-xs', dark ? 'text-[#b9ae9c]' : 'text-fg-2')}>{sub}</div>}
    </>
  )
  if (onClick) return <button type="button" onClick={onClick} className={cn(box, 'flex w-full flex-col justify-start')}>{body}</button>
  return to ? <Link to={to} className={box}>{body}</Link> : <div className={box}>{body}</div>
}

/**
 * The cash each delegate took (cash sales, debts they collected) that the shop has not received yet. "Received"
 * approves their open days, so it leaves this list.
 */
function CashWithDelegates({ open, onClose, wd }: { open: boolean; onClose: () => void; wd: WithDelegates }) {
  const t = useT()
  const confirm = useConfirm()
  const run = useAction(receiveCash, { success: 'ap.wd_received_ok' })
  const [busy, setBusy] = useState<string | null>(null)
  const amountOf = (r: WithDelegates['delegates'][number]) => [r.cashIQD ? `${fmt(r.cashIQD)} IQD` : null, r.cashUSD ? `$${fmtUSD(r.cashUSD)}` : null].filter(Boolean).join(' + ') || '0 IQD'
  const receive = async (r: WithDelegates['delegates'][number]) => {
    if (!(await confirm({ title: t('ap.wd_confirm_title', { name: r.name }), message: t('ap.wd_confirm_msg', { name: r.name, amount: amountOf(r) }), confirmLabel: t('ap.wd_received') }))) return
    setBusy(r.id)
    await run(r.id)
    setBusy(null)
  }
  return (
    <Modal open={open} onClose={onClose} title={t('ap.wd_title')} size="lg"
      footer={<div className="flex flex-wrap items-center justify-between gap-3"><span className="text-sm text-fg-2">{t('ap.wd_total')} <Amt n={wd.totalIQD} className="font-bold" /></span><Link to="/delegates" className="text-sm font-semibold text-gold-text underline">{t('ap.wd_open')}</Link></div>}>
      <div className="space-y-4">
        <p className="rounded-xl bg-surface-2 p-3 text-sm text-fg-2">{t('ap.wd_hint')}</p>
        {!wd.delegates.length ? <EmptyState title={t('ap.wd_none')} className="py-8" /> : (
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
            {wd.delegates.map((r) => {
              const since = fmtDate(new Date(`${r.oldestDay}T12:00:00`).getTime())
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-3 p-3 sm:p-4">
                  <Avatar name={r.name} color={r.color ?? '#D4A548'} size={40} />
                  <div className="min-w-0 flex-1 basis-40">
                    <p className="truncate font-semibold">{r.name}</p>
                    <p className="text-xs text-fg-2">{r.days === 1 ? t('ap.wd_day_1', { date: since }) : t('ap.wd_day_n', { n: r.days, date: since })}</p>
                  </div>
                  <div className="text-end">
                    <Amt n={r.cashIQD} className="font-semibold" />
                    {r.cashUSD > 0 && <div className="text-sm font-semibold"><UsdAmt n={r.cashUSD} /></div>}
                  </div>
                  <Button variant="primary" icon={<Check className="size-5" />} loading={busy === r.id} disabled={!!busy} onClick={() => void receive(r)}>{t('ap.wd_received')}</Button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Modal>
  )
}

function TopProducts({ d }: { d: Dashboard }) {
  const t = useT()
  const lang = useUI((s) => s.lang)
  const best = d.topProducts[0]?.revenueIQD ?? 0
  return (
    <Card>
      <CardHead title={t('ap.top_title')} to="/reports" className="mb-3" />
      {!d.topProducts.length ? <p className="py-6 text-center text-sm text-fg-2">{t('ap.no_sales')}</p> : (
        <ol className="space-y-3">
          {d.topProducts.map((p, i) => (
            <li key={p.productId} className="flex items-center gap-3">
              <span className="num w-4 shrink-0 text-center text-sm font-semibold text-gold-text">{i + 1}</span>
              <ProductImage product={{ image: p.image, art: p.art ?? FALLBACK_ART }} className="size-11 shrink-0 rounded-xl bg-surface-2" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium">{pick(p.name, lang) || '—'}</span>
                  <Amt n={p.revenueIQD} className="text-sm font-semibold" />
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-gold" style={{ width: `${best ? Math.max(4, (p.revenueIQD / best) * 100) : 0}%` }} /></div>
                  <span className="shrink-0 text-xs text-fg-2">{t('ap.sold_n', { n: p.units })}</span>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}

function Delegates({ rows }: { rows: NonNullable<Dashboard['delegates']> }) {
  const t = useT()
  return (
    <Card>
      <CardHead title={t('ap.leader_title')} icon={<Truck className="size-5 text-gold-text" />} to="/delegates" className="mb-3" />
      {!rows.length ? <p className="py-6 text-center text-sm text-fg-2">{t('ap.no_delegates')}</p> : (
        <ul className="divide-y divide-line">
          {rows.slice(0, 6).map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2.5">
              <span className="relative">
                <Avatar name={r.name} color={r.color} size={38} />
                <span className={cn('absolute -bottom-0.5 -end-0.5 size-3 rounded-full ring-2 ring-surface', freshness(r.lastSeenAt))} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{r.name}</div>
                <div className="truncate text-xs text-fg-2">{r.lastSeenAt ? t('dlg.last_seen', { ago: ago(r.lastSeenAt, t) }) : t('dlg.never_seen')}</div>
              </div>
              <div className="text-end">
                <Amt n={r.salesIQD} className="text-sm font-semibold" />
                <div className="text-xs text-fg-2">{r.collectedIQD > 0 ? t('ap.collected', { amount: fmt(r.collectedIQD) }) : plural(t, r.salesCount, 'ap.bill_1', 'ap.bills_n')}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function Attention({ d }: { d: Dashboard }) {
  const t = useT()
  const rows = [
    { n: d.attention.openRequests, label: t('ap.att_requests'), icon: Truck, to: '/delegates' },
    { n: d.attention.pendingClosings, label: t('ap.att_closings'), icon: ClipboardCheck, to: '/delegates' },
    { n: d.attention.salesToReview, label: t('ap.att_review'), icon: AlertTriangle, to: '/review' },
    { n: d.attention.ordersWaiting, label: t('ap.att_orders'), icon: PackageOpen, to: '/purchasing' },
  ].filter((r): r is { n: number; label: string; icon: typeof Truck; to: string } => r.n !== null)
  const waiting = rows.filter((r) => r.n > 0)
  return (
    <Card>
      <h2 className="mb-3 font-semibold">{t('ap.att_title')}</h2>
      {!waiting.length ? (
        <div className="flex items-center gap-3 rounded-xl bg-ok-bg px-4 py-4 text-sm text-ok-fg"><CheckCircle2 className="size-5 shrink-0" />{t('ap.att_none')}</div>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.label}>
              <Link to={r.to} className={cn('flex items-center gap-3 rounded-xl px-3 py-3 transition hover:brightness-95', r.n > 0 ? 'bg-warn-bg text-warn-fg' : 'bg-surface-2 text-fg-2')}>
                <r.icon className="size-5 shrink-0" />
                <span className="flex-1 text-sm">{r.label}</span>
                <span className="num text-lg font-semibold">{r.n}</span>
                <ChevronRight className="size-4 shrink-0 opacity-60 rtl:rotate-180" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function LowStock({ low }: { low: NonNullable<Dashboard['lowStock']> }) {
  const t = useT()
  const lang = useUI((s) => s.lang)
  return (
    <Card>
      <CardHead title={t('ap.low_title')} icon={<PackageX className="size-5 text-gold-text" />} to="/inventory" className="mb-1" />
      {!low.count ? <p className="py-6 text-center text-sm text-fg-2">{t('ap.low_none')}</p> : (
        <>
          <p className="mb-2 text-xs text-fg-2">{plural(t, low.count, 'ap.low_1', 'ap.low_count')}</p>
          <ul className="divide-y divide-line">
            {low.items.map((v) => (
              <li key={v.variantId} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{pick(v.name, lang)} <span className="text-fg-2">· {v.label}</span></div>
                  <div className="num text-xs text-fg-2">{v.sku}</div>
                </div>
                <Badge tone={v.qty <= 0 ? 'danger' : 'warn'}>{t('ap.left', { qty: v.qty, min: v.minStock })}</Badge>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  )
}

/** Debts both ways, apart from the sales: what customers owe the shop and what the shop owes its suppliers. */
function Debts({ debts, suppliers: s }: { debts: Dashboard['debts']; suppliers: Dashboard['suppliers'] }) {
  const t = useT()
  return (
    <Card className="min-w-0">
      <CardHead title={t('ap.debts_card')} icon={<HandCoins className="size-5 text-gold-text" />} to="/debts" className="mb-3" />
      {debts && (
        <section>
          <div className="flex flex-wrap items-baseline justify-between gap-x-2">
            <span className="flex items-center gap-1.5 text-sm text-fg-2"><ArrowDownLeft className="size-4 text-gold-text" />{t('ap.debts_title')}</span>
            {debts.customers > 0 && <span className="text-xs text-fg-2">{plural(t, debts.customers, 'ap.debts_1', 'ap.debts_n')}</span>}
          </div>
          {!debts.customers ? <p className="py-3 text-sm text-fg-2">{t('ap.debts_none')}</p> : (
            <>
              <Amt n={debts.totalIQD} className="font-serif text-2xl font-semibold text-danger" />
              <ul className="mt-1 divide-y divide-line">
                {debts.top.slice(0, 3).map((c) => (
                  <li key={c.id} className="flex items-center gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{c.name}</div>
                      {c.phone && <div dir="ltr" className="num text-start text-xs text-fg-2">{c.phone}</div>}
                    </div>
                    <Amt n={c.balanceIQD} className="text-sm font-semibold" />
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      {s && (
        <section className={cn(debts && 'mt-3 border-t border-line pt-3')}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-2">
            <span className="flex items-center gap-1.5 text-sm text-fg-2"><ArrowUpRight className="size-4 text-danger" />{t('ap.sup_title')}</span>
            {s.suppliers > 0 && <span className="text-xs text-fg-2">{plural(t, s.suppliers, 'ap.sup_1', 'ap.sup_n')}</span>}
          </div>
          {!s.suppliers ? <p className="py-3 text-sm text-fg-2">{t('ap.sup_none')}</p> : (
            <>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                {s.owedUSD > 0 && <UsdAmt n={s.owedUSD} className="font-serif text-2xl font-semibold text-danger" />}
                {s.owedIQD > 0 && <Amt n={s.owedIQD} className="font-serif text-2xl font-semibold text-danger" />}
              </div>
              {s.owedUSD > 0 && <p className="text-xs text-fg-2">{t('ap.sup_total', { amount: fmt(s.totalIQD) })}</p>}
              <ul className="mt-1 divide-y divide-line">
                {s.top.slice(0, 3).map((x) => (
                  <li key={x.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="truncate text-sm font-medium">{x.name}</span>
                    {x.currency === 'USD' ? <UsdAmt n={x.balance} className="text-sm font-semibold" /> : <Amt n={x.balance} className="text-sm font-semibold" />}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </Card>
  )
}

/** What running the shop cost in the period, the biggest categories, the latest entries — and a way to add one. */
function Expenses({ e, period }: { e: NonNullable<Dashboard['expenses']>; period: Period }) {
  const t = useT()
  const canAdd = useCan('expenses.manage')
  const top = e.byCategory[0]?.amountIQD ?? 0
  return (
    <Card className="flex min-w-0 flex-col">
      <CardHead title={t('ap.exp_title')} icon={<Wallet className="size-5 text-gold-text" />} to="/expenses" className="mb-3" />
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <span className="text-sm text-fg-2">{t(`ap.exp_spent_${period}`)}</span>
        <span className="text-xs text-fg-2">{plural(t, e.count, 'ap.exp_1', 'ap.exp_n')}</span>
      </div>
      <Amt n={e.totalIQD + e.delegateIQD} className="font-serif text-2xl font-semibold" />
      {e.delegateIQD > 0 && <p className="text-xs text-fg-2">{t('ap.exp_with_delegates', { amount: fmt(e.delegateIQD) })}</p>}
      {e.byCategory.length > 0 && (
        <ul className="mt-3 space-y-2">
          {e.byCategory.map((c) => (
            <li key={c.category}>
              <div className="flex items-baseline justify-between gap-2 text-sm"><span className="min-w-0 truncate">{t(`exp.cat_${c.category}`)}</span><Amt n={c.amountIQD} className="font-semibold" /></div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-gold" style={{ width: `${top ? Math.max(3, (c.amountIQD / top) * 100) : 0}%` }} /></div>
            </li>
          ))}
        </ul>
      )}
      <h3 className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-fg-2 rtl:tracking-normal">{t('ap.exp_latest')}</h3>
      {!e.recent.length ? <p className="py-2 text-sm text-fg-2">{t('exp.none')}</p> : (
        <ul className="divide-y divide-line">
          {e.recent.map((x) => (
            <li key={x.id} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{t(`exp.cat_${x.category}`)}{x.note ? <span className="font-normal text-fg-2"> · {x.note}</span> : null}</div>
                <div className="num text-xs text-fg-2">{fmtDate(x.spentAt)}</div>
              </div>
              <Money v={x.amount} currency={x.currency} className="shrink-0 text-sm font-semibold" />
            </li>
          ))}
        </ul>
      )}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <Link to="/expenses?view=all" className="min-w-0 text-xs text-fg-2 hover:text-fg">
          {t('ap.exp_all_time', { amount: fmt(e.allTimeIQD), n: e.allTimeCount })}
        </Link>
        {canAdd && (
          <Link to="/expenses?new=1" className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-gold px-3.5 text-sm font-semibold text-ink transition hover:brightness-105">
            <Plus className="size-4" />{t('exp.new')}
          </Link>
        )}
      </div>
    </Card>
  )
}
