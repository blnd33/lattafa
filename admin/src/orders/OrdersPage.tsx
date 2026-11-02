import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Phone, Store } from 'lucide-react'
import { Badge, Card, Chips, EmptyState, PageHeader, Spinner } from '@/components/ui/Controls'
import { cn } from '@/components/ui/cn'
import { pick, useT } from '@/i18n'
import { fmtDateTime } from '@/lib/date'
import { api } from '@/services/api'
import { useUI } from '@/store/ui'

interface OrderLine { variantId: string; name: Record<'en' | 'ar' | 'ku', string>; label: string; qty: number }
interface ShopOrder {
  id: string; number: number; shopName: string; phone: string; note: string; items: OrderLine[]; units: number
  status: 'new' | 'accepted' | 'refused'; handledByName: string; handledAt: number | null; refuseReason: string; placedAt: number
}
type Filter = 'new' | 'accepted' | 'refused'

/** Admin panel → Orders: everything shops sent from the customer menu, and which delegate took it. */
export function OrdersPage() {
  const t = useT()
  const lang = useUI((s) => s.lang)
  const [f, setF] = useState<Filter>('new')
  const q = useQuery({
    queryKey: ['orders', f],
    queryFn: () => api<{ orders: ShopOrder[]; waiting: number }>('GET', `/orders?status=${f}`),
    refetchInterval: 30_000,
  })
  const orders = q.data?.orders ?? []
  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6">
      <PageHeader title={t('ap.nav_orders')} subtitle={t('ap.orders_subtitle')} />
      <Chips className="mb-4" value={f} onChange={setF} options={(['new', 'accepted', 'refused'] as Filter[]).map((x) => ({
        value: x, label: x === 'new' && q.data?.waiting ? `${t(`dl.ord_${x}`)} (${q.data.waiting})` : t(`dl.ord_${x}`),
      }))} />
      {q.isLoading ? <div className="grid h-60 place-items-center"><Spinner className="size-9" /></div>
        : orders.length === 0 ? <Card><EmptyState title={t(f === 'new' ? 'dl.no_orders' : 'dl.no_orders_here')} /></Card>
          : (
            <ul className="space-y-3">
              {orders.map((o) => (
                <li key={o.id} className={cn('rounded-2xl border bg-surface p-4', o.status === 'new' ? 'border-gold' : 'border-line')}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 font-semibold"><Store className="size-4 shrink-0 text-gold-text" />{o.shopName}</p>
                      <p className="num mt-0.5 flex items-center gap-1.5 text-sm text-fg-2" dir="ltr"><Phone className="size-3.5" />{o.phone}</p>
                      {o.note && <p className="mt-2 rounded-xl bg-surface-2 px-3 py-1.5 text-sm">{o.note}</p>}
                    </div>
                    <div className="text-end">
                      <Badge tone={o.status === 'new' ? 'gold' : o.status === 'accepted' ? 'ok' : 'neutral'}>#{o.number}</Badge>
                      <p className="num mt-1 text-[11px] text-fg-2">{fmtDateTime(o.placedAt)}</p>
                    </div>
                  </div>
                  <ul className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
                    {o.items.map((it) => (
                      <li key={it.variantId} className="flex items-center justify-between gap-3 border-b border-line/60 py-1 last:border-0">
                        <span className="min-w-0 truncate">{pick(it.name, lang)} <span className="num text-fg-2">{it.label}</span></span>
                        <span className="num shrink-0 font-semibold">× {it.qty}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-fg-2">
                    <span className="num">{t('dl.ord_units', { n: o.units })}</span>
                    {o.status !== 'new' && ` · ${t(o.status === 'accepted' ? 'dl.ord_taken_by' : 'dl.ord_refused_by', { name: o.handledByName || '—' })}`}
                    {o.refuseReason && ` · ${o.refuseReason}`}
                  </p>
                </li>
              ))}
            </ul>
          )}
    </div>
  )
}
