import { Banknote, Clock, CreditCard, Smartphone, Wallet, RefreshCcw, type LucideIcon } from 'lucide-react'
import { useMemo } from 'react'
import type { Lang, PaymentMethod, Product } from '@/data/types'
import type { CatalogItem, CatalogVariant } from '@/services/catalog'
import { pick } from '@/i18n'

export interface MethodDef {
  id: PaymentMethod
  icon: LucideIcon
  currency: 'IQD' | 'USD'
  cash: boolean
}

/** Payment methods offered at the counter (return_credit is added automatically for exchanges). */
export const METHODS: MethodDef[] = [
  { id: 'cash_iqd', icon: Banknote, currency: 'IQD', cash: true },
  { id: 'cash_usd', icon: Banknote, currency: 'USD', cash: true },
  { id: 'card', icon: CreditCard, currency: 'IQD', cash: false },
  { id: 'fib', icon: Wallet, currency: 'IQD', cash: false },
  { id: 'zain', icon: Smartphone, currency: 'IQD', cash: false },
  { id: 'debt', icon: Clock, currency: 'IQD', cash: false },
]
export const RETURN_CREDIT: MethodDef = { id: 'return_credit', icon: RefreshCcw, currency: 'IQD', cash: false }
export const methodDef = (id: PaymentMethod): MethodDef => [...METHODS, RETURN_CREDIT].find((m) => m.id === id)!

/** Quick category chips on the sell screen. */
export const CATEGORY_CHIPS = ['all', 'men', 'women', 'unisex', 'oud', 'mist', 'set'] as const
export type CategoryChip = (typeof CATEGORY_CHIPS)[number]

export function matchesCategory(p: Product, c: CategoryChip): boolean {
  if (c === 'all') return true
  if (c === 'men' || c === 'women' || c === 'unisex') return p.gender === c
  return p.category === c
}

export function matchesQuery(p: Product, variants: CatalogVariant[], q: string): boolean {
  const s = q.trim().toLowerCase()
  if (!s) return true
  const hay = [p.name.en, p.name.ar, p.name.ku, p.brand, p.concentration, ...p.scentFamilies, ...variants.flatMap((v) => [v.sku, v.barcode])].join(' ').toLowerCase()
  return s.split(/\s+/).every((w) => hay.includes(w))
}

export interface VariantRef { product: Product; variant: CatalogVariant }

/** variantId → { product, variant } for the whole catalogue. */
export function useVariantIndex(catalog: CatalogItem[] | undefined): Map<string, VariantRef> {
  return useMemo(() => {
    const m = new Map<string, VariantRef>()
    for (const c of catalog ?? []) for (const v of c.variants) m.set(v.id, { product: c.product, variant: v })
    return m
  }, [catalog])
}

export const productName = (p: Pick<Product, 'name'>, lang: Lang) => pick(p.name, lang)
