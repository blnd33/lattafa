/**
 * The delegate's own dollar prices, and perfumes he adds himself.
 *
 * The perfume is the shop's — one list, one barcode, one name — but the price and the quantity are his. A price
 * saved here is his alone: not what another delegate charges, and not the shop's dollar list, which is what he
 * falls back to for a size he has not priced himself. The shop's dinar prices are never touched.
 */
import { useQuery } from '@tanstack/react-query'
import type { I18nText, SizeUnit } from '@/data/types'
import { api } from '@/services/api'
import { requireActor } from '@/services/context'
import { pull } from './sync'

export interface PriceRow { variantId: string; sku: string; name: I18nText; brand: string; label: string; retailIQD: number; usdCents: number; costCents: number }

export const usePrices = () => useQuery({ queryKey: ['delegate-prices'], queryFn: async () => (await api<{ prices: PriceRow[] }>('GET', '/delegate-prices')).prices, retry: false })

/**
 * Saves, then pulls the shop down again. The selling screen prices from this phone's own copy of the catalogue, so
 * without the pull a price just changed here would not reach the bill until the next sync (up to half a minute).
 */
export async function savePrices(prices: { variantId: string; usdCents?: number; costCents?: number }[]): Promise<number> {
  const me = requireActor().id
  const own: Record<string, number | null> = {}
  for (const p of prices) if (p.usdCents !== undefined) own[p.variantId] = p.usdCents || null
  const { changed } = await api<{ changed: number }>('PUT', '/delegates/' + me + '/prices', { prices: own })
  await pull()
  return changed
}

export interface NewProduct { nameEn: string; nameAr: string; brand: string; size: number; unit: SizeUnit; usdCents: number; costCents: number; openingStock: number }

/** Adds it, then pulls, so the new perfume is on the selling screen (with its stock) right away. */
export async function addProduct(p: NewProduct): Promise<void> {
  await api('POST', '/delegate-products', p)
  await pull()
}

/** "23.70" → 2370 cents; null when it isn't a price. An empty box means nothing set (0). */
export function toCents(text: string): number | null {
  const s = String(text).replace(/[\s$,٬]/g, '').replace('٫', '.')
  if (!s) return 0
  return /^\d+(\.\d{1,2})?$/.test(s) ? Math.round(Number(s) * 100) : null
}

/** 2370 → "23.7" for a box the delegate types in; 0 shows as empty. */
export const toDollars = (cents: number): string => (cents ? String(Math.round(cents) / 100) : '')
