import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { HandCoins, Pencil, Phone, Plus, ShoppingBag, Trash2, UserRound } from 'lucide-react'
import { Amt } from '@/components/ui/Amt'
import { Avatar, Badge, Card, EmptyState, PageHeader, Segmented, Spinner, Stat, Switch } from '@/components/ui/Controls'
import { Button } from '@/components/ui/Button'
import { Field, Input, SearchInput, Select, Textarea } from '@/components/ui/Field'
import { Modal, useConfirm } from '@/components/ui/Modal'
import { cn } from '@/components/ui/cn'
import { useT } from '@/i18n'
import { APP } from '@/data/app'
import type { Customer, CustomerType, PaymentMethod } from '@/data/types'
import { fmtDateTime } from '@/lib/date'
import { fmt, parseAmount } from '@/lib/money'
import { collectPayment, customerStatement, deleteCustomer, saveCustomer } from '@/services/customers'
import { useAction, useCustomers } from '@/hooks/queries'
import { useCan } from '@/hooks/useAuth'
import { useCart } from '@/store/cart'

const TYPES: CustomerType[] = ['retail', 'shop', 'wholesale']

export function CustomersPage() {
  const t = useT()
  const { data: customers, isLoading } = useCustomers()
  const canCreate = useCan('customers.create')
  const [q, setQ] = useState('')
  const [type, setType] = useState<'all' | CustomerType>('all')
  const [debtOnly, setDebtOnly] = useState(false)
  const [editing, setEditing] = useState<Customer | 'new' | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (customers ?? []).filter((c) => (type === 'all' || c.type === type) && (!debtOnly || c.balanceIQD > 0) && (!s || c.name.toLowerCase().includes(s) || c.phone.replace(/\s/g, '').includes(s.replace(/\s/g, ''))))
  }, [customers, q, type, debtOnly])
  const totalDebt = (customers ?? []).reduce((a, c) => a + c.balanceIQD, 0)
  const open = customers?.find((c) => c.id === openId) ?? null

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      <PageHeader title={t('cust.title')} subtitle={t('cust.subtitle')} actions={canCreate && <Button variant="primary" size="lg" icon={<Plus className="size-5" />} onClick={() => setEditing('new')}>{t('cust.new')}</Button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t('cust.total')} value={<span className="num">{customers?.length ?? 0}</span>} />
        <Stat label={t('cust.total_debt')} value={<Amt n={totalDebt} />} tone={totalDebt > 0 ? 'danger' : undefined} />
        <Stat label={t('cust.with_debt')} value={<span className="num">{(customers ?? []).filter((c) => c.balanceIQD > 0).length}</span>} />
        <Stat label={t('cust.points_out')} value={<span className="num">{fmt((customers ?? []).reduce((a, c) => a + c.points, 0))}</span>} />
      </div>
      <div className="mb-4 grid gap-2.5 md:grid-cols-[1fr_auto_auto]">
        <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('cust.search')} />
        <Segmented value={type} onChange={setType} options={[{ value: 'all', label: t('common.all') }, ...TYPES.map((x) => ({ value: x, label: t(`cust.type_${x}`) }))]} />
        <label className="flex h-11 items-center gap-2.5 rounded-xl bg-surface-2 px-3.5 text-sm font-medium">{t('cust.debt_only')}<Switch checked={debtOnly} onChange={setDebtOnly} label={t('cust.debt_only')} /></label>
      </div>

      {isLoading ? <div className="grid place-items-center py-16"><Spinner className="size-9" /></div> : !list.length ? <EmptyState title={t('cust.none')} hint={t('cust.none_hint')} /> : (
        <ul className="grid gap-2.5 md:grid-cols-2">
          {list.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => setOpenId(c.id)} className="flex w-full items-center gap-3.5 rounded-2xl border border-line bg-surface p-3.5 text-start shadow-soft transition hover:border-gold-light active:bg-surface-2">
                <Avatar name={c.name} color="#D4A548" size={48} />
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="truncate font-semibold">{c.name}</div>
                  <div className="num mt-0.5 truncate text-xs text-fg-2">{c.phone || '—'} · {t(`cust.type_${c.type}`)}{c.city ? ` · ${c.city}` : ''}</div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {c.balanceIQD > 0 ? <Badge tone="danger">{t('sell.owes')} <span className="num">{fmt(c.balanceIQD)}</span></Badge> : <Badge tone="ok">{t('cust.settled')}</Badge>}
                  {c.points > 0 && <Badge tone="gold"><span className="num">{c.points}</span> {t('sell.pts')}</Badge>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      <CustomerForm value={editing} onClose={() => setEditing(null)} />
      <CustomerDetail customer={open} onClose={() => setOpenId(null)} onEdit={(c) => { setOpenId(null); setEditing(c) }} />
    </div>
  )
}

function CustomerForm({ value, onClose }: { value: Customer | 'new' | null; onClose: () => void }) {
  const t = useT()
  const canCredit = useCan('customers.credit')
  const run = useAction(saveCustomer, { success: 'cust.saved' })
  const existing = value && value !== 'new' ? value : null
  const [f, setF] = useState({ name: '', phone: '', type: 'retail' as CustomerType, city: '', notes: '', limit: '0' })
  const [key, setKey] = useState<string | null>(null)
  const id = value ? (existing?.id ?? 'new') : null
  if (id !== key) {
    setKey(id)
    if (existing) setF({ name: existing.name, phone: existing.phone, type: existing.type, city: existing.city, notes: existing.notes, limit: String(existing.creditLimitIQD) })
    else setF({ name: '', phone: '', type: 'retail', city: '', notes: '', limit: '0' })
  }
  const submit = async () => { if (await run({ id: existing?.id, name: f.name, phone: f.phone, type: f.type, city: f.city, notes: f.notes, creditLimitIQD: parseAmount(f.limit) })) onClose() }
  return (
    <Modal open={!!value} onClose={onClose} title={existing ? t('cust.edit') : t('cust.new')} size="md" footer={<Button size="lg" variant="primary" block loading={run.busy} disabled={!f.name.trim()} onClick={submit}>{t('common.save')}</Button>}>
      <div className="space-y-4">
        <Field label={t('common.name')}>{(i) => <Input id={i} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-autofocus />}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('common.phone')}>{(i) => <Input id={i} type="tel" inputMode="tel" className="num" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />}</Field>
          <Field label={t('common.city')}>{(i) => <Input id={i} value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} />}</Field>
          <Field label={t('cust.type')}>{(i) => <Select id={i} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as CustomerType })}>{TYPES.map((x) => <option key={x} value={x}>{t(`cust.type_${x}`)}</option>)}</Select>}</Field>
          <Field label={t('cust.credit_limit')} hint={canCredit ? t('cust.credit_hint') : t('err.forbidden')}>{(i) => <Input id={i} inputMode="numeric" className="num" disabled={!canCredit && !!existing} value={f.limit} onChange={(e) => setF({ ...f, limit: e.target.value.replace(/[^\d]/g, '') })} />}</Field>
        </div>
        <Field label={t('common.note')}>{(i) => <Textarea id={i} rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />}</Field>
      </div>
    </Modal>
  )
}

function CustomerDetail({ customer, onClose, onEdit }: { customer: Customer | null; onClose: () => void; onEdit: (c: Customer) => void }) {
  const t = useT()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const setCustomer = useCart((s) => s.setCustomer)
  const canEdit = useCan('customers.edit')
  const canDelete = useCan('customers.delete')
  const canCollect = useCan('customers.collect')
  const canSell = useCan('pos.sell') && APP !== 'admin' // the admin panel has no selling screen
  const [collect, setCollect] = useState(false)
  const del = useAction(deleteCustomer, { success: 'cust.deleted' })
  const { data: st } = useQuery({ queryKey: ['statement', customer?.id, customer?.balanceIQD], queryFn: () => customerStatement(customer!.id), enabled: !!customer })
  if (!customer) return null
  const spent = (st?.sales ?? []).filter((s) => s.status !== 'voided').reduce((a, s) => a + s.totalIQD, 0)
  return (
    <>
      <Modal open onClose={onClose} title={customer.name} size="lg" side={false}
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {canDelete && <Button variant="ghost" className="me-auto text-danger" icon={<Trash2 className="size-5" />} onClick={async () => { if (await confirm({ title: t('cust.delete_title'), message: t('cust.delete_msg'), danger: true, confirmLabel: t('common.delete') })) { if (await del(customer.id)) onClose() } }}>{t('common.delete')}</Button>}
            {canEdit && <Button variant="secondary" size="lg" icon={<Pencil className="size-5" />} onClick={() => onEdit(customer)}>{t('cust.edit')}</Button>}
            {canCollect && customer.balanceIQD > 0 && <Button variant="secondary" size="lg" icon={<HandCoins className="size-5" />} onClick={() => setCollect(true)}>{t('cust.collect')}</Button>}
            {canSell && <Button variant="primary" size="lg" icon={<ShoppingBag className="size-5" />} onClick={() => { setCustomer(customer.id); onClose(); navigate('/sell') }}>{t('cust.start_sale')}</Button>}
          </div>
        }
      >
        <div className="space-y-5">
          <div className="flex items-center gap-4">
            <Avatar name={customer.name} color="#D4A548" size={64} />
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2"><Badge tone="neutral">{t(`cust.type_${customer.type}`)}</Badge>{customer.city && <span className="text-sm text-fg-2">{customer.city}</span>}</div>
              {customer.phone && <a href={`tel:${customer.phone.replace(/\s/g, '')}`} className="num inline-flex items-center gap-1.5 text-sm font-medium text-gold-text"><Phone className="size-4" />{customer.phone}</a>}
              {customer.notes && <p className="text-sm text-fg-2">{customer.notes}</p>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label={t('cust.balance')} value={<Amt n={customer.balanceIQD} />} tone={customer.balanceIQD > 0 ? 'danger' : 'ok'} />
            <Stat label={t('cust.credit_limit')} value={<Amt n={customer.creditLimitIQD} />} />
            <Stat label={t('cust.points')} value={<span className="num">{customer.points}</span>} />
            <Stat label={t('cust.spent')} value={<Amt n={spent} />} />
          </div>
          <Card pad={false}>
            <h3 className="border-b border-line px-4 py-3 font-semibold">{t('cust.statement')}</h3>
            {!st ? <div className="p-6"><Spinner /></div> : st.rows.length === 0 ? <EmptyState title={t('cust.no_activity')} className="py-8" /> : (
              <ul className="max-h-72 divide-y divide-line overflow-y-auto">
                {st.rows.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg', r.amountIQD > 0 ? 'bg-danger-bg text-danger-fg' : 'bg-ok-bg text-ok-fg')}><UserRound className="size-4" /></span>
                    <span className="min-w-0 flex-1 leading-tight"><span className="block font-medium">{t(`cust.row_${r.kind}`)} <span className="num">{r.ref}</span></span><span className="num block text-xs text-fg-2">{fmtDateTime(r.at)}{r.note ? ` · ${r.note}` : ''}</span></span>
                    <Amt n={r.amountIQD} className={cn('font-semibold', r.amountIQD > 0 ? 'text-danger' : 'text-success')} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </Modal>
      <CollectModal customer={collect ? customer : null} onClose={() => setCollect(false)} />
    </>
  )
}

function CollectModal({ customer, onClose }: { customer: Customer | null; onClose: () => void }) {
  const t = useT()
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('cash_iqd')
  const [note, setNote] = useState('')
  const run = useAction(collectPayment, { success: 'cust.collected' })
  if (!customer) return null
  const submit = async () => { if (await run({ customerId: customer.id, amountIQD: parseAmount(amount), method, note })) { setAmount(''); setNote(''); onClose() } }
  return (
    <Modal open onClose={onClose} title={t('cust.collect')} size="sm" footer={<Button size="lg" variant="primary" block loading={run.busy} disabled={!(parseAmount(amount) > 0)} onClick={submit}>{t('cust.collect_confirm')}</Button>}>
      <div className="space-y-4">
        <div className="rounded-xl bg-surface-2 p-3 text-sm">{t('cust.balance')}: <Amt n={customer.balanceIQD} className="font-bold text-danger" /></div>
        <Field label={t('common.amount')}>
          {(i) => (
            <div className="flex gap-2">
              <Input id={i} big inputMode="numeric" className="num" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))} data-autofocus />
              <Button variant="secondary" onClick={() => setAmount(String(customer.balanceIQD))}>{t('cust.full')}</Button>
            </div>
          )}
        </Field>
        <Field label={t('cust.pay_method')}>{(i) => <Select id={i} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>{(['cash_iqd', 'card', 'fib', 'zain'] as PaymentMethod[]).map((m) => <option key={m} value={m}>{t(`method.${m}`)}</option>)}</Select>}</Field>
        <Field label={t('common.note')}>{(i) => <Input id={i} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      </div>
    </Modal>
  )
}
