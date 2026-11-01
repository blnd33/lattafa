import { useEffect, useMemo, useState } from 'react'
import { Check, Clock, Play, Plus, Trash2, UserX } from 'lucide-react'
import { Amt } from '@/components/ui/Amt'
import { Avatar, Badge, EmptyState, Segmented } from '@/components/ui/Controls'
import { Button, IconButton } from '@/components/ui/Button'
import { Field, Input, SearchInput, Select, Textarea } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { cn } from '@/components/ui/cn'
import { useT } from '@/i18n'
import type { CustomerType, Hold } from '@/data/types'
import { fmtTime } from '@/lib/date'
import { fmt, parseAmount } from '@/lib/money'
import type { OrderDiscount } from '@/lib/pricing'
import { saveCustomer } from '@/services/customers'
import { useAction, useCustomers } from '@/hooks/queries'
import { useCan } from '@/hooks/useAuth'
import { toast } from '@/store/toast'
import { useCart } from '@/store/cart'

/* ───────── discount (line or order) ───────── */

const PRESETS = [0, 5, 10, 15, 20]

export function DiscountModal({
  open, onClose, title, initial, allowFixed, limitPct, canExceed, onApply,
}: {
  open: boolean
  onClose: () => void
  title: string
  initial: OrderDiscount | null
  allowFixed: boolean
  limitPct: number
  canExceed: boolean
  onApply: (d: OrderDiscount | null) => void
}) {
  const t = useT()
  const [type, setType] = useState<'pct' | 'fixed'>('pct')
  const [value, setValue] = useState('')
  useEffect(() => {
    if (open) { setType(initial?.type ?? 'pct'); setValue(initial ? String(initial.value) : '') }
  }, [open, initial])
  const n = parseAmount(value)
  const overLimit = type === 'pct' && n > limitPct && !canExceed
  const apply = (d: OrderDiscount | null) => { onApply(d); onClose() }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <div className="flex gap-2">
          <Button size="lg" variant="secondary" className="flex-1" onClick={() => apply(null)}>{t('sell.remove_discount')}</Button>
          <Button size="lg" variant="primary" className="flex-1" icon={<Check className="size-5" />} onClick={() => apply(n > 0 ? { type, value: type === 'pct' ? Math.min(100, n) : Math.round(n) } : null)}>{t('common.apply')}</Button>
        </div>
      }
    >
      <div className="space-y-4">
        {allowFixed && <Segmented value={type} onChange={setType} options={[{ value: 'pct', label: '%' }, { value: 'fixed', label: t('unit.iqd') }]} className="w-full [&>button]:flex-1" />}
        {type === 'pct' && (
          <div className="grid grid-cols-5 gap-2">
            {PRESETS.map((p) => (
              <button key={p} type="button" onClick={() => setValue(String(p))} className={cn('num h-12 rounded-xl text-sm font-semibold transition', n === p ? 'bg-gold text-ink' : 'bg-surface-2 hover:bg-gold-soft dark:hover:bg-charcoal')}>{p}%</button>
            ))}
          </div>
        )}
        <Field label={type === 'pct' ? t('sell.discount_pct') : t('sell.discount_amount')}>
          {(id) => <Input id={id} big inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ''))} className="num text-center" data-autofocus />}
        </Field>
        {type === 'fixed' && n > 0 && <p className="text-xs text-fg-2"><Amt n={n} /></p>}
        <p className={cn('rounded-xl px-3 py-2 text-xs', overLimit ? 'bg-warn-bg text-warn-fg' : 'bg-surface-2 text-fg-2')}>
          {overLimit ? t('sell.needs_approval', { n: limitPct }) : t('sell.your_limit', { n: canExceed ? '∞' : limitPct })}
        </p>
      </div>
    </Modal>
  )
}

/* ───────── note ───────── */

export function NoteModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT()
  const note = useCart((s) => s.note)
  const setNote = useCart((s) => s.setNote)
  const [v, setV] = useState('')
  useEffect(() => { if (open) setV(note) }, [open, note])
  return (
    <Modal open={open} onClose={onClose} title={t('sell.note')} size="sm" footer={<Button size="lg" variant="primary" block onClick={() => { setNote(v.trim()); onClose() }}>{t('common.save')}</Button>}>
      <Textarea value={v} onChange={(e) => setV(e.target.value)} placeholder={t('sell.note_ph')} rows={4} data-autofocus />
    </Modal>
  )
}

/* ───────── customer picker + quick add ───────── */

export function CustomerPicker({ open, onClose, selectedId, onPick }: { open: boolean; onClose: () => void; selectedId: string | null; onPick: (id: string | null) => void }) {
  const t = useT()
  const { data: customers = [] } = useCustomers()
  const canCreate = useCan('customers.create')
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [f, setF] = useState({ name: '', phone: '', type: 'retail' as CustomerType, city: '' })
  const save = useAction(saveCustomer)
  useEffect(() => { if (open) { setQ(''); setAdding(false); setF({ name: '', phone: '', type: 'retail', city: '' }) } }, [open])

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return customers.filter((c) => !s || c.name.toLowerCase().includes(s) || c.phone.replace(/\s/g, '').includes(s.replace(/\s/g, ''))).slice(0, 40)
  }, [customers, q])

  const create = async () => {
    const c = await save({ name: f.name, phone: f.phone, type: f.type, city: f.city, notes: '', creditLimitIQD: 0 })
    if (c) { toast.success(t('cust.saved')); onPick(c.id); onClose() }
  }

  return (
    <Modal open={open} onClose={onClose} title={adding ? t('cust.new') : t('sell.pick_customer')} size="md" bodyClassName="p-0">
      {adding ? (
        <div className="space-y-4 p-5">
          <Field label={t('common.name')}>{(id) => <Input id={id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-autofocus />}</Field>
          <Field label={t('common.phone')}>{(id) => <Input id={id} type="tel" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} className="num" />}</Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('cust.type')}>{(id) => <Select id={id} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as CustomerType })}>{(['retail', 'shop', 'wholesale'] as const).map((x) => <option key={x} value={x}>{t(`cust.type_${x}`)}</option>)}</Select>}</Field>
            <Field label={t('common.city')}>{(id) => <Input id={id} value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} />}</Field>
          </div>
          <div className="flex gap-2 pt-1">
            <Button size="lg" variant="secondary" className="flex-1" onClick={() => setAdding(false)}>{t('common.back')}</Button>
            <Button size="lg" variant="primary" className="flex-1" loading={save.busy} disabled={!f.name.trim()} onClick={create}>{t('common.save')}</Button>
          </div>
        </div>
      ) : (
        <div className="flex max-h-[70dvh] flex-col">
          <div className="flex gap-2 border-b border-line p-3">
            <SearchInput className="flex-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('cust.search')} data-autofocus />
            {canCreate && <Button variant="primary" icon={<Plus className="size-5" />} onClick={() => { setAdding(true); setF({ ...f, name: /\d/.test(q) ? '' : q, phone: /\d/.test(q) ? q : '' }) }}>{t('common.new')}</Button>}
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto p-2">
            <li>
              <button type="button" onClick={() => { onPick(null); onClose() }} className={cn('flex min-h-14 w-full items-center gap-3 rounded-xl px-3 text-start transition hover:bg-surface-2', !selectedId && 'bg-gold-soft dark:bg-gold/15')}>
                <span className="grid size-10 place-items-center rounded-full bg-surface-2"><UserX className="size-5 text-fg-2" /></span>
                <span className="font-medium">{t('sell.walk_in')}</span>
              </button>
            </li>
            {list.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => { onPick(c.id); onClose() }} className={cn('flex min-h-14 w-full items-center gap-3 rounded-xl px-3 text-start transition hover:bg-surface-2', selectedId === c.id && 'bg-gold-soft dark:bg-gold/15')}>
                  <Avatar name={c.name} color="#D4A548" size={40} />
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate font-semibold">{c.name}</span>
                    <span className="num block truncate text-xs text-fg-2">{c.phone || '—'} · {t(`cust.type_${c.type}`)}</span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    {c.points > 0 && <Badge tone="gold"><span className="num">{c.points}</span> {t('sell.pts')}</Badge>}
                    {c.balanceIQD > 0 && <Badge tone="danger">{t('sell.owes')} <span className="num">{fmt(c.balanceIQD)}</span></Badge>}
                  </span>
                </button>
              </li>
            ))}
            {list.length === 0 && <EmptyState title={t('cust.none')} className="py-8" />}
          </ul>
        </div>
      )}
    </Modal>
  )
}

/* ───────── held bills ───────── */

export function HoldsModal({ open, onClose, holds, nameOf, totalOf, onResume, onDelete }: {
  open: boolean
  onClose: () => void
  holds: Hold[]
  nameOf: (variantId: string) => string
  totalOf: (h: Hold) => number
  onResume: (h: Hold) => void
  onDelete: (h: Hold) => void
}) {
  const t = useT()
  return (
    <Modal open={open} onClose={onClose} title={t('sell.held_bills')} size="md">
      {holds.length === 0 ? (
        <EmptyState title={t('sell.no_holds')} hint={t('sell.no_holds_hint')} className="py-8" />
      ) : (
        <ul className="space-y-2.5">
          {holds.map((h) => (
            <li key={h.id} className="flex items-center gap-3 rounded-2xl border border-line p-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-surface-2 text-gold-text"><Clock className="size-5" /></span>
              <div className="min-w-0 flex-1 leading-tight">
                <div className="truncate font-semibold">{h.label || t('sell.held_bill')}</div>
                <div className="truncate text-xs text-fg-2"><span className="num">{fmtTime(h.createdAt)}</span> · {h.lines.slice(0, 2).map((l) => nameOf(l.variantId)).join(', ')}{h.lines.length > 2 ? '…' : ''}</div>
              </div>
              <Amt n={totalOf(h)} className="font-bold" />
              <IconButton label={t('common.delete')} variant="ghost" className="text-danger" onClick={() => onDelete(h)}><Trash2 className="size-5" /></IconButton>
              <Button variant="primary" icon={<Play className="size-4" />} onClick={() => onResume(h)}>{t('sell.resume')}</Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}

