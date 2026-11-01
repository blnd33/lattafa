import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus, Save, Trash2 } from 'lucide-react'
import { Button, IconButton } from '@/components/ui/Button'
import { Switch } from '@/components/ui/Controls'
import { Field, Input, Select } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { useAction, useSettings } from '@/hooks/queries'
import { useCan } from '@/hooks/useAuth'
import { pick, useT } from '@/i18n'
import { fromInputDate, toInputDate } from '@/lib/date'
import { fmt } from '@/lib/money'
import { useUI } from '@/store/ui'
import { cents, fromCents, Money } from '../money'
import { createOrder, listSuppliers, updateOrder, type PurchaseOrder } from './api'
import { SupplierEditor } from './Suppliers'
import { VariantPicker, type Picked } from './VariantPicker'

interface Line { variantId: string; name: string; label: string; sku: string; qty: string; unitCost: string; costIQD: number }

/** A new order, or one nothing has arrived for yet. */
export function OrderEditor({ order, onClose, onSaved }: { order?: PurchaseOrder; onClose: () => void; onSaved?: (o: PurchaseOrder) => void }) {
  const t = useT()
  const lang = useUI((s) => s.lang)
  const { data: settings } = useSettings()
  const canManageSuppliers = useCan('purchasing.manage')
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: listSuppliers })
  const [supplierId, setSupplierId] = useState(order?.supplier?.id ?? '')
  const [rate, setRate] = useState(String(order?.rate ?? ''))
  const [expected, setExpected] = useState(order?.expectedAt ? toInputDate(order.expectedAt) : '')
  const [note, setNote] = useState(order?.note ?? '')
  const [receiveNow, setReceiveNow] = useState(false)
  const [addingSupplier, setAddingSupplier] = useState(false)
  const [lines, setLines] = useState<Line[]>(() => (order?.items ?? []).map((it) => ({
    variantId: it.variantId, name: pick(it.name, lang), label: it.label, sku: it.sku, qty: String(it.qty), unitCost: String(it.unitCost), costIQD: 0,
  })))
  const active = (suppliers.data ?? []).filter((s) => s.active || s.id === supplierId)
  const supplier = active.find((s) => s.id === supplierId)
  const currency = supplier?.currency ?? order?.currency ?? 'USD'
  const shopRate = settings?.currency.rate ?? 1460
  const usedRate = currency === 'USD' ? Number(rate) || shopRate : shopRate
  const total = useMemo(() => lines.reduce((s, l) => s + (Number(l.qty) || 0) * cents(l.unitCost, currency), 0), [lines, currency])
  const run = useAction(async () => {
    const input = {
      rate: currency === 'USD' ? usedRate : undefined, note, expectedAt: expected ? fromInputDate(expected) : null,
      lines: lines.map((l) => ({ variantId: l.variantId, qty: Math.round(Number(l.qty)), unitCost: fromCents(cents(l.unitCost, currency)) })),
    }
    return order ? updateOrder(order.id, input) : createOrder({ ...input, supplierId, receiveNow })
  }, { success: 'po.saved' })

  const add = ({ product, variant }: Picked) => setLines((ls) => {
    const i = ls.findIndex((l) => l.variantId === variant.id)
    if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, qty: String((Number(l.qty) || 0) + 1) } : l))
    // start from what it costs today, in the order's currency
    const guess = variant.costIQD > 0 ? (currency === 'USD' ? Math.round((variant.costIQD / usedRate) * 100) / 100 : variant.costIQD) : 0
    return [...ls, { variantId: variant.id, name: pick(product.name, lang), label: variant.label, sku: variant.sku, qty: '1', unitCost: guess ? String(guess) : '', costIQD: variant.costIQD }]
  })
  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const valid = !!supplierId && lines.length > 0 && lines.every((l) => Number(l.qty) >= 1 && Number(l.unitCost) >= 0 && l.unitCost !== '')
  const save = async () => { const o = await run(); if (o) { onSaved?.(o); onClose() } }

  return (
    <Modal open onClose={onClose} size="xl" title={order ? `${t('po.edit')} · ${order.number}` : t('po.new')}
      footer={(
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-fg-2">{t('po.total')}: <Money v={fromCents(total)} currency={currency} className="text-lg font-semibold text-fg" /></div>
          <Button variant="primary" size="lg" icon={<Save className="size-5" />} loading={run.busy} disabled={!valid} onClick={save}>{t('po.save')}</Button>
        </div>
      )}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('po.supplier')}>{(id) => (
            <div className="flex gap-2">
              <Select id={id} value={supplierId} disabled={!!order} onChange={(e) => setSupplierId(e.target.value)} className="flex-1">
                <option value="">{t('po.pick_supplier')}</option>
                {active.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.currency}</option>)}
              </Select>
              {!order && canManageSuppliers && <IconButton label={t('sup.new')} onClick={() => setAddingSupplier(true)}><Plus className="size-5" /></IconButton>}
            </div>
          )}</Field>
          {currency === 'USD' && (
            <Field label={t('po.rate')}>{(id) => <Input id={id} inputMode="numeric" className="num" value={rate} placeholder={String(shopRate)} onChange={(e) => setRate(e.target.value.replace(/\D/g, ''))} />}</Field>
          )}
          <Field label={t('po.expected')}>{(id) => <Input id={id} type="date" className="num" value={expected} onChange={(e) => setExpected(e.target.value)} />}</Field>
          <Field label={t('po.note')}>{(id) => <Input id={id} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />}</Field>
        </div>
        {!suppliers.isLoading && !active.length && <p className="rounded-xl bg-warn-bg px-3 py-2.5 text-sm text-warn-fg">{t('po.need_supplier')}</p>}

        <VariantPicker onPick={add} />
        {!lines.length ? <p className="rounded-xl bg-surface-2 px-3 py-6 text-center text-sm text-fg-2">{t('po.no_lines')}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="text-xs text-fg-2">
                <tr><th className="py-2 text-start font-medium" /><th className="w-24 py-2 text-start font-medium">{t('po.qty')}</th><th className="w-36 py-2 text-start font-medium">{t('po.unit_cost')} ({currency})</th><th className="w-32 py-2 text-end font-medium">{t('po.line_total')}</th><th className="w-12" /></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {lines.map((l, i) => (
                  <tr key={l.variantId}>
                    <td className="py-2 pe-3">
                      <div className="font-medium">{l.name} <span className="text-fg-2">· {l.label}</span></div>
                      <div className="num text-xs text-fg-2">{l.sku}{l.costIQD > 0 && ` · ${t('po.cost_now', { amount: fmt(l.costIQD) })}`}</div>
                    </td>
                    <td className="py-2 pe-2"><Input aria-label={`${t('po.qty')} · ${l.name}`} inputMode="numeric" className="num" value={l.qty} onChange={(e) => set(i, { qty: e.target.value.replace(/\D/g, '') })} /></td>
                    <td className="py-2 pe-2"><Input aria-label={`${t('po.unit_cost')} · ${l.name}`} inputMode="decimal" className="num" value={l.unitCost} onChange={(e) => set(i, { unitCost: e.target.value.replace(/[^\d.]/g, '') })} /></td>
                    <td className="py-2 text-end"><Money v={fromCents((Number(l.qty) || 0) * cents(l.unitCost, currency))} currency={currency} className="font-semibold" /></td>
                    <td className="py-2 text-end"><IconButton label={t('po.remove_line')} variant="ghost" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 className="size-4" /></IconButton></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!order && (
          <label className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 p-3.5 text-sm font-medium">
            {t('po.receive_now')}<Switch checked={receiveNow} onChange={setReceiveNow} label={t('po.receive_now')} />
          </label>
        )}
      </div>
      {addingSupplier && <SupplierEditor onClose={() => setAddingSupplier(false)} onSaved={(s) => setSupplierId(s.id)} />}
    </Modal>
  )
}
