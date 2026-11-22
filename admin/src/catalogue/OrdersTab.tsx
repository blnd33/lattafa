import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Ban, Check, Clock, MessageCircle, Package, Trash2, Wallet } from 'lucide-react'
import { Button, IconButton } from '@/components/ui/Button'
import { Badge, Card, EmptyState, PageHeader, Spinner } from '@/components/ui/Controls'
import { Field, Input, SearchInput, Select, Textarea } from '@/components/ui/Field'
import { Modal, useConfirm } from '@/components/ui/Modal'
import { cn } from '@/components/ui/cn'
import { errorMessage, useT } from '@/i18n'
import { toast } from '@/store/toast'
import * as cat from './api'

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'neutral' | 'gold'> = {
  pending_approval: 'warn',
  approval_processing: 'warn',
  approved: 'ok',
  rejected: 'danger',
  cancelled: 'neutral',
  integration_error: 'danger',
}
const PAYMENT_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'neutral'> = {
  paid: 'ok', partial: 'warn', pending: 'warn', unpaid: 'neutral', failed: 'danger', refunded: 'neutral',
}

const money = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * Wholesale orders, from the shop's side.
 *
 * An order waiting for approval is holding bottles off the shelf, and nothing releases them but a person. So the
 * list leads with how long each one has been waiting, and the detail gives three ways out: approve it (the stock
 * comes off for good), refuse or cancel it (the bottles go back), or let the hold go while leaving the order to
 * be decided later.
 */
export function OrdersTab({ canSeePayments }: { canSeePayments: boolean }) {
  const t = useT()
  const [open, setOpen] = useState<string | null>(null)
  const [status, setStatus] = useState('pending_approval')
  const [q, setQ] = useState('')

  const orders = useQuery({
    queryKey: ['cat-orders', status, q],
    queryFn: () => cat.getOrders({ status: status || undefined, q: q || undefined }),
  })

  if (open) return <OrderDetail id={open} canSeePayments={canSeePayments} onBack={() => setOpen(null)} />

  const waiting = (orders.data ?? []).filter((o) => o.status === 'pending_approval')

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-2 !py-3">
        <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('wc.search_orders')} className="min-w-52 flex-1" />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t('wc.status')} className="!w-auto">
          <option value="">{t('wc.all_orders')}</option>
          {cat.ORDER_STATUSES.map((s) => <option key={s} value={s}>{t(`wc.os_${s}`)}</option>)}
        </Select>
      </Card>

      {status === 'pending_approval' && waiting.length > 0 && (
        <p className="flex items-center gap-2 rounded-xl bg-warn-bg px-3 py-2.5 text-sm text-warn-fg">
          <Clock className="size-4 shrink-0" />{t('wc.waiting_hint', { n: waiting.length })}
        </p>
      )}

      {orders.isLoading ? <div className="grid h-60 place-items-center"><Spinner className="size-9" /></div>
        : !orders.data?.length ? <Card><EmptyState title={t('wc.no_orders')} hint={t('wc.no_orders_hint')} /></Card> : (
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full min-w-[52rem] text-sm">
              <thead className="bg-surface-2 text-xs text-fg-2">
                <tr>
                  <th className="px-3 py-2.5 text-start font-semibold">{t('wc.col_order')}</th>
                  <th className="px-3 py-2.5 text-start font-semibold">{t('wc.col_business')}</th>
                  <th className="px-3 py-2.5 text-start font-semibold">{t('wc.col_country')}</th>
                  <th className="px-3 py-2.5 text-end font-semibold">{t('wc.col_total')}</th>
                  <th className="px-3 py-2.5 text-start font-semibold">{t('wc.status')}</th>
                  <th className="px-3 py-2.5 text-start font-semibold">{t('wc.col_payment')}</th>
                </tr>
              </thead>
              <tbody>
                {orders.data.map((o) => (
                  <tr key={o.id} className="cursor-pointer border-t border-line hover:bg-surface-2" onClick={() => setOpen(o.id)}>
                    <td className="num px-3 py-2.5 font-semibold">
                      {o.number}
                      {o.method === 'whatsapp' && <MessageCircle className="ms-1.5 inline size-3.5 text-fg-2" aria-label="WhatsApp" />}
                    </td>
                    <td className="px-3 py-2.5">{o.businessName}</td>
                    <td className="num px-3 py-2.5 text-fg-2">{o.country?.iso2 ?? '—'}</td>
                    <td className="num px-3 py-2.5 text-end font-semibold">{money(o.subtotalCents)}</td>
                    <td className="px-3 py-2.5"><Badge tone={STATUS_TONE[o.status] ?? 'neutral'}>{t(`wc.os_${o.status}`)}</Badge></td>
                    <td className="px-3 py-2.5"><Badge tone={PAYMENT_TONE[o.paymentStatus] ?? 'neutral'}>{t(`wc.ps_${o.paymentStatus}`)}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  )
}

function OrderDetail({ id, canSeePayments, onBack }: { id: string; canSeePayments: boolean; onBack: () => void }) {
  const t = useT()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [paying, setPaying] = useState(false)
  const order = useQuery({ queryKey: ['cat-order', id], queryFn: () => cat.getOrder(id) })
  const o = order.data

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['cat-order', id] })
    void qc.invalidateQueries({ queryKey: ['cat-orders'] })
  }

  const act = useMutation({
    mutationFn: async (what: 'approve' | 'reject' | 'cancel') => {
      if (what === 'approve') return cat.approveOrder(id)
      const reason = window.prompt(t('wc.decline_why')) ?? ''
      return what === 'reject' ? cat.rejectOrder(id, reason) : cat.cancelOrder(id, reason)
    },
    onSuccess: () => { refresh(); toast.success(t('wc.order_saved')) },
    onError: (e) => toast.error(errorMessage(e, t)),
  })

  if (order.isLoading || !o) return <div className="grid h-60 place-items-center"><Spinner className="size-9" /></div>

  const open = o.status === 'pending_approval' || o.status === 'integration_error'

  return (
    <div className="space-y-4">
      <PageHeader
        title={<span className="num flex items-center gap-2"><Package className="size-5 text-gold-text" />{o.number}</span>}
        subtitle={<span className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[o.status] ?? 'neutral'}>{t(`wc.os_${o.status}`)}</Badge>
          <Badge tone={PAYMENT_TONE[o.paymentStatus] ?? 'neutral'}>{t(`wc.ps_${o.paymentStatus}`)}</Badge>
          {o.method === 'whatsapp' && <Badge tone="neutral"><MessageCircle className="size-3" />WhatsApp</Badge>}
        </span>}
        actions={<>
          <Button variant="ghost" icon={<ArrowLeft className="size-5 rtl:rotate-180" />} onClick={onBack}>{t('common.back')}</Button>
          {open && <Button icon={<Check className="size-5" />} loading={act.isPending} onClick={async () => {
            if (await confirm({ title: t('wc.approve_q', { order: o.number }), message: t('wc.approve_hint') })) act.mutate('approve')
          }}>{t('wc.approve')}</Button>}
          {open && <Button variant="secondary" icon={<Ban className="size-5" />} onClick={() => act.mutate('reject')}>{t('wc.decline')}</Button>}
          {open && <Button variant="secondary" onClick={() => act.mutate('cancel')}>{t('wc.cancel_order')}</Button>}
        </>}
      />

      {o.status === 'integration_error' && (
        <p className="rounded-xl bg-danger-bg px-3 py-2.5 text-sm text-danger-fg">{t('wc.needs_a_look')}</p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h3 className="mb-3 font-serif text-lg">{t('wc.what_they_want')}</h3>
          <ul className="divide-y divide-line text-sm">
            {o.items.map((i) => (
              <li key={i.variantId} className="flex flex-wrap items-center gap-2 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{i.name}</span>
                  <span className="num block text-xs text-fg-2">{i.label} · {i.sku}</span>
                </span>
                <span className="num text-fg-2">{money(i.unitCents)} × {i.qty}</span>
                <span className="num w-24 text-end font-semibold">{money(i.lineCents)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-baseline justify-between border-t border-line pt-3">
            <span className="text-sm text-fg-2">{t('wc.col_total')} · {t('wc.bottles_n', { n: o.units })}</span>
            <span className="num font-serif text-2xl">{money(o.subtotalCents)}</span>
          </div>
          {o.note && (
            <div className="mt-3 rounded-xl bg-surface-2 p-3">
              <div className="mb-1 text-xs font-medium text-fg-2">{t('wc.their_note')}</div>
              <p className="whitespace-pre-line text-sm">{o.note}</p>
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <h3 className="mb-3 font-serif text-lg">{t('wc.who_sent_it')}</h3>
            <dl className="grid gap-2 text-sm">
              <Fact label={t('wc.business_name')} value={o.businessName} />
              <Fact label={t('wc.contact')} value={o.contactPerson} />
              <Fact label={t('wc.phone')} value={o.phone} ltr />
              <Fact label={t('wc.whatsapp')} value={o.whatsapp} ltr />
              <Fact label={t('wc.email')} value={o.email} ltr />
              <Fact label={t('wc.address')} value={o.address} />
            </dl>
          </Card>

        </div>
      </div>

      {canSeePayments && (
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-serif text-lg">{t('wc.money')}</h3>
              <p className="text-sm text-fg-2">{t('wc.money_hint')}</p>
            </div>
            <Button variant="secondary" icon={<Wallet className="size-5" />} onClick={() => setPaying(true)}>{t('wc.record_payment')}</Button>
          </div>

          <p className="num mb-3 text-sm">
            {t('wc.paid_of', { paid: money(o.paidCents), total: money(o.subtotalCents) })}
          </p>

          {!o.payments?.length ? <p className="text-sm text-fg-2">{t('wc.no_payments')}</p> : (
            <ul className="divide-y divide-line text-sm">
              {o.payments.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2 py-2.5">
                  <span className="num font-semibold">{money(p.amountCents)}</span>
                  <Badge tone={p.status === 'confirmed' ? 'ok' : p.status === 'refunded' ? 'neutral' : p.status === 'failed' ? 'danger' : 'warn'}>
                    {t(`wc.pay_${p.status}`)}
                  </Badge>
                  <span className="text-fg-2">{t(`wc.method_${p.method}`)}</span>
                  {p.reference && <span className="num text-xs text-fg-2">{p.reference}</span>}
                  <span className="ms-auto flex items-center gap-1">
                    {p.status === 'pending' && (
                      <Button size="sm" variant="ghost" onClick={async () => {
                        try { await cat.setPaymentStatus(p.id, 'confirmed'); refresh() } catch (e) { toast.error(errorMessage(e, t)) }
                      }}>{t('wc.confirm_payment')}</Button>
                    )}
                    {p.status === 'confirmed' && (
                      <Button size="sm" variant="ghost" onClick={async () => {
                        try { await cat.setPaymentStatus(p.id, 'refunded'); refresh() } catch (e) { toast.error(errorMessage(e, t)) }
                      }}>{t('wc.refund')}</Button>
                    )}
                    <IconButton label={t('common.delete')} variant="ghost" onClick={async () => {
                      if (!(await confirm({ title: t('wc.remove_payment_q'), danger: true }))) return
                      try { await cat.deletePayment(p.id); refresh() } catch (e) { toast.error(errorMessage(e, t)) }
                    }}><Trash2 className="size-4 text-danger-fg" /></IconButton>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {!!o.history?.length && (
        <Card>
          <h3 className="mb-3 font-serif text-lg">{t('wc.what_happened')}</h3>
          <ul className="divide-y divide-line text-sm">
            {o.history.map((h, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 py-2">
                <span className="num text-xs text-fg-2">{new Date(h.at).toLocaleString()}</span>
                <span>{t(`wc.os_${h.to}`)}</span>
                {h.reason && <span className="text-fg-2">— {h.reason}</span>}
                <span className="ms-auto text-xs text-fg-2">{h.byName || '—'}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {paying && <RecordPayment orderId={o.id} owing={Math.max(0, o.subtotalCents - o.paidCents)} onClose={() => setPaying(false)} onDone={() => { setPaying(false); refresh() }} />}
    </div>
  )
}

function Fact({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="flex gap-3">
      <dt className="w-24 shrink-0 text-xs text-fg-2">{label}</dt>
      <dd className={cn('min-w-0 flex-1', ltr && 'num')} dir={ltr ? 'ltr' : undefined}>{value || '—'}</dd>
    </div>
  )
}

function RecordPayment({ orderId, owing, onClose, onDone }: { orderId: string; owing: number; onClose: () => void; onDone: () => void }) {
  const t = useT()
  const [method, setMethod] = useState<string>('bank_transfer')
  const [amount, setAmount] = useState(String(owing / 100))
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [pending, setPending] = useState(false)
  const [busy, setBusy] = useState(false)

  const cents = cat.toCents(amount)

  const save = async () => {
    if (cents === null || cents <= 0) return toast.error(t('wc.bad_number'))
    setBusy(true)
    try {
      await cat.recordPayment(orderId, { method, amountCents: cents, reference, note, status: pending ? 'pending' : 'confirmed' })
      toast.success(t('wc.payment_saved'))
      onDone()
    } catch (e) { toast.error(errorMessage(e, t)) } finally { setBusy(false) }
  }

  return (
    <Modal open onClose={onClose} title={t('wc.record_payment')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
      <Button loading={busy} onClick={() => void save()}>{t('common.save')}</Button>
    </>}>
      <div className="space-y-3">
        <Field label={t('wc.method')}>
          {(id) => (
            <Select id={id} value={method} onChange={(e) => setMethod(e.target.value)}>
              {cat.PAYMENT_METHODS.map((m) => <option key={m} value={m}>{t(`wc.method_${m}`)}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t('wc.amount')} hint={t('wc.amount_hint')}>
          {(id) => (
            <div className="flex items-center gap-1">
              <span className="text-fg-2">$</span>
              <Input id={id} dir="ltr" inputMode="decimal" className={cn('num', cents === null && amount.trim() !== '' && 'ring-2 ring-inset ring-danger')}
                value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
          )}
        </Field>
        <Field label={t('wc.reference')} hint={t('wc.reference_hint')}>
          {(id) => <Input id={id} value={reference} onChange={(e) => setReference(e.target.value)} />}
        </Field>
        <Field label={t('common.note')}>{(id) => <Textarea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={pending} onChange={(e) => setPending(e.target.checked)} className="size-4 accent-[var(--color-gold)]" />
          {t('wc.not_cleared_yet')}
        </label>
        <p className="text-xs text-fg-2">{t('wc.payment_hint')}</p>
      </div>
    </Modal>
  )
}
