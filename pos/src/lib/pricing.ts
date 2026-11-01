/**
 * PricingService — the ONE place bill maths lives (brief §10).
 *
 * Both the sell screen (live preview) and salesService (authoritative save) call
 * `priceCart`, so what the cashier sees is exactly what gets stored. It is a pure
 * function: no I/O, easy to unit-test, and it can be ported 1:1 to the Laravel
 * PricingService so the server recomputes and can reject tampered totals.
 *
 * Order of operations:
 *   1. line gross      = unit price × qty
 *   2. line discount   = gross × line % (rounded to whole dinar)
 *   3. order discount  = % or fixed amount off the sum of net lines
 *   4. loyalty points  = redeemed value off what is left
 *   5. tax             = % on the discounted amount (exclusive)
 *   6. gift wrap fee   = added last, untaxed
 *   7. rounding        = to the configured IQD step (e.g. 250)
 */
import { roundTo } from './money'

export interface PricingLineInput {
  key: string
  unitPriceIQD: number
  qty: number
  discountPct: number
}

export interface OrderDiscount {
  type: 'pct' | 'fixed'
  value: number
}

export interface PricingInput {
  lines: PricingLineInput[]
  orderDiscount?: OrderDiscount | null
  pointsRedeemedIQD?: number
  giftWrapIQD?: number
  taxPct?: number
  rounding?: number
}

export interface PricedLine {
  key: string
  gross: number
  discount: number
  net: number
}

export interface PricingResult {
  lines: PricedLine[]
  subtotal: number // Σ gross
  itemDiscount: number // Σ line discounts
  orderDiscount: number
  pointsRedeemed: number
  tax: number
  giftWrap: number
  rounding: number // signed adjustment applied by rounding
  total: number // what the customer must pay (integer IQD)
  /** total discount as % of subtotal — compared with the cashier's limit */
  effectiveDiscountPct: number
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

export function priceCart(input: PricingInput): PricingResult {
  const lines: PricedLine[] = input.lines.map((l) => {
    const qty = Math.max(0, Math.floor(l.qty))
    const gross = Math.max(0, Math.round(l.unitPriceIQD)) * qty
    const pct = clamp(l.discountPct || 0, 0, 100)
    const discount = clamp(Math.round((gross * pct) / 100), 0, gross)
    return { key: l.key, gross, discount, net: gross - discount }
  })

  const subtotal = lines.reduce((a, l) => a + l.gross, 0)
  const itemDiscount = lines.reduce((a, l) => a + l.discount, 0)
  const sumNet = subtotal - itemDiscount

  let orderDiscount = 0
  const od = input.orderDiscount
  if (od && od.value > 0) {
    orderDiscount = od.type === 'pct' ? Math.round((sumNet * clamp(od.value, 0, 100)) / 100) : Math.round(od.value)
    orderDiscount = clamp(orderDiscount, 0, sumNet)
  }

  const afterOrder = sumNet - orderDiscount
  const pointsRedeemed = clamp(Math.round(input.pointsRedeemedIQD ?? 0), 0, afterOrder)
  const taxable = afterOrder - pointsRedeemed
  const tax = Math.round((taxable * clamp(input.taxPct ?? 0, 0, 100)) / 100)
  const giftWrap = Math.max(0, Math.round(input.giftWrapIQD ?? 0))

  const exact = taxable + tax + giftWrap
  const total = exact > 0 ? roundTo(exact, input.rounding ?? 0) : 0
  const rounding = total - exact

  const effectiveDiscountPct = subtotal > 0 ? ((itemDiscount + orderDiscount) / subtotal) * 100 : 0
  return { lines, subtotal, itemDiscount, orderDiscount, pointsRedeemed, tax, giftWrap, rounding, total, effectiveDiscountPct }
}

/** Loyalty points earned on a bill (whole points, never negative). */
export function pointsEarned(totalIQD: number, pointsPer1000: number): number {
  return Math.max(0, Math.floor((totalIQD / 1000) * pointsPer1000))
}
