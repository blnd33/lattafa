import { useEffect, useMemo, useState } from 'react'
import { Check, Plus, X } from 'lucide-react'
import { Amt, UsdAmt } from '@/components/ui/Amt'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { Numpad } from '@/components/ui/Pad'
import { cn } from '@/components/ui/cn'
import { useApproval } from '@/components/ApprovalProvider'
import { useT } from '@/i18n'
import type { PaymentMethod, Sale } from '@/data/types'
import { cashSuggestions, fmt, fmtUSD, parseAmount, usdToIqd } from '@/lib/money'
import { hasPerm } from '@/lib/permissions'
import { completeSale, type CheckoutPayment } from '@/services/sales'
import { useAction } from '@/hooks/queries'
import { useCan } from '@/hooks/useAuth'
import { useSession } from '@/store/session'
import { useCart } from '@/store/cart'
import { toast } from '@/store/toast'
import { METHODS, methodDef } from './helpers'
import type { CartPricing } from './useCartPricing'

export function PaymentModal({ open, onClose, pricing, onDone }: { open: boolean; onClose: () => void; pricing: CartPricing; onDone: (sale: Sale) => void }) {
  const t = useT()
  const cart = useCart()
  const actor = useSession((s) => s.actor)
  const ask = useApproval()
  const canCredit = useCan('customers.credit')
  const { priced, customer, settings, redeem } = pricing
  const total = priced.total
  const rate = settings?.currency.rate ?? 1
  const usdOn = settings?.currency.usdEnabled ?? false

  const [method, setMethod] = useState<PaymentMethod>('cash_iqd')
  const [input, setInput] = useState('')
  const [reference, setReference] = useState('')
  const [pays, setPays] = useState<CheckoutPayment[]>([])
  const run = useAction(completeSale, { silent: false })

  // A fresh payment session each time the modal opens (exchange credit is pre-applied).
  useEffect(() => {
    if (!open) return
    setMethod('cash_iqd'); setInput(''); setReference('')
    const credit = cart.returnCredit
    setPays(credit && credit.amountIQD > 0 ? [{ method: 'return_credit', tendered: Math.min(credit.amountIQD, total) }] : [])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const valueOf = (p: CheckoutPayment) => (p.method === 'cash_usd' ? usdToIqd(p.tendered, rate) : Math.round(p.tendered))
  const paid = pays.reduce((a, p) => a + valueOf(p), 0)
  const remaining = Math.max(0, total - paid)
  const change = Math.max(0, paid - total)
  const debtSoFar = pays.filter((p) => p.method === 'debt').reduce((a, p) => a + p.tendered, 0)

  const def = methodDef(method)
  const isUsd = method === 'cash_usd'
  const amount = parseAmount(input)
  const shown = useMemo(() => {
    if (!input) return '0'
    const [a, b] = input.split('.')
    return Number(a || 0).toLocaleString('en-US') + (b !== undefined ? `.${b}` : '')
  }, [input])

  const press = (k: string) => {
    if (k === 'del') return setInput((v) => v.slice(0, -1))
    if (k === '.') return setInput((v) => (isUsd && !v.includes('.') ? (v || '0') + '.' : v))
    if (k === '000' && !input) return
    setInput((v) => {
      if (isUsd && v.includes('.') && v.split('.')[1].length >= 2) return v
      if (v.length >= 11) return v
      return (v === '0' ? '' : v) + k
    })
  }

  const exactValue = () => (isUsd ? String(Math.ceil((remaining / rate) * 100) / 100) : String(remaining))
  const quick: { label: string; value: string }[] = isUsd
    ? [{ label: t('pay.exact'), value: exactValue() }, ...[20, 50, 100].map((v) => ({ label: `$${v}`, value: String(v) }))]
    : method === 'cash_iqd' && remaining > 0
      ? cashSuggestions(remaining).map((v, i) => ({ label: i === 0 ? t('pay.exact') : fmt(v), value: String(v) }))
      : [{ label: t('pay.exact'), value: String(remaining) }]

  const addPayment = (override?: string) => {
    const amt = override !== undefined ? parseAmount(override) : amount
    if (!(amt > 0)) return
    if (method === 'debt') {
      if (!customer) return toast.error(t('err.customer_required_for_debt'))
      if (!canCredit) return toast.error(t('err.forbidden'))
      if (customer.balanceIQD + debtSoFar + amt > customer.creditLimitIQD) return toast.error(t('err.credit_limit_exceeded', { limit: fmt(customer.creditLimitIQD), balance: fmt(customer.balanceIQD) }))
    }
    if (remaining <= 0 && !def.cash) return
    const tendered = def.cash ? amt : Math.min(amt, remaining)
    setPays((p) => [...p, { method, tendered, reference: reference.trim() }])
    setInput(''); setReference('')
  }

  const complete = async () => {
    if (remaining > 0 || !actor) return
    // Over-limit discounts need a supervisor's PIN (asked once, remembered for this bill)
    let approvedBy = cart.approvedBy
    const over = priced.effectiveDiscountPct > actor.limits.maxDiscountPct + 1e-9 && !hasPerm(actor.permissions, 'sales.discount.above_limit')
    if (over && !approvedBy) {
      approvedBy = await ask('sales.discount.above_limit', t('sell.needs_approval', { n: actor.limits.maxDiscountPct }))
      if (!approvedBy) return
      cart.setApprovedBy(approvedBy)
    }
    const sale = await run({
      lines: cart.lines.map((l) => ({ variantId: l.variantId, qty: l.qty, discountPct: l.discountPct })),
      customerId: cart.customerId,
      orderDiscount: cart.orderDiscount,
      giftWrap: cart.giftWrap,
      redeemPoints: redeem,
      payments: pays,
      note: cart.note,
      approvedBy,
      returnCreditIQD: cart.returnCredit?.amountIQD,
    })
    if (sale) onDone(sale)
  }

  const methods = METHODS.filter((m) => m.id !== 'cash_usd' || usdOn)
  const disabledReason = (id: PaymentMethod): string | null => {
    if (id === 'debt' && !customer) return t('pay.debt_needs_customer')
    if (id === 'debt' && !canCredit) return t('err.forbidden')
    return null
  }

  return (
    <Modal open={open} onClose={onClose} title={t('pay.title')} size="xl" bodyClassName="p-0 md:overflow-hidden" className="md:h-[min(40rem,90dvh)]"
      footer={
        <div className="space-y-2">
          {change > 0 && <div className="rounded-xl bg-ok-bg px-4 py-2 text-center text-sm font-semibold text-ok-fg sm:hidden">{t('pay.give_change')} <Amt n={change} /></div>}
          <div className="flex items-center justify-between gap-3">
            <Button size="lg" variant="ghost" onClick={onClose}>{t('common.back')}</Button>
            <div className="flex items-center gap-3">
              {change > 0 && <span className="hidden text-sm sm:block">{t('pay.give_change')} <Amt n={change} className="font-bold text-ok-fg" /></span>}
              <Button size="xl" variant="primary" icon={<Check className="size-6" />} disabled={remaining > 0 || (!pays.length && total > 0)} loading={run.busy} onClick={complete}>{t('pay.complete')}</Button>
            </div>
          </div>
        </div>
      }>
      <div className="grid md:h-full md:grid-cols-[17.5rem_1fr_19rem]">
        {/* summary */}
        <aside className="flex flex-col gap-3 bg-gradient-to-b from-charcoal to-ink p-5 text-[#f6f0e4] md:overflow-y-auto">
          <div>
            <div className="text-xs uppercase tracking-widest text-[#b9ae9c] rtl:tracking-normal">{t('pay.due')}</div>
            <Amt n={total} className="font-serif text-4xl font-semibold leading-tight text-gold" unitClassName="font-sans text-sm text-[#b9ae9c]" />
            {usdOn && <div className="text-sm text-[#b9ae9c]">≈ <UsdAmt n={total / rate} /></div>}
          </div>
          <div className="border-t border-gold-light/25" />
          <div className="text-xs uppercase tracking-widest text-[#b9ae9c] rtl:tracking-normal">{t('pay.payments')}</div>
          <ul className="flex min-h-10 flex-1 flex-col gap-2">
            {pays.length === 0 && <li className="py-3 text-center text-sm text-[#8f857a]">{t('pay.none_yet')}</li>}
            {pays.map((p, i) => {
              const d = methodDef(p.method)
              return (
                <li key={i} className="flex items-center gap-2.5 rounded-xl bg-white/10 p-2">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-gold/20 text-gold"><d.icon className="size-[18px]" /></span>
                  <span className="min-w-0 flex-1 text-sm leading-tight">
                    {t(`method.${p.method}`)}
                    <span className="num block text-xs text-[#b9ae9c]">{p.method === 'cash_usd' ? `$${fmtUSD(p.tendered)} → ` : ''}{fmt(valueOf(p))} {t('unit.iqd')}{p.reference ? ` · ${p.reference}` : ''}</span>
                  </span>
                  {p.method !== 'return_credit' && <button type="button" aria-label={t('common.remove')} onClick={() => setPays((x) => x.filter((_, j) => j !== i))} className="grid size-10 place-items-center rounded-lg text-[#e8a29a] hover:bg-white/10"><X className="size-4" /></button>}
                </li>
              )
            })}
          </ul>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-white/10 p-3"><div className="text-[11px] uppercase text-[#b9ae9c]">{t('pay.remaining')}</div><Amt n={remaining} unit={false} className={cn('text-xl font-semibold', remaining > 0 && 'text-gold')} /></div>
            <div className="rounded-xl bg-white/10 p-3"><div className="text-[11px] uppercase text-[#b9ae9c]">{t('pay.change')}</div><Amt n={change} unit={false} className={cn('text-xl font-semibold', change > 0 && 'text-[#7bd3a0]')} /></div>
          </div>
        </aside>

        {/* methods */}
        <div className="p-4 md:overflow-y-auto md:p-5">
          <div className="grid grid-cols-3 gap-2.5 md:grid-cols-2 md:gap-3">
            {methods.map((m) => {
              const why = disabledReason(m.id)
              return (
                <button
                  key={m.id}
                  type="button"
                  disabled={!!why}
                  aria-pressed={method === m.id}
                  onClick={() => { setMethod(m.id); setInput('') }}
                  className={cn('flex min-h-24 flex-col items-center justify-center gap-1.5 rounded-2xl border-2 p-2 text-center text-sm font-semibold transition disabled:opacity-40 md:min-h-[6.5rem]', method === m.id ? 'border-gold bg-gold-soft text-[#6b4e12] shadow-[0_0_0_3px_rgba(212,165,72,.2)] dark:bg-gold/15 dark:text-gold-light' : 'border-line bg-surface hover:border-gold-light')}
                >
                  <m.icon className="size-7" />
                  {t(`method.${m.id}`)}
                  {m.id === 'cash_usd' && <span className="num text-[11px] font-normal text-fg-2">$1 = {fmt(rate)}</span>}
                  {why && <span className="text-[10px] font-normal leading-tight text-fg-2">{why}</span>}
                </button>
              )
            })}
          </div>
        </div>

        {/* amount entry */}
        <div className="space-y-3 border-t border-line p-4 md:border-s md:border-t-0 md:overflow-y-auto md:p-5">
          <div className="flex h-16 items-center justify-between rounded-2xl border-2 border-gold-light bg-surface-2 px-4">
            <span className="rounded-full bg-ink px-2.5 py-1 text-[11px] font-bold tracking-wider text-gold dark:bg-gold dark:text-ink">{def.currency}</span>
            <span dir="ltr" className="num text-3xl font-semibold">{isUsd ? '$' : ''}{shown}</span>
          </div>
          <div className="flex gap-2">
            {quick.map((q) => (
              <button key={q.label} type="button" onClick={() => setInput(q.value)} className="num h-11 min-w-0 flex-1 truncate rounded-xl bg-surface-2 px-1 text-xs font-semibold transition hover:bg-gold-soft dark:hover:bg-charcoal">{q.label}</button>
            ))}
          </div>
          <Numpad onKey={press} extra={isUsd ? '.' : '000'} compact />
          {(method === 'card' || method === 'fib' || method === 'zain') && (
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder={t('pay.reference')} aria-label={t('pay.reference')} />
          )}
          <Button size="lg" block variant="secondary" icon={<Plus className="size-5" />} disabled={!(amount > 0)} onClick={() => addPayment()}>{t('pay.add')}</Button>
        </div>
      </div>

    </Modal>
  )
}

