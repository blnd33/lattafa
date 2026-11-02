import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Phone, ShoppingBag, Store, WifiOff, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Badge, Chips, EmptyState, Spinner } from '@/components/ui/Controls'
import { Input } from '@/components/ui/Field'
import { cn } from '@/components/ui/cn'
import { errorMessage, pick, useT } from '@/i18n'
import { isAppError } from '@/services/context'
import { fmtDateTime } from '@/lib/date'
import { toast } from '@/store/toast'
import { useUI } from '@/store/ui'
import { acceptOrder, refuseOrder, useOrders, type ShopOrder } from '../orders'
import { TopBar } from '../ui'

type Filter = 'new' | 'accepted' | 'refused'

/** Orders shops sent from the menu: take one and go, or refuse it with a word about why. */
export function OrdersScreen() {
  const t = useT()
  const q = useOrders()
  const [f, setF] = useState<Filter>('new')
  const orders = (q.data?.orders ?? []).filter((o) => o.status === f)
  return (
    <>
      <TopBar title={t('dl.orders')} />
      <div className="space-y-3 p-4">
        <Chips value={f} onChange={setF} options={(['new', 'accepted', 'refused'] as Filter[]).map((x) => ({
          value: x, label: x === 'new' && q.data?.waiting ? `${t(`dl.ord_${x}`)} (${q.data.waiting})` : t(`dl.ord_${x}`),
        }))} />
        {q.isLoading ? <Spinner className="mx-auto mt-10 size-8" />
          : q.isError ? <p className="flex items-center justify-center gap-2 py-8 text-sm text-warn-fg"><WifiOff className="size-4" />{t('dl.orders_offline')}</p>
            : orders.length === 0 ? <EmptyState title={t(f === 'new' ? 'dl.no_orders' : 'dl.no_orders_here')} />
              : orders.map((o) => <OrderCard key={o.id} o={o} />)}
      </div>
    </>
  )
}

function OrderCard({ o }: { o: ShopOrder }) {
  const t = useT()
  const lang = useUI((s) => s.lang)
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [refusing, setRefusing] = useState(false)
  const [reason, setReason] = useState('')

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
      await qc.invalidateQueries()
    } catch (e) {
      // someone else took it: say who, and refresh so it leaves the waiting list
      if (isAppError(e) && e.code === 'order_taken') { toast.info(t('dl.order_taken', { name: String(e.params.by || '') })); await qc.invalidateQueries() } else toast.error(errorMessage(e, t))
    } finally { setBusy(false); setRefusing(false) }
  }

  return (
    <div className={cn('rounded-2xl border bg-surface p-4', o.status === 'new' ? 'border-gold' : 'border-line')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-semibold"><Store className="size-4 shrink-0 text-gold-text" />{o.shopName}</p>
          <a href={`tel:${o.phone}`} className="num mt-0.5 inline-flex items-center gap-1.5 text-sm text-fg-2 underline-offset-2 hover:underline" dir="ltr"><Phone className="size-3.5" />{o.phone}</a>
        </div>
        <div className="text-end">
          <Badge tone={o.status === 'new' ? 'gold' : o.status === 'accepted' ? 'ok' : 'neutral'}>#{o.number}</Badge>
          <p className="num mt-1 text-[11px] text-fg-2">{fmtDateTime(o.placedAt)}</p>
        </div>
      </div>

      {o.note && <p className="mt-2 rounded-xl bg-surface-2 px-3 py-2 text-sm">{o.note}</p>}

      <ul className="mt-3 space-y-1 text-sm">
        {o.items.map((it) => (
          <li key={it.variantId} className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate">{pick(it.name, lang)} <span className="num text-fg-2">{it.label}</span></span>
            <span className="num shrink-0 font-semibold">× {it.qty}</span>
          </li>
        ))}
      </ul>
      <p className="num mt-2 text-xs text-fg-2">{t('dl.ord_units', { n: o.units })}</p>

      {o.status === 'new' ? (
        refusing ? (
          <div className="mt-3 space-y-2">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('dl.ord_why_ph')} aria-label={t('dl.ord_why')} />
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setRefusing(false)}>{t('common.cancel')}</Button>
              <Button variant="danger" className="flex-1" loading={busy} onClick={() => void run(() => refuseOrder(o.id, reason))}>{t('dl.ord_refuse')}</Button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex gap-2">
            <Button variant="secondary" className="flex-1" icon={<X className="size-4" />} disabled={busy} onClick={() => setRefusing(true)}>{t('dl.ord_refuse')}</Button>
            <Button variant="primary" className="flex-1" icon={<Check className="size-4" />} loading={busy} onClick={() => void run(() => acceptOrder(o.id))}>{t('dl.ord_accept')}</Button>
          </div>
        )
      ) : (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-fg-2">
          <ShoppingBag className="size-3.5" />
          {t(o.status === 'accepted' ? 'dl.ord_taken_by' : 'dl.ord_refused_by', { name: o.handledByName || '—' })}
          {o.refuseReason && ` · ${o.refuseReason}`}
        </p>
      )}
    </div>
  )
}
