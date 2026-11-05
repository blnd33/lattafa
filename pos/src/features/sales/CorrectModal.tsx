import { useMemo, useState } from 'react'
import { Minus, Pencil, Plus, Trash2 } from 'lucide-react'
import { Amt } from '@/components/ui/Amt'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { cn } from '@/components/ui/cn'
import { pick, useT } from '@/i18n'
import type { Sale } from '@/data/types'
import { parseAmount } from '@/lib/money'
import { priceCart } from '@/lib/pricing'
import { correctSale } from '@/services/sales'
import { useAction, useSettings } from '@/hooks/queries'
import { useUI } from '@/store/ui'

interface Line { qty: number; price: string }

/**
 * Putting a cashier's slip right — Super Admin only. Change how many, change a price, or take a line off; the bill
 * is cancelled and written again with the corrected figures, so stock and the day's takings follow. No money moves:
 * this is for a bill rung up wrong, where the right amount was handed over.
 */
export function CorrectModal({ sale, onClose, onDone }: { sale: Sale; onClose: () => void; onDone: () => void }) {
  const t = useT()
  const lang = useUI((s) => s.lang)
  const { data: settings } = useSettings()
  const run = useAction(correctSale, { success: 'sales.corrected_ok' })
  const [lines, setLines] = useState<Line[]>(() => sale.items.map((it) => ({ qty: it.qty, price: String(it.unitPriceIQD) })))
  const [reason, setReason] = useState('')

  const set = (i: number, patch: Partial<Line>) => setLines((l) => l.map((x, k) => (k === i ? { ...x, ...patch } : x)))
  const priceOf = (l: Line) => Math.max(0, Math.round(parseAmount(l.price) || 0))

  // the same sum the server will do, so the figure shown is the figure recorded
  const total = useMemo(() => priceCart({
    lines: lines.map((l, i) => ({ key: String(i), unitPriceIQD: priceOf(l), qty: l.qty, discountPct: sale.items[i].discountPct })).filter((l) => l.qty > 0),
    orderDiscount: sale.orderDiscount,
    giftWrapIQD: sale.giftWrapIQD,
    rounding: settings?.currency.rounding ?? 0,
  }).total, [lines, sale, settings])

  const changed = lines.some((l, i) => l.qty !== sale.items[i].qty || priceOf(l) !== sale.items[i].unitPriceIQD)
  const empty = lines.every((l) => l.qty === 0)

  const submit = async () => {
    const payload = lines.map((l, i) => ({ index: i, qty: l.qty, unitPriceIQD: priceOf(l) }))
    if (await run(sale.id, payload, reason)) onDone()
  }

  return (
    <Modal open onClose={onClose} title={t('sales.correct_title')} size="lg" dismissible
      footer={
        <div className="flex items-center justify-between gap-3">
          <Button size="lg" variant="ghost" onClick={onClose}>{t('common.back')}</Button>
          <div className="flex items-center gap-3">
            <span className="text-sm text-fg-2">{t('sales.correct_new_total')} <Amt n={total} className="font-bold text-gold-text" /></span>
            <Button size="xl" variant="primary" icon={<Pencil className="size-5" />} loading={run.busy}
              disabled={!changed || empty || !reason.trim()} onClick={() => void submit()}>{t('sales.correct_do')}</Button>
          </div>
        </div>
      }>
      <div className="space-y-4">
        <p className="rounded-xl bg-surface-2 p-3 text-sm text-fg-2">{t('sales.correct_hint')}</p>

        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
          {sale.items.map((it, i) => {
            const l = lines[i]
            const off = l.qty === 0
            return (
              <li key={i} className={cn('flex flex-wrap items-center gap-3 p-3', off && 'opacity-50')}>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{pick(it.name, lang)}</p>
                  <p className="num text-xs text-fg-2">{it.label} · {t('sales.correct_was', { n: it.qty })} <Amt n={it.unitPriceIQD} /></p>
                </div>
                <div className="flex items-center gap-1">
                  <IconButton label={t('common.less')} variant="ghost" onClick={() => set(i, { qty: Math.max(0, l.qty - 1) })}><Minus className="size-4" /></IconButton>
                  <span className="num w-8 text-center font-semibold">{l.qty}</span>
                  <IconButton label={t('common.more')} variant="ghost" onClick={() => set(i, { qty: l.qty + 1 })}><Plus className="size-4" /></IconButton>
                </div>
                <Input dir="ltr" inputMode="numeric" aria-label={`${pick(it.name, lang)} — ${t('sales.correct_price')}`}
                  className="num !h-11 !w-28 text-end" value={l.price} onChange={(e) => set(i, { price: e.target.value })} />
                <IconButton label={t('sales.correct_remove')} variant="ghost" className="text-danger" onClick={() => set(i, { qty: 0 })}><Trash2 className="size-4" /></IconButton>
              </li>
            )
          })}
        </ul>

        <Field label={t('sales.correct_reason')} hint={t('sales.correct_reason_hint')}>
          {(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('sales.correct_reason_ph')} />}
        </Field>
      </div>
    </Modal>
  )
}
