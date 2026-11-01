import { useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Plus, Save, Trash2, Truck } from 'lucide-react'
import { RequireAny } from '@/features/NoAccess'
import { Amt } from '@/components/ui/Amt'
import { Button, IconButton } from '@/components/ui/Button'
import { Card, EmptyState, PageHeader, Segmented, Spinner } from '@/components/ui/Controls'
import { Field, Input, Select } from '@/components/ui/Field'
import { Modal, useConfirm } from '@/components/ui/Modal'
import { useAction, useSettings } from '@/hooks/queries'
import { useCan } from '@/hooks/useAuth'
import { useT } from '@/i18n'
import { fmtDate, fromInputDate, toInputDate } from '@/lib/date'
import { fmt } from '@/lib/money'
import { useUI } from '@/store/ui'
import { monthYear } from '../lib'
import { CURRENCIES, fmtMoney, Money, type Currency } from '../money'
import { PAY_METHODS } from '../purchasing/api'
import { deleteExpense, EXPENSE_CATEGORIES, listExpenses, monthRange, saveExpense, type Expense, type ExpenseCategory } from './api'

/** Admin panel → Expenses: what running the shop costs, month by month. */
export function ExpensesPage() {
  return <RequireAny perms={['expenses.view']}><Expenses /></RequireAny>
}

function Expenses() {
  const t = useT()
  const lang = useUI((s) => s.lang)
  const canManage = useCan('expenses.manage')
  const now = new Date()
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() })
  const [from, to] = monthRange(ym.y, ym.m)
  const isThisMonth = ym.y === now.getFullYear() && ym.m === now.getMonth()
  const q = useQuery({ queryKey: ['expenses', from], queryFn: () => listExpenses(from, to), placeholderData: keepPreviousData })
  const [editing, setEditing] = useState<Expense | 'new' | null>(null)
  const step = (d: number) => setYm(({ y, m }) => { const x = new Date(y, m + d, 1); return { y: x.getFullYear(), m: x.getMonth() } })
  const d = q.data
  const top = d?.byCategory[0]?.amountIQD ?? 0
  const days = useMemo(() => {
    const groups = new Map<string, Expense[]>()
    for (const e of d?.expenses ?? []) { const k = toInputDate(e.spentAt); groups.set(k, [...(groups.get(k) ?? []), e]) }
    return [...groups.entries()]
  }, [d])

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <PageHeader title={t('exp.title')} subtitle={t('exp.subtitle')}
        actions={canManage && <Button variant="primary" icon={<Plus className="size-5" />} onClick={() => setEditing('new')}>{t('exp.new')}</Button>} />
      <div className="flex items-center gap-2">
        <IconButton label={t('exp.prev_month')} onClick={() => step(-1)}><ChevronLeft className="size-5 rtl:rotate-180" /></IconButton>
        <span className="min-w-40 text-center font-semibold">{monthYear(new Date(ym.y, ym.m, 1), lang)}</span>
        <IconButton label={t('exp.next_month')} disabled={isThisMonth} onClick={() => step(1)}><ChevronRight className="size-5 rtl:rotate-180" /></IconButton>
      </div>
      {!d ? <div className="grid h-60 place-items-center"><Spinner className="size-9" /></div> : (
        <>
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <Card className="flex flex-col justify-between gap-3">
              <div>
                <div className="text-sm text-fg-2">{t('exp.spent', { month: monthYear(new Date(ym.y, ym.m, 1), lang) })}</div>
                <Amt n={d.totalIQD} className="font-serif text-3xl font-semibold" />
              </div>
              {d.delegateIQD > 0 && <p className="flex items-start gap-2 text-xs text-fg-2"><Truck className="size-4 shrink-0 text-gold-text" />{t('exp.delegates', { amount: fmt(d.delegateIQD) })}</p>}
            </Card>
            <Card>
              <h2 className="mb-3 font-semibold">{t('exp.by_category')}</h2>
              {!d.byCategory.length ? <p className="text-sm text-fg-2">{t('exp.none')}</p> : (
                <ul className="space-y-2.5">
                  {d.byCategory.map((c) => (
                    <li key={c.category}>
                      <div className="flex items-baseline justify-between gap-2 text-sm"><span>{t(`exp.cat_${c.category}`)}</span><Amt n={c.amountIQD} className="font-semibold" /></div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-gold" style={{ width: `${top ? Math.max(3, (c.amountIQD / top) * 100) : 0}%` }} /></div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
          <Card>
            <h2 className="mb-2 font-semibold">{t('exp.list')}</h2>
            {!days.length ? <EmptyState title={t('exp.none')} className="py-10" /> : days.map(([day, list]) => (
              <section key={day} className="mt-3 first:mt-0">
                <h3 className="num mb-1 text-xs font-semibold uppercase tracking-wide text-fg-2">{fmtDate(fromInputDate(day))}</h3>
                <ul className="divide-y divide-line">
                  {list.map((e) => (
                    <li key={e.id}>
                      <button type="button" disabled={!canManage} onClick={() => setEditing(e)} className="flex w-full items-center gap-3 py-2.5 text-start enabled:hover:bg-surface-2/60">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium">{t(`exp.cat_${e.category}`)}</div>
                          <div className="truncate text-xs text-fg-2">{[e.note, t(`pay.${e.method}`), t('exp.by', { name: e.userName })].filter(Boolean).join(' · ')}</div>
                        </div>
                        <div className="text-end">
                          <Money v={e.amount} currency={e.currency} className="font-semibold" />
                          {e.currency === 'USD' && <div className="text-xs text-fg-2">{t('exp.in_iqd', { amount: fmt(e.amountIQD) })}</div>}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </Card>
        </>
      )}
      {editing && <ExpenseEditor expense={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function ExpenseEditor({ expense, onClose }: { expense?: Expense; onClose: () => void }) {
  const t = useT()
  const confirm = useConfirm()
  const { data: settings } = useSettings()
  const [category, setCategory] = useState<ExpenseCategory>(expense?.category ?? 'rent')
  const [currency, setCurrency] = useState<Currency>(expense?.currency ?? 'IQD')
  const [amount, setAmount] = useState(expense ? String(expense.amount) : '')
  const [rate, setRate] = useState(expense?.currency === 'USD' ? String(expense.rate) : '')
  const [method, setMethod] = useState(expense?.method ?? 'cash')
  const [day, setDay] = useState(toInputDate(expense?.spentAt ?? Date.now()))
  const [note, setNote] = useState(expense?.note ?? '')
  const save = useAction(saveExpense, { success: 'exp.saved' })
  const del = useAction(deleteExpense, { success: 'exp.deleted' })
  const shopRate = settings?.currency.rate ?? 1460
  const submit = async () => {
    // keep the time of day when the date did not change; a new date sits at midday
    const spentAt = expense && toInputDate(expense.spentAt) === day ? expense.spentAt : day === toInputDate(Date.now()) ? Date.now() : fromInputDate(day) + 12 * 3_600_000
    const ok = await save({ category, currency, amount: Number(amount), rate: currency === 'USD' ? Number(rate) || shopRate : undefined, method, note, spentAt }, expense?.id)
    if (ok) onClose()
  }
  const remove = async () => {
    if (!expense) return
    if (await confirm({ title: t('exp.delete'), message: t('exp.delete_confirm', { amount: fmtMoney(expense.amount, expense.currency, t) }), danger: true, confirmLabel: t('exp.delete') }) && await del(expense.id)) onClose()
  }
  return (
    <Modal open onClose={onClose} size="md" title={expense ? t('exp.edit') : t('exp.new')}
      footer={(
        <div className="flex w-full items-center justify-between gap-2">
          {expense ? <Button variant="ghost" className="text-danger" icon={<Trash2 className="size-5" />} loading={del.busy} onClick={remove}>{t('exp.delete')}</Button> : <span />}
          <Button variant="primary" size="lg" icon={<Save className="size-5" />} loading={save.busy} disabled={!(Number(amount) > 0)} onClick={submit}>{t('common.save')}</Button>
        </div>
      )}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('exp.category')} className="sm:col-span-2">{(id) => (
          <Select id={id} value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)}>
            {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{t(`exp.cat_${c}`)}</option>)}
          </Select>
        )}</Field>
        <Field label={t('exp.currency')}>{() => <Segmented ariaLabel={t('exp.currency')} value={currency} onChange={setCurrency} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />}</Field>
        <Field label={t('exp.amount')}>{(id) => <Input id={id} inputMode="decimal" className="num" big value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} data-autofocus />}</Field>
        {currency === 'USD' && <Field label={t('exp.rate')}>{(id) => <Input id={id} inputMode="numeric" className="num" placeholder={String(shopRate)} value={rate} onChange={(e) => setRate(e.target.value.replace(/\D/g, ''))} />}</Field>}
        <Field label={t('exp.method')}>{(id) => <Select id={id} value={method} onChange={(e) => setMethod(e.target.value)}>{PAY_METHODS.map((m) => <option key={m} value={m}>{t(`pay.${m}`)}</option>)}</Select>}</Field>
        <Field label={t('exp.date')}>{(id) => <Input id={id} type="date" className="num" value={day} max={toInputDate(Date.now())} onChange={(e) => e.target.value && setDay(e.target.value)} />}</Field>
        <Field label={t('exp.note')} className="sm:col-span-2">{(id) => <Input id={id} value={note} maxLength={500} placeholder={t('exp.note_ph')} onChange={(e) => setNote(e.target.value)} />}</Field>
        {currency === 'USD' && Number(amount) > 0 && <p className="text-sm text-fg-2 sm:col-span-2">{t('exp.in_iqd', { amount: fmt(Math.round(Number(amount) * (Number(rate) || shopRate))) })}</p>}
      </div>
    </Modal>
  )
}
