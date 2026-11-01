import { useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Plus } from 'lucide-react'
import { RequireAny } from '@/features/NoAccess'
import { Button } from '@/components/ui/Button'
import { Badge, Card, Chips, EmptyState, PageHeader, Spinner } from '@/components/ui/Controls'
import { cn } from '@/components/ui/cn'
import { useCan } from '@/hooks/useAuth'
import { useT } from '@/i18n'
import { fmtDate } from '@/lib/date'
import { Money } from '../money'
import { listOrders, type OrderFilter } from './api'
import { OrderDetail, STATUS_TONE } from './OrderDetail'
import { OrderEditor } from './OrderEditor'
import { SuppliersTab } from './Suppliers'

/** Admin panel → Purchasing: orders to suppliers (and receiving them), and the suppliers with what the shop owes. */
export function PurchasingPage() {
  return <RequireAny perms={['purchasing.view']}><Purchasing /></RequireAny>
}

function Purchasing() {
  const t = useT()
  const tabs = [{ to: '/purchasing', end: true, label: t('po.tab_orders') }, { to: '/purchasing/suppliers', end: false, label: t('po.tab_suppliers') }]
  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      <PageHeader title={t('po.title')} subtitle={t('po.subtitle')} />
      <nav className="mb-5 inline-flex max-w-full gap-1 overflow-x-auto rounded-xl bg-surface-2 p-1 scroll-hide" aria-label={t('po.title')}>
        {tabs.map((x) => (
          <NavLink key={x.to} to={x.to} end={x.end} className={({ isActive }) => cn('whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold transition', isActive ? 'bg-gold text-ink shadow-sm' : 'text-fg-2 hover:text-fg')}>{x.label}</NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<OrdersTab />} />
        <Route path="suppliers" element={<SuppliersTab />} />
        <Route path="*" element={<Navigate to="/purchasing" replace />} />
      </Routes>
    </div>
  )
}

function OrdersTab() {
  const t = useT()
  const canManage = useCan('purchasing.manage')
  const [filter, setFilter] = useState<OrderFilter>('waiting')
  const [open, setOpen] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const q = useQuery({ queryKey: ['po', 'list', filter], queryFn: () => listOrders(filter) })
  const rows = q.data ?? []
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Chips value={filter} onChange={setFilter} options={(['waiting', 'received', 'cancelled', 'all'] as OrderFilter[]).map((f) => ({ value: f, label: t(`po.filter_${f}`) }))} />
        {canManage && <Button variant="primary" icon={<Plus className="size-5" />} onClick={() => setCreating(true)}>{t('po.new')}</Button>}
      </div>
      {q.isLoading ? <div className="grid h-40 place-items-center"><Spinner /></div> : !rows.length ? <Card><EmptyState title={t('po.none')} /></Card> : (
        <ul className="space-y-2">
          {rows.map((o) => (
            <li key={o.id}>
              <button type="button" onClick={() => setOpen(o.id)} className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface p-4 text-start shadow-soft transition hover:border-gold">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="num font-semibold">{o.number}</span>
                    <Badge tone={STATUS_TONE[o.status]}>{t(`po.status_${o.status}`)}</Badge>
                    <span className="truncate text-sm">{o.supplier?.name}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-fg-2">
                    <span className="num">{t('po.ordered_on', { date: fmtDate(o.orderedAt) })}</span>
                    {o.expectedAt && (o.status === 'open' || o.status === 'partial') && <span className="num"> · {t('po.expected_on', { date: fmtDate(o.expectedAt) })}</span>}
                    <span> · {t('po.progress', { received: o.receivedUnits, units: o.units })}</span>
                  </div>
                  <div className="mt-2 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-gold" style={{ width: `${o.units ? (o.receivedUnits / o.units) * 100 : 0}%` }} /></div>
                </div>
                <Money v={o.total} currency={o.currency} className="font-semibold" />
                <ChevronRight className="size-5 shrink-0 text-fg-2 rtl:rotate-180" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && <OrderDetail id={open} onClose={() => setOpen(null)} />}
      {creating && <OrderEditor onClose={() => setCreating(false)} onSaved={(o) => setOpen(o.id)} />}
    </div>
  )
}
