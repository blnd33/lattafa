import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Ban, Banknote, PackageCheck, Pencil, PackageOpen } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Badge, Spinner } from '@/components/ui/Controls'
import { Field, Input } from '@/components/ui/Field'
import { Modal, useConfirm } from '@/components/ui/Modal'
import { useAction } from '@/hooks/queries'
import { useCan } from '@/hooks/useAuth'
import { pick, useT } from '@/i18n'
import { fmtDate, fmtDateTime } from '@/lib/date'
import { fmt } from '@/lib/money'
import { useUI } from '@/store/ui'
import { cents, fromCents, Money } from '../money'
import { cancelOrder, getOrder, receiveOrder, type OrderStatus, type PurchaseOrder } from './api'
import { OrderEditor } from './OrderEditor'
import { PaymentModal } from './Suppliers'

export const STATUS_TONE: Record<OrderStatus, 'gold' | 'warn' | 'ok' | 'neutral' | 'danger'> = { open: 'gold', partial: 'warn', received: 'ok', closed: 'neutral', cancelled: 'danger' }

export function OrderDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT()
  const lang = useUI((s) => s.lang)
  const confirm = useConfirm()
  const canManage = useCan('purchasing.manage')
  const canPay = useCan('purchasing.pay')
  const q = useQuery({ queryKey: ['po', id], queryFn: () => getOrder(id) })
  const [receiving, setReceiving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [paying, setPaying] = useState(false)
  const o = q.data
  const waiting = o?.status === 'open' || o?.status === 'partial'
  const cancel = useAction(cancelOrder, { success: o?.status === 'partial' ? 'po.closed_ok' : 'po.cancelled_ok' })
  const stop = async () => {
    if (!o) return
    const partial = o.status === 'partial'
    if (await confirm({ title: t(partial ? 'po.close' : 'po.cancel'), message: t(partial ? 'po.close_confirm' : 'po.cancel_confirm'), danger: true, confirmLabel: t(partial ? 'po.close' : 'po.cancel') })) await cancel(o.id)
  }
  return (
    <Modal open onClose={onClose} size="xl" title={o ? `${o.number} · ${o.supplier?.name ?? ''}` : t('po.title')}
      footer={o && (
        <div className="flex w-full flex-wrap justify-end gap-2">
          {canManage && waiting && <Button variant="secondary" className="text-danger" icon={<Ban className="size-5" />} onClick={stop}>{t(o.status === 'partial' ? 'po.close' : 'po.cancel')}</Button>}
          {canManage && o.status === 'open' && o.receivedUnits === 0 && <Button variant="secondary" icon={<Pencil className="size-5" />} onClick={() => setEditing(true)}>{t('po.edit')}</Button>}
          {canPay && o.supplier && o.status !== 'cancelled' && <Button variant="secondary" icon={<Banknote className="size-5" />} onClick={() => setPaying(true)}>{t('sup.pay')}</Button>}
          {canManage && waiting && <Button variant="primary" icon={<PackageCheck className="size-5" />} onClick={() => setReceiving(true)}>{t('po.receive')}</Button>}
        </div>
      )}>
      {!o ? <div className="grid h-40 place-items-center"><Spinner /></div> : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2 text-sm text-fg-2">
            <Badge tone={STATUS_TONE[o.status]}>{t(`po.status_${o.status}`)}</Badge>
            <span className="num">{t('po.ordered_on', { date: fmtDate(o.orderedAt) })}</span>
            {o.expectedAt && waiting && <span className="num">· {t('po.expected_on', { date: fmtDate(o.expectedAt) })}</span>}
            <span>· {t('po.created_by', { name: o.createdByName })}</span>
            {o.currency === 'USD' && <span className="num">· $1 = {fmt(o.rate)} {t('unit.iqd')}</span>}
          </div>
          {o.note && <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm">{o.note}</p>}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="text-xs text-fg-2"><tr>
                <th className="py-2 text-start font-medium" /><th className="py-2 text-end font-medium">{t('po.ordered')}</th><th className="py-2 text-end font-medium">{t('po.arrived')}</th>
                <th className="py-2 text-end font-medium">{t('po.unit_cost')}</th><th className="py-2 text-end font-medium">{t('po.line_total')}</th>
              </tr></thead>
              <tbody className="divide-y divide-line">
                {o.items.map((it) => (
                  <tr key={it.id}>
                    <td className="py-2 pe-3"><div className="font-medium">{pick(it.name, lang)} <span className="text-fg-2">· {it.label}</span></div><div className="num text-xs text-fg-2">{it.sku}</div></td>
                    <td className="num py-2 text-end">{it.qty}</td>
                    <td className={`num py-2 text-end font-semibold ${it.receivedQty >= it.qty ? 'text-ok-fg' : it.receivedQty > 0 ? 'text-warn-fg' : 'text-fg-2'}`}>{it.receivedQty}</td>
                    <td className="py-2 text-end"><Money v={it.unitCost} currency={o.currency} /></td>
                    <td className="py-2 text-end"><Money v={it.lineTotal} currency={o.currency} className="font-semibold" /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="border-t border-line">
                <td className="pt-3 font-semibold">{t('po.total')}</td><td className="num pt-3 text-end">{o.units}</td><td className="num pt-3 text-end">{o.receivedUnits}</td><td />
                <td className="pt-3 text-end"><Money v={o.total} currency={o.currency} className="text-base font-semibold" /></td>
              </tr></tfoot>
            </table>
          </div>
          <div>
            <h3 className="mb-2 font-semibold">{t('po.deliveries')}</h3>
            {!o.receipts?.length ? <p className="text-sm text-fg-2">{t('po.no_deliveries')}</p> : (
              <ul className="divide-y divide-line">
                {o.receipts.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 py-2">
                    <PackageOpen className="size-5 shrink-0 text-gold-text" />
                    <div className="min-w-0 flex-1"><div className="num text-sm">{fmtDateTime(r.receivedAt)}</div><div className="text-xs text-fg-2">{t('po.delivery_line', { units: r.units, name: r.userName })}{r.note ? ` · ${r.note}` : ''}</div></div>
                    <Money v={r.total} currency={o.currency} className="font-semibold" />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      {receiving && o && <ReceiveModal order={o} onClose={() => setReceiving(false)} />}
      {editing && o && <OrderEditor order={o} onClose={() => setEditing(false)} />}
      {paying && o?.supplier && <PaymentModal supplier={o.supplier} orderId={o.id} onClose={() => setPaying(false)} />}
    </Modal>
  )
}

/** What actually arrived: quantities (all that is left by default) and, if the invoice changed, the unit cost. */
function ReceiveModal({ order, onClose }: { order: PurchaseOrder; onClose: () => void }) {
  const t = useT()
  const lang = useUI((s) => s.lang)
  const left = order.items.filter((it) => it.receivedQty < it.qty)
  const [qty, setQty] = useState<Record<number, string>>(() => Object.fromEntries(left.map((it) => [it.id, String(it.qty - it.receivedQty)])))
  const [cost, setCost] = useState<Record<number, string>>(() => Object.fromEntries(left.map((it) => [it.id, String(it.unitCost)])))
  const [rate, setRate] = useState(String(order.rate))
  const [note, setNote] = useState('')
  const run = useAction(receiveOrder, { success: 'po.received_ok' })
  const lines = left.map((it) => ({ itemId: it.id, qty: Math.round(Number(qty[it.id]) || 0), unitCost: fromCents(cents(cost[it.id] ?? '', order.currency)) })).filter((l) => l.qty > 0)
  const total = lines.reduce((s, l) => s + l.qty * cents(l.unitCost, order.currency), 0)
  const tooMany = left.some((it) => (Number(qty[it.id]) || 0) > it.qty - it.receivedQty)
  const submit = async () => { if (await run(order.id, { lines, rate: order.currency === 'USD' ? Number(rate) || order.rate : undefined, note })) onClose() }
  return (
    <Modal open onClose={onClose} size="lg" title={t('po.receive_title', { number: order.number })}
      footer={(
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <Money v={fromCents(total)} currency={order.currency} className="text-lg font-semibold" />
          <Button variant="primary" size="lg" icon={<PackageCheck className="size-5" />} loading={run.busy} disabled={!lines.length || tooMany} onClick={submit}>{t('po.receive_go')}</Button>
        </div>
      )}>
      <p className="mb-4 text-sm text-fg-2">{t('po.receive_hint')}</p>
      <ul className="space-y-3">
        {left.map((it) => {
          const rest = it.qty - it.receivedQty
          return (
            <li key={it.id} className="grid grid-cols-[1fr_6rem_8rem] items-end gap-2 rounded-xl bg-surface-2 p-3">
              <div className="min-w-0 self-center">
                <div className="truncate text-sm font-medium">{pick(it.name, lang)} <span className="text-fg-2">· {it.label}</span></div>
                <button type="button" className="text-xs font-semibold text-gold-text underline" onClick={() => setQty((x) => ({ ...x, [it.id]: String(rest) }))}>{t('po.left', { n: rest })}</button>
              </div>
              <Field label={t('po.qty')}>{(id) => <Input id={id} inputMode="numeric" className="num" invalid={(Number(qty[it.id]) || 0) > rest} value={qty[it.id] ?? ''} onChange={(e) => setQty((x) => ({ ...x, [it.id]: e.target.value.replace(/\D/g, '') }))} />}</Field>
              <Field label={`${t('po.unit_cost')} (${order.currency})`}>{(id) => <Input id={id} inputMode="decimal" className="num" value={cost[it.id] ?? ''} onChange={(e) => setCost((x) => ({ ...x, [it.id]: e.target.value.replace(/[^\d.]/g, '') }))} />}</Field>
            </li>
          )
        })}
      </ul>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {order.currency === 'USD' && <Field label={t('po.rate')}>{(id) => <Input id={id} inputMode="numeric" className="num" value={rate} onChange={(e) => setRate(e.target.value.replace(/\D/g, ''))} />}</Field>}
        <Field label={t('po.note')}>{(id) => <Input id={id} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />}</Field>
      </div>
    </Modal>
  )
}
