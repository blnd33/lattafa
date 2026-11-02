/**
 * The delegate's own dollar prices, and perfumes he adds himself.
 *
 * The perfumes are the shop's one list — that is what keeps stock a single number on both sides — but the dollar
 * price is his and is set only from here (or the admin panel). The shop's dinar prices are never touched.
 */
import { useQuery } from '@tanstack/react-query'
import type { I18nText, SizeUnit } from '@/data/types'
import { api } from '@/services/api'

export interface PriceRow { variantId: string; sku: string; name: I18nText; brand: string; label: string; retailIQD: number; usdCents: number }

export const usePrices = () => useQuery({ queryKey: ['delegate-prices'], queryFn: async () => (await api<{ prices: PriceRow[] }>('GET', '/delegate-prices')).prices, retry: false })

export const savePrices = async (prices: { variantId: string; usdCents: number }[]) =>
  (await api<{ changed: number }>('PUT', '/delegate-prices', { prices })).changed

export interface NewProduct { nameEn: string; nameAr: string; brand: string; size: number; unit: SizeUnit; usdCents: number; openingStock: number }

export const addProduct = async (p: NewProduct) => await api('POST', '/delegate-products', p)

/** "23.70" → 2370 cents; null when it isn't a price. An empty box means nothing set (0). */
export function toCents(text: string): number | null {
  const s = String(text).replace(/[\s$,٬]/g, '').replace('٫', '.')
  if (!s) return 0
  return /^\d+(\.\d{1,2})?$/.test(s) ? Math.round(Number(s) * 100) : null
}

/** 2370 → "23.7" for a box the delegate types in; 0 shows as empty. */
export const toDollars = (cents: number): string => (cents ? String(Math.round(cents) / 100) : '')
