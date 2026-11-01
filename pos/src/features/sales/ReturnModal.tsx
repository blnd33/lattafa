import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Minus, Plus, Undo2 } from 'lucide-react'
import { Amt } from '@/components/ui/Amt'
import { Button, IconButton } from '@/components/ui/Button'
import { Checkbox, Segmented } from '@/components/ui/Controls'
import { Modal } from '@/components/ui/Modal'
import { cn } from '@/components/ui/cn'
import { useApproval } from '@/components/ApprovalProvider'
import { pick, useT } from '@/i18n'
import type { Sale } from '@/data/types'
import { hasPerm } from '@/lib/permissions'
import { createReturn, returnableQty, unitRefund, type RefundMethod } from '@/services/returns'
import { useAction, useSettings } from '@/hooks/queries'
import { useActor } from '@/hooks/useAuth'
import { useCart } from '@/store/cart'
import { useUI } from '@/store/ui'
import { toast } from '@/store/toast'

const REASONS = ['changed', 'defective', 'wrong', 'other'] as const

/**
 * Return / exchange. Refund per unit is what the customer actually paid for it (after
 * line + bill discounts). Refunds above the cashier's limit, or outside the return
 * window, need a supervisor's PIN.
 */
export function ReturnModal({ sale, onClose, onDone }: { sale: Sale | null; onClose: () => void; onDone?: () => void }) {
  const t = useT()
  const lang = useUI((s) => s.lang)
  const navigate = useNavigate()
  const ask = useApproval()
  const actor = useActor()
  const { data: settings } = useSettings()
  const setCredit = useCart((s) => s.setReturnCredit)
  const run = useAction(createReturn)

  const [qty, setQty] = useState<Record<number, number>>({})
  const [restock, setRestock] = useState<Record<number, boolean>>({})
  const [reason, setReason] = useState<(typeof REASONS)[number]>('changed')
  const [method, setMethod] = useState<RefundMethod>('cash_iqd')

  useEffect(() => { if (sale) { setQty({}); setRestock({}); setReason('changed'); setMethod(sale.dueIQD > 0 && sale.customerId ? 'debt_reduction' : 'cash_iqd') } }, [sale?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const refund = useMemo(() => (sale ? sale.items.reduce((a, _it, i) => a + (qty[i] ?? 0) * unitRefund(sale, i), 0) : 0), [sale, qty])
  if (!sale) return null

  const methods: RefundMethod[] = ['cash_iqd', 'card', 'fib', 'zain', 'store_credit', ...(sale.customerId ? (['debt_reduction'] as const) : [])]
  const ageDays = (Date.now() - sale.createdAt) / 86_400_000
  const late = settings ? ageDays > settings.sales.returnWindowDays : false
  const chosen = Object.values(qty).some((q) => q > 0)

  const confirm = async () => {
    if (!actor || !chosen) return
    let approvedBy: { id: string; name: string } | null = null
    const exceeds = refund > actor.limits.maxRefundIQD || late
    if (exceeds && !hasPerm(actor.permissions, 'returns.above_limit')) {
      approvedBy = await ask('returns.above_limit', late ? t('ret.late_approval') : t('ret.limit_approval'))
      if (!approvedBy) return
    }
    const ret = await run({
      saleId: sale.id,
      lines: sale.items.map((_it, i) => ({ saleItemIndex: i, qty: qty[i] ?? 0, restock: restock[i] ?? true, reason })).filter((l) => l.qty > 0),
      refundMethod: method,
      note: t(`ret.reason_${reason}`),
      approvedBy,
    })
    if (!ret) return
    toast.success(t('ret.done', { number: ret.number }))
    onDone?.()
    onClose()
    if (method === 'store_credit') { setCredit({ amountIQD: ret.refundIQD, fromReturn: ret.number }); navigate('/sell') }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`${t('ret.title')} · ${sale.number}`}
      size="lg"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><div className="text-xs text-fg-2">{t('ret.refund_total')}</div><Amt n={refund} className="font-serif text-2xl font-semibold text-gold-text" /></div>
          <Button size="xl" variant="primary" icon={<Undo2 className="size-5" />} disabled={!chosen || refund <= 0} loading={run.busy} onClick={confirm}>{method === 'store_credit' ? t('ret.exchange') : t('ret.confirm')}</Button>
        </div>
      }
    >
      <div className="space-y-5">
        {late && <p className="rounded-xl bg-warn-bg px-3 py-2 text-sm text-warn-fg">{t('ret.window_note', { days: settings?.sales.returnWindowDays ?? 0 })}</p>}
        <section>
          <h3 className="mb-2 text-sm font-semibold">{t('ret.select_items')}</h3>
          <ul className="divide-y divide-line rounded-2xl border border-line">
            {sale.items.map((it, i) => {
              const max = returnableQty(sale, i)
              const q = qty[i] ?? 0
              return (
                <li key={i} className={cn('flex flex-wrap items-center gap-3 p-3', max === 0 && 'opacity-50')}>
                  <Checkbox checked={q > 0} disabled={max === 0} label={pick(it.name, lang)} onChange={(v) => setQty({ ...qty, [i]: v ? max : 0 })} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{pick(it.name, lang)} <span className="num text-sm font-normal text-fg-2">{it.label}</span></div>
                    <div className="text-xs text-fg-2"><Amt n={unitRefund(sale, i)} /> × <span className="num">{it.qty}</span>{it.returnedQty > 0 && <span className="text-warn-fg"> · {t('ret.already', { n: it.returnedQty })}</span>}</div>
                  </div>
                  {max > 0 && (
                    <div className="flex items-center gap-2">
                      <div className="flex items-center rounded-xl bg-surface-2">
                        <IconButton label="−" variant="ghost" onClick={() => setQty({ ...qty, [i]: Math.max(0, q - 1) })}><Minus className="size-4" /></IconButton>
                        <span className="num w-8 text-center font-bold">{q}</span>
                        <IconButton label="+" variant="ghost" onClick={() => setQty({ ...qty, [i]: Math.min(max, q + 1) })}><Plus className="size-4" /></IconButton>
                      </div>
                      <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs font-medium text-fg-2">
                        <Checkbox checked={restock[i] ?? true} label={t('ret.restock')} onChange={(v) => setRestock({ ...restock, [i]: v })} />
                        {t('ret.restock')}
                      </label>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
        <section>
          <h3 className="mb-2 text-sm font-semibold">{t('ret.reason')}</h3>
          <Segmented value={reason} onChange={setReason} options={REASONS.map((r) => ({ value: r, label: t(`ret.reason_${r}`) }))} />
        </section>
        <section>
          <h3 className="mb-2 text-sm font-semibold">{t('ret.refund_method')}</h3>
          <div className="flex flex-wrap gap-2">
            {methods.map((m) => (
              <button key={m} type="button" aria-pressed={method === m} onClick={() => setMethod(m)} className={cn('min-h-11 rounded-xl border px-4 text-sm font-medium transition', method === m ? 'border-gold bg-gold-soft text-[#6b4e12] dark:bg-gold/15 dark:text-gold-light' : 'border-line hover:border-gold-light')}>{t(`ret.method_${m}`)}</button>
            ))}
          </div>
          {method === 'store_credit' && <p className="mt-2 text-xs text-fg-2">{t('ret.exchange_hint')}</p>}
        </section>
      </div>
    </Modal>
  )
}
