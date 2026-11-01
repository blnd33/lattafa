import { Clock, Gift, Minus, Pause, Percent, Plus, StickyNote, Trash2, UserRound, X, Gem } from 'lucide-react'
import { Amt, UsdAmt } from '@/components/ui/Amt'
import { Avatar, Badge, EmptyState } from '@/components/ui/Controls'
import { Button, IconButton } from '@/components/ui/Button'
import { Switch } from '@/components/ui/Controls'
import { ProductImage } from '@/components/ui/Brand'
import { cn } from '@/components/ui/cn'
import { pick, useT } from '@/i18n'
import { fmt } from '@/lib/money'
import { useCart } from '@/store/cart'
import { useUI } from '@/store/ui'
import { toast } from '@/store/toast'
import { useCan } from '@/hooks/useAuth'
import type { CartPricing } from './useCartPricing'

interface Props {
  pricing: CartPricing
  holdCount: number
  onPay: () => void
  onHold: () => void
  onHolds: () => void
  onClear: () => void
  onCustomer: () => void
  onLineDiscount: (variantId: string) => void
  onOrderDiscount: () => void
  onNote: () => void
  onClose?: () => void
  className?: string
}

/** The open bill: customer, lines, totals and the big Pay button. Used inline on desktop and inside a sheet on phones/tablets. */
export function CartPanel({ pricing, holdCount, onPay, onHold, onHolds, onClear, onCustomer, onLineDiscount, onOrderDiscount, onNote, onClose, className }: Props) {
  const t = useT()
  const lang = useUI((s) => s.lang)
  const cart = useCart()
  const { lines, priced, customer, settings, units, redeem, maxRedeem, pointValue } = pricing
  const canDiscount = useCan('sales.discount.item')
  const canOrderDiscount = useCan('sales.discount.order')
  const canHold = useCan('pos.hold')
  const rate = settings?.currency.rate ?? 1
  const allowNeg = settings?.sales.allowNegativeStock ?? false

  const bump = (variantId: string, delta: number, stock: number) => {
    const line = lines.find((l) => l.variantId === variantId)
    if (!line) return
    const next = line.qty + delta
    if (delta > 0 && !allowNeg && next > stock) { toast.error(t('sell.only_n_left', { n: stock })); return }
    cart.setQty(variantId, next)
  }

  return (
    <section className={cn('flex min-h-0 flex-col bg-surface', className)} aria-label={t('sell.current_sale')}>
      <header className="flex shrink-0 flex-col gap-2.5 border-b border-line px-4 pb-3 pt-3.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <h2 className="whitespace-nowrap font-serif text-lg font-semibold sm:text-xl">{t('sell.current_sale')}</h2>
            <Badge tone="gold"><span className="num">{units}</span> {t('sell.items')}</Badge>
          </div>
          <div className="flex items-center gap-1">
            {canHold && (
              <button type="button" onClick={onHolds} className="relative flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-fg-2 transition hover:bg-surface-2 hover:text-fg">
                <Clock className="size-4" />{t('sell.held')}
                {holdCount > 0 && <span className="num absolute -end-0.5 -top-0.5 grid size-5 place-items-center rounded-full bg-gold text-[11px] font-bold text-ink">{holdCount}</span>}
              </button>
            )}
            {onClose && <IconButton label={t('common.close')} variant="ghost" onClick={onClose}><X className="size-5" /></IconButton>}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={onCustomer} className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-xl bg-surface-2 px-3 text-start transition hover:bg-gold-soft dark:hover:bg-charcoal">
            {customer ? <Avatar name={customer.name} color="#D4A548" size={34} /> : <span className="grid size-[34px] shrink-0 place-items-center rounded-full bg-gold-soft text-gold-dark dark:bg-gold/20"><UserRound className="size-[18px]" /></span>}
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-sm font-semibold">{customer ? customer.name : t('sell.walk_in')}</span>
              <span className="block truncate text-xs text-fg-2">
                {customer ? (
                  <>
                    <span className="num">{customer.phone || '—'}</span>
                    {settings?.loyalty.enabled && <> · <span className="num">{customer.points}</span> {t('sell.pts')}</>}
                    {customer.balanceIQD > 0 && <span className="text-danger"> · {t('sell.owes')} <span className="num">{fmt(customer.balanceIQD)}</span></span>}
                  </>
                ) : t('sell.attach_customer')}
              </span>
            </span>
          </button>
          {customer && <IconButton label={t('sell.detach_customer')} variant="ghost" onClick={() => cart.setCustomer(null)}><X className="size-5" /></IconButton>}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-1">
        {lines.length === 0 ? (
          <EmptyState title={t('sell.cart_empty')} hint={t('sell.cart_empty_hint')} className="py-10" />
        ) : (
          <ul className="divide-y divide-dashed divide-line">
            {lines.map((l) => (
              <li key={l.variantId} className="grid grid-cols-[3.25rem_1fr_auto] items-start gap-3 py-3">
                <ProductImage product={l.ref.product} className="h-16 rounded-xl" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{pick(l.ref.product.name, lang)}</div>
                  <div className="text-xs text-fg-2"><span className="num">{l.ref.variant.label}</span> · <Amt n={l.unit} unit={false} /></div>
                  <div className="mt-2 flex items-center gap-1.5">
                    <div className="flex items-center rounded-xl bg-surface-2">
                      <button type="button" aria-label="−" onClick={() => bump(l.variantId, -1, l.ref.variant.stock)} className="grid size-11 place-items-center rounded-xl transition active:bg-gold-soft dark:active:bg-charcoal"><Minus className="size-4" /></button>
                      <input
                        aria-label={t('sell.qty')}
                        inputMode="numeric"
                        value={l.qty}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => {
                          const n = parseInt(e.target.value.replace(/\D/g, ''), 10)
                          if (Number.isNaN(n)) return
                          if (!allowNeg && n > l.ref.variant.stock) { toast.error(t('sell.only_n_left', { n: l.ref.variant.stock })); cart.setQty(l.variantId, l.ref.variant.stock); return }
                          cart.setQty(l.variantId, n)
                        }}
                        className="num w-9 bg-transparent text-center text-sm font-bold outline-none"
                      />
                      <button type="button" aria-label="+" onClick={() => bump(l.variantId, 1, l.ref.variant.stock)} className="grid size-11 place-items-center rounded-xl transition active:bg-gold-soft dark:active:bg-charcoal"><Plus className="size-4" /></button>
                    </div>
                    {canDiscount && (
                      <button type="button" onClick={() => onLineDiscount(l.variantId)} aria-label={t('sell.line_discount')} className={cn('flex h-11 items-center gap-1 rounded-xl px-3 text-xs font-semibold transition', l.discountPct ? 'bg-gold-soft text-[#6b4e12] dark:bg-gold/20 dark:text-gold-light' : 'bg-surface-2 text-fg-2 hover:text-fg')}>
                        <Percent className="size-3.5" /><span className="num">{l.discountPct}</span>
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-0.5 text-end">
                  <div className="text-sm font-bold">
                    {l.discount > 0 && <s className="block text-xs font-normal text-fg-2"><Amt n={l.gross} unit={false} /></s>}
                    <Amt n={l.net} unit={false} />
                  </div>
                  <button type="button" aria-label={t('common.remove')} onClick={() => cart.remove(l.variantId)} className="grid size-11 place-items-center rounded-xl text-danger transition hover:bg-danger-bg"><Trash2 className="size-[18px]" /></button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="shrink-0 space-y-1 border-t border-line px-4 pb-3 pt-2.5">
        <Row label={t('sell.subtotal')} value={<Amt n={priced.subtotal} />} />
        {priced.itemDiscount > 0 && <Row label={t('sell.item_discounts')} value={<span className="text-success">− <Amt n={priced.itemDiscount} /></span>} />}
        {priced.orderDiscount > 0 && <Row label={`${t('sell.order_discount')}${cart.orderDiscount?.type === 'pct' ? ` (${cart.orderDiscount.value}%)` : ''}`} value={<span className="text-success">− <Amt n={priced.orderDiscount} /></span>} />}
        {priced.pointsRedeemed > 0 && <Row label={`${t('sell.points_used')} (${redeem} ${t('sell.pts')})`} value={<span className="text-success">− <Amt n={priced.pointsRedeemed} /></span>} />}
        {priced.tax > 0 && <Row label={`${t('sell.tax')} (${settings?.tax.pct}%)`} value={<Amt n={priced.tax} />} />}
        {cart.giftWrap && settings && <Row label={t('sell.gift_wrap')} value={<Amt n={settings.sales.giftWrapFeeIQD} />} />}
        {customer && settings?.loyalty.enabled && customer.points > 0 && (
          <div className="flex min-h-11 items-center justify-between text-sm">
            <span className="flex items-center gap-2"><Gem className="size-[18px] text-gold-text" />{t('sell.redeem')} <span className="num text-xs text-fg-2">{maxRedeem} {t('sell.pts')} = {fmt(maxRedeem * pointValue)}</span></span>
            <Switch checked={redeem > 0} onChange={(v) => cart.setRedeem(v ? maxRedeem : 0)} label={t('sell.redeem')} disabled={maxRedeem <= 0 && redeem === 0} />
          </div>
        )}
        <div className="flex items-baseline justify-between border-t border-gold-light pt-2.5">
          <span className="font-medium">{t('sell.total')}</span>
          <div className="text-end">
            <Amt n={priced.total} className="font-serif text-4xl font-semibold leading-none text-gold-text" unitClassName="font-sans text-sm text-fg-2" />
            {settings?.currency.usdEnabled && <div className="mt-1 text-xs text-fg-2">≈ <UsdAmt n={priced.total / rate} /></div>}
          </div>
        </div>
        {customer && (customer.points >= 0) && settings?.loyalty.enabled && priced.total > 0 && <p className="text-end text-xs text-fg-2">{t('sell.earns', { n: Math.floor((priced.total / 1000) * settings.loyalty.pointsPer1000IQD) })}</p>}
        <div className="grid grid-cols-5 gap-2 pt-1.5">
          <IconButton label={t('sell.order_discount')} className={cn('w-full', !canOrderDiscount && 'invisible', cart.orderDiscount && 'ring-2 ring-gold')} onClick={onOrderDiscount} disabled={!lines.length || !canOrderDiscount}><Percent className="size-5" /></IconButton>
          <IconButton label={`${t('sell.gift_wrap')} (+${fmt(settings?.sales.giftWrapFeeIQD ?? 0)})`} aria-pressed={cart.giftWrap} className={cn('w-full', cart.giftWrap && 'bg-gold text-ink ring-2 ring-gold')} onClick={() => cart.setGiftWrap(!cart.giftWrap)} disabled={!lines.length}><Gift className="size-5" /></IconButton>
          <IconButton label={t('sell.note')} className={cn('w-full', cart.note && 'ring-2 ring-gold')} onClick={onNote} disabled={!lines.length}><StickyNote className="size-5" /></IconButton>
          <IconButton label={t('sell.hold')} className={cn('w-full', !canHold && 'invisible')} onClick={onHold} disabled={!lines.length || !canHold}><Pause className="size-5" /></IconButton>
          <IconButton label={t('sell.clear')} variant="secondary" className="w-full text-danger" onClick={onClear} disabled={!lines.length && !cart.customerId}><Trash2 className="size-5" /></IconButton>
        </div>
        <Button variant="primary" size="xl" block className="mt-1 h-14" disabled={!lines.length} onClick={onPay}>
          {t('sell.pay')} <span className="opacity-60">·</span> <Amt n={priced.total} />
        </Button>
      </footer>
    </section>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex items-center justify-between text-sm text-fg-2"><span>{label}</span><span className="font-medium text-fg">{value}</span></div>
}
