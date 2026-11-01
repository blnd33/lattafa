import { useMemo } from 'react'
import type { Customer } from '@/data/types'
import { priceCart, type PricingResult } from '@/lib/pricing'
import { useCustomers, useCatalog, useSettings } from '@/hooks/queries'
import { useCart } from '@/store/cart'
import { useVariantIndex, type VariantRef } from './helpers'

export interface CartLineView {
  variantId: string
  ref: VariantRef
  qty: number
  discountPct: number
  unit: number
  gross: number
  discount: number
  net: number
}

/**
 * Turns the persisted cart (variant ids + quantities) into a priced view using the
 * live catalogue and settings. Lines whose product disappeared are dropped from the
 * totals and reported in `missing` so the UI can flag them.
 */
export function useCartPricing() {
  const cart = useCart()
  const { data: catalog } = useCatalog()
  const { data: settings } = useSettings()
  const { data: customers } = useCustomers()
  const index = useVariantIndex(catalog)

  return useMemo(() => {
    const lines: CartLineView[] = []
    const missing: string[] = []
    for (const l of cart.lines) {
      const ref = index.get(l.variantId)
      if (!ref) { missing.push(l.variantId); continue }
      lines.push({ variantId: l.variantId, ref, qty: l.qty, discountPct: l.discountPct, unit: ref.variant.retailIQD, gross: 0, discount: 0, net: 0 })
    }
    const customer: Customer | null = customers?.find((c) => c.id === cart.customerId) ?? null
    const pointValue = settings?.loyalty.pointValueIQD ?? 0
    const redeem = customer && settings?.loyalty.enabled ? Math.min(cart.redeemPoints, customer.points) : 0

    const priced: PricingResult = priceCart({
      lines: lines.map((l) => ({ key: l.variantId, unitPriceIQD: l.unit, qty: l.qty, discountPct: l.discountPct })),
      orderDiscount: cart.orderDiscount,
      pointsRedeemedIQD: redeem * pointValue,
      giftWrapIQD: cart.giftWrap ? settings?.sales.giftWrapFeeIQD ?? 0 : 0,
      taxPct: settings?.tax.pct ?? 0,
      rounding: settings?.currency.rounding ?? 0,
    })
    priced.lines.forEach((pl, i) => { lines[i].gross = pl.gross; lines[i].discount = pl.discount; lines[i].net = pl.net })

    const units = lines.reduce((a, l) => a + l.qty, 0)
    // How many points can usefully be redeemed on this bill
    const maxRedeem = customer && settings ? Math.min(customer.points, Math.floor((priced.total + priced.pointsRedeemed - priced.giftWrap - priced.tax) / Math.max(1, pointValue))) : 0
    return { lines, missing, priced, customer, settings, units, redeem, maxRedeem: Math.max(0, maxRedeem), pointValue, index }
  }, [cart.lines, cart.customerId, cart.orderDiscount, cart.giftWrap, cart.redeemPoints, index, customers, settings])
}

export type CartPricing = ReturnType<typeof useCartPricing>
