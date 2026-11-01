import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Banknote, Pencil, Plus, Save, Trash2, Truck } from 'lucide-react'
import { Button, IconButton } from '@/components/ui/Button'
import { Badge, Card, EmptyState, Segmented, Spinner, Switch } from '@/components/ui/Controls'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Modal, useConfirm } from '@/components/ui/Modal'
import { cn } from '@/components/ui/cn'
import { useAction, useSettings } from '@/hooks/queries'
import { useCan } from '@/hooks/useAuth'
import { useT } from '@/i18n'
import { fmtDate, fromInputDate, toInputDate } from '@/lib/date'
import { CURRENCIES, fmtMoney, Money, type Currency } from '../money'
import { deletePayment, listOrders, listSuppliers, PAY_METHODS, paySupplier, saveSupplier, supplierStatement, type Supplier, type SupplierInput } from './api'

export function SuppliersTab() {
  const t = useT()
  const canManage = useCan('purchasing.manage')
  const q = useQuery({ queryKey: ['suppliers'], queryFn: listSuppliers })
  const [editing, setEditing] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const rows = q.data ?? []
  return (
    <div className="space-y-3">
      {canManage && <div className="flex justify-end"><Button variant="primary" icon={<Plus className="size-5" />} onClick={() => setEditing(true)}>{t('sup.new')}</Button></div>}
      {q.isLoading ? <div className="grid h-40 place-items-center"><Spinner /></div> : !rows.length ? <Card><EmptyState title={t('sup.none')} /></Card> : (
        <ul className="grid gap-3 md:grid-cols-2">
          {rows.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => setOpen(s.id)} className={cn('flex w-full items-center gap-3 rounded-2xl border border-line bg-surface p-4 text-start shadow-soft transition hover:border-gold', !s.active && 'opacity-60')}>
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-gold-soft text-gold-text dark:bg-gold/15"><Truck className="size-5" /></span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2"><span className="truncate font-semibold">{s.name}</span><Badge>{s.currency}</Badge>{!s.active && <Badge tone="warn">{t('sup.inactive')}</Badge>}</span>
                  <span className="block truncate text-xs text-fg-2">{[s.city, s.phone].filter(Boolean).join(' · ') || '—'}{s.openOrders > 0 && ` · ${t('sup.open_orders', { n: s.openOrders })}`}</span>
                </span>
                <span className="text-end">
                  {s.balance > 0 ? <Money v={s.balance} currency={s.currency} className="font-semibold text-danger" /> : <span className="text-xs text-fg-2">{t('sup.owed_none')}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing && <SupplierEditor onClose={() => setEditing(false)} />}
      {open && <SupplierDetail id={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

export function SupplierEditor({ supplier, onClose, onSaved }: { supplier?: Supplier; onClose: () => void; onSaved?: (s: Supplier) => void }) {
  const t = useT()
  const [f, setF] = useState<SupplierInput>({
    name: supplier?.name ?? '', phone: supplier?.phone ?? '', contact: supplier?.contact ?? '', city: supplier?.city ?? '',
    currency: supplier?.currency ?? 'USD', notes: supplier?.notes ?? '', active: supplier?.active ?? true,
  })
  const up = (p: Partial<SupplierInput>) => setF((x) => ({ ...x, ...p }))
  const run = useAction(saveSupplier, { success: 'sup.saved' })
  const save = async () => { const s = await run(f, supplier?.id); if (s) { onSaved?.(s); onClose() } }
  return (
    <Modal open onClose={onClose} size="lg" title={supplier ? t('sup.edit') : t('sup.new')}
      footer={<Button variant="primary" size="lg" block icon={<Save className="size-5" />} loading={run.busy} disabled={!f.name.trim()} onClick={save}>{t('common.save')}</Button>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('sup.name')} className="sm:col-span-2">{(id) => <Input id={id} value={f.name} maxLength={120} onChange={(e) => up({ name: e.target.value })} data-autofocus />}</Field>
        <Field label={t('sup.contact')}>{(id) => <Input id={id} value={f.contact} onChange={(e) => up({ contact: e.target.value })} />}</Field>
        <Field label={t('sup.phone')}>{(id) => <Input id={id} type="tel" dir="ltr" className="num" value={f.phone} onChange={(e) => up({ phone: e.target.value })} />}</Field>
        <Field label={t('sup.city')}>{(id) => <Input id={id} value={f.city} onChange={(e) => up({ city: e.target.value })} />}</Field>
        <Field label={t('sup.currency')} hint={t('sup.currency_hint')}>{() => (
          <Segmented ariaLabel={t('sup.currency')} value={f.currency} onChange={(c: Currency) => up({ currency: c })} options={CURRENCIES.map((c) => ({ value: c, label: t(`cur.${c}`) }))} />
        )}</Field>
        <Field label={t('sup.notes')} className="sm:col-span-2">{(id) => <Textarea id={id} rows={2} value={f.notes} onChange={(e) => up({ notes: e.target.value })} />}</Field>
        <label className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 p-3.5 text-sm font-medium sm:col-span-2">{t('sup.active')}<Switch checked={f.active} onChange={(v) => up({ active: v })} label={t('sup.active')} /></label>
      </div>
    </Modal>
  )
}

function SupplierDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT()
  const confirm = useConfirm()
  const canManage = useCan('purchasing.manage')
  const canPay = useCan('purchasing.pay')
  const q = useQuery({ queryKey: ['supplier', id], queryFn: () => supplierStatement(id) })
  const [editing, setEditing] = useState(false)
  const [paying, setPaying] = useState(false)
  const del = useAction(deletePayment, { success: 'sup.payment_deleted' })
  const s = q.data?.supplier
  return (
    <Modal open onClose={onClose} size="xl" title={s?.name ?? t('sup.statement')}>
      {!s ? <div className="grid h-40 place-items-center"><Spinner /></div> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl bg-surface-2 p-4">
            <div>
              <div className="text-sm text-fg-2">{t('sup.owed')}</div>
              <Money v={q.data!.balance} currency={s.currency} className={cn('font-serif text-3xl font-semibold', q.data!.balance > 0 && 'text-danger')} />
              <div className="mt-1 text-xs text-fg-2">{[s.contact, s.phone, s.city].filter(Boolean).join(' · ')}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              {canManage && <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>{t('sup.edit')}</Button>}
              {canPay && <Button variant="primary" icon={<Banknote className="size-5" />} onClick={() => setPaying(true)}>{t('sup.pay')}</Button>}
            </div>
          </div>
          <h3 className="font-semibold">{t('sup.statement')}</h3>
          {!q.data!.rows.length ? <p className="py-6 text-center text-sm text-fg-2">{t('sup.no_rows')}</p> : (
            <ul className="divide-y divide-line">
              {q.data!.rows.map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{r.type === 'receipt' ? t('sup.row_receipt', { number: r.orderNumber }) : `${t('sup.row_payment')} · ${t(`pay.${r.method ?? 'other'}`)}${r.orderNumber ? ` · ${r.orderNumber}` : ''}`}</div>
                    <div className="truncate text-xs text-fg-2"><span className="num">{fmtDate(r.at)}</span> · {r.userName}{r.note ? ` · ${r.note}` : ''}</div>
                  </div>
                  <div className="text-end">
                    <Money v={Math.abs(r.amount)} currency={s.currency} className={cn('font-semibold', r.type === 'payment' && 'text-ok-fg')} />
                    <div className="text-xs text-fg-2">{t('sup.balance_after', { amount: fmtMoney(r.balance, s.currency, t) })}</div>
                  </div>
                  {r.type === 'payment' && canPay && (
                    <IconButton label={t('sup.delete_payment')} variant="ghost" onClick={async () => {
                      if (await confirm({ title: t('sup.delete_payment'), message: t('sup.delete_payment_confirm', { amount: fmtMoney(Math.abs(r.amount), s.currency, t) }), danger: true, confirmLabel: t('sup.delete_payment') })) await del(r.id)
                    }}><Trash2 className="size-4" /></IconButton>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {editing && s && <SupplierEditor supplier={s} onClose={() => setEditing(false)} />}
      {paying && s && <PaymentModal supplier={s} onClose={() => setPaying(false)} />}
    </Modal>
  )
}

/** Money paid to a supplier, in their currency. */
export function PaymentModal({ supplier, orderId, onClose }: { supplier: Pick<Supplier, 'id' | 'name' | 'currency'>; orderId?: string; onClose: () => void }) {
  const t = useT()
  const { data: settings } = useSettings()
  const orders = useQuery({ queryKey: ['po', 'supplier', supplier.id], queryFn: () => listOrders('all', supplier.id) })
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<string>('cash')
  const [day, setDay] = useState(toInputDate(Date.now()))
  const [rate, setRate] = useState('')
  const [order, setOrder] = useState(orderId ?? '')
  const [note, setNote] = useState('')
  const run = useAction(paySupplier, { success: 'sup.paid_ok' })
  const shopRate = settings?.currency.rate ?? 1460
  const submit = async () => {
    const today = toInputDate(Date.now()) === day
    const ok = await run(supplier.id, {
      amount: Number(amount), method, note, paidAt: today ? Date.now() : fromInputDate(day) + 12 * 3_600_000,
      rate: supplier.currency === 'USD' ? Number(rate) || shopRate : undefined, purchaseOrderId: order || null,
    })
    if (ok) onClose()
  }
  return (
    <Modal open onClose={onClose} size="sm" title={t('sup.pay_title', { name: supplier.name })}
      footer={<Button variant="primary" size="lg" block icon={<Banknote className="size-5" />} loading={run.busy} disabled={!(Number(amount) > 0)} onClick={submit}>{t('sup.pay')}</Button>}>
      <div className="space-y-4">
        <Field label={t('sup.amount', { currency: supplier.currency })}>{(id) => <Input id={id} inputMode="decimal" className="num" big value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} data-autofocus />}</Field>
        <Field label={t('sup.method')}>{(id) => <Select id={id} value={method} onChange={(e) => setMethod(e.target.value)}>{PAY_METHODS.map((m) => <option key={m} value={m}>{t(`pay.${m}`)}</option>)}</Select>}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('sup.paid_on')}>{(id) => <Input id={id} type="date" className="num" value={day} max={toInputDate(Date.now())} onChange={(e) => e.target.value && setDay(e.target.value)} />}</Field>
          {supplier.currency === 'USD' && <Field label={t('po.rate')}>{(id) => <Input id={id} inputMode="numeric" className="num" placeholder={String(shopRate)} value={rate} onChange={(e) => setRate(e.target.value.replace(/\D/g, ''))} />}</Field>}
        </div>
        <Field label={t('sup.for_order')}>{(id) => (
          <Select id={id} value={order} onChange={(e) => setOrder(e.target.value)}>
            <option value="">{t('sup.no_order')}</option>
            {(orders.data ?? []).filter((o) => o.status !== 'cancelled').map((o) => <option key={o.id} value={o.id}>{o.number} · {fmtMoney(o.receivedTotal || o.total, o.currency, t)}</option>)}
          </Select>
        )}</Field>
        <Field label={t('po.note')}>{(id) => <Input id={id} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />}</Field>
      </div>
    </Modal>
  )
}
