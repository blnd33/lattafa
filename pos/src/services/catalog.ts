import { db, nextCounter } from '@/data/db'
import { STORE_LOCATION_ID, type Product, type Variant } from '@/data/types'
import { internalEan13 } from '@/lib/code128'
import { uuid } from '@/lib/id'
import { isSizeUnit, sizeLabel, toMl } from '@/lib/size'
import { AppError, assertCan, can, requireActor } from './context'
import { audit } from './audit'
import { applyMovement, stockMap } from './stock'
import { isServer } from './mode'
import * as remote from './remote'

export type CatalogVariant = Variant & { stock: number }
export interface CatalogItem {
  product: Product
  variants: CatalogVariant[]
}

/** Products with their variants and live stock — what the sell screen renders. */
export async function listCatalog(opts: { includeInactive?: boolean } = {}): Promise<CatalogItem[]> {
  assertCan('products.view')
  const [products, variants, stock] = await Promise.all([db.products.toArray(), db.variants.toArray(), stockMap()])
  const byProduct = new Map<string, CatalogVariant[]>()
  for (const v of variants) {
    if (!opts.includeInactive && !v.active) continue
    const arr = byProduct.get(v.productId) ?? []
    arr.push({ ...v, stock: stock[v.id] ?? 0 })
    byProduct.set(v.productId, arr)
  }
  return products
    .filter((p) => opts.includeInactive || p.active)
    .map((p) => ({ product: p, variants: (byProduct.get(p.id) ?? []).sort((a, b) => b.ml - a.ml) }))
    .filter((c) => opts.includeInactive || c.variants.length > 0)
    .sort((a, b) => a.product.name.en.localeCompare(b.product.name.en))
}

export async function findByBarcode(code: string): Promise<{ product: Product; variant: CatalogVariant } | null> {
  assertCan('products.view')
  const c = code.trim()
  if (!c) return null
  const v = (await db.variants.where('barcode').equals(c).first()) ?? (await db.variants.where('sku').equals(c).first())
  if (!v || !v.active) return null
  const [product, stock] = await Promise.all([db.products.get(v.productId), db.stock.get([v.id, STORE_LOCATION_ID])])
  if (!product || !product.active) return null
  return { product, variant: { ...v, stock: stock?.qty ?? 0 } }
}

export type ProductInput = Omit<Product, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
/** `ml` is not an input: it is always worked out from size + unit so the two can never disagree. */
export type VariantInput = Omit<Variant, 'productId' | 'id' | 'ml'> & { id?: string; openingStock?: number }

export async function nextBarcode(): Promise<string> {
  if (isServer()) return remote.nextBarcode() // the server knows every barcode in use
  for (let i = 0; i < 50; i++) {
    const code = internalEan13(await nextCounter('barcode'))
    if (!(await db.variants.where('barcode').equals(code).first())) return code
  }
  throw new AppError('barcode_generation_failed')
}

export async function saveProduct(input: { product: ProductInput; variants: VariantInput[] }): Promise<string> {
  const isNew = !input.product.id
  const actor = assertCan(isNew ? 'products.create' : 'products.edit')
  const p = input.product
  if (!p.name.en.trim() && !p.name.ar.trim() && !p.name.ku.trim()) throw new AppError('required_fields')
  if (!input.variants.length) throw new AppError('variant_required')

  const skus = new Set<string>()
  for (const v of input.variants) {
    if (!v.sku.trim()) throw new AppError('sku_required')
    const k = v.sku.trim().toLowerCase()
    if (skus.has(k)) throw new AppError('sku_taken', { sku: v.sku })
    skus.add(k)
    if (v.retailIQD < 0 || v.costIQD < 0 || v.wholesaleIQD < 0) throw new AppError('invalid_price')
    if (!isSizeUnit(v.unit) || !Number.isFinite(v.size) || v.size < 0) throw new AppError('invalid_size')
  }
  if (isServer()) return remote.saveProduct(input)

  const now = Date.now()
  const id = p.id ?? uuid()
  await db.transaction('rw', [db.products, db.variants, db.stock, db.stockMovements, db.counters, db.audit], async () => {
    const existing = p.id ? await db.products.get(p.id) : undefined
    if (p.id && !existing) throw new AppError('not_found')
    await db.products.put({ ...p, id, createdAt: existing?.createdAt ?? now, updatedAt: now })

    const old = await db.variants.where('productId').equals(id).toArray()
    const oldById = new Map(old.map((v) => [v.id, v]))
    const keep = new Set<string>()
    for (const vin of input.variants) {
      const vid = vin.id ?? uuid()
      keep.add(vid)
      const sku = vin.sku.trim()
      const clash = await db.variants.where('sku').equals(sku).first()
      if (clash && clash.id !== vid) throw new AppError('sku_taken', { sku })
      const prev = oldById.get(vid)
      const priceChanged = !prev || prev.retailIQD !== vin.retailIQD || prev.wholesaleIQD !== vin.wholesaleIQD || prev.costIQD !== vin.costIQD
      if (priceChanged && prev && !can('prices.edit')) throw new AppError('forbidden', { permission: 'prices.edit' })
      const barcode = vin.barcode.trim() || (await nextBarcode())
      const { openingStock, ...rest } = vin
      const size = Math.round(vin.size * 100) / 100
      await db.variants.put({ ...rest, id: vid, productId: id, sku, barcode, size, label: rest.label.trim() || sizeLabel(size, vin.unit), ml: toMl(size, vin.unit) })
      if (!prev && openingStock && openingStock > 0) {
        await applyMovement({ variantId: vid, delta: openingStock, type: 'opening', note: 'Opening stock', userId: actor.id })
      }
    }
    // variants removed in the editor are deactivated (never hard-deleted: sales reference them)
    for (const v of old) if (!keep.has(v.id) && v.active) await db.variants.update(v.id, { active: false })
    await audit(isNew ? 'product.create' : 'product.update', 'product', id, { name: p.name.en || p.name.ar || p.name.ku, variants: input.variants.length })
  })
  return id
}

export async function setProductActive(id: string, active: boolean): Promise<void> {
  assertCan('products.edit')
  if (isServer()) return remote.setProductActive(id, active)
  await db.products.update(id, { active, updatedAt: Date.now() })
  await audit(active ? 'product.activate' : 'product.deactivate', 'product', id)
}

export async function deleteProduct(id: string): Promise<'deleted' | 'deactivated'> {
  assertCan('products.delete')
  if (isServer()) return remote.deleteProduct(id)
  const variants = await db.variants.where('productId').equals(id).toArray()
  const ids = variants.map((v) => v.id)
  const sold = ids.length ? (await db.sales.toArray()).some((s) => s.items.some((i) => ids.includes(i.variantId))) : false
  if (sold) {
    await db.products.update(id, { active: false, updatedAt: Date.now() })
    await audit('product.deactivate', 'product', id, { reason: 'has sales history' })
    return 'deactivated'
  }
  await db.transaction('rw', [db.products, db.variants, db.stock, db.audit], async () => {
    await db.stock.where('variantId').anyOf(ids).delete()
    await db.variants.bulkDelete(ids)
    await db.products.delete(id)
    await audit('product.delete', 'product', id)
  })
  return 'deleted'
}

/** Raise/lower prices for many products at once (by % or a fixed IQD amount). */
export async function bulkPriceUpdate(input: {
  mode: 'pct' | 'fixed'
  value: number
  target: 'retail' | 'wholesale' | 'both'
  productIds?: string[]
  step?: number
}): Promise<number> {
  assertCan('prices.edit')
  if (!Number.isFinite(input.value) || input.value === 0) throw new AppError('invalid_price')
  if (isServer()) return remote.bulkPriceUpdate(input)
  const step = input.step ?? 250
  const variants = await db.variants.toArray()
  const scope = input.productIds ? variants.filter((v) => input.productIds!.includes(v.productId)) : variants
  const adj = (n: number) => {
    const raw = input.mode === 'pct' ? n * (1 + input.value / 100) : n + input.value
    return Math.max(0, step ? Math.round(raw / step) * step : Math.round(raw))
  }
  await db.transaction('rw', db.variants, db.audit, async () => {
    for (const v of scope) {
      const patch: Partial<Variant> = {}
      if (input.target !== 'wholesale') patch.retailIQD = adj(v.retailIQD)
      if (input.target !== 'retail') patch.wholesaleIQD = adj(v.wholesaleIQD)
      await db.variants.update(v.id, patch)
    }
    await audit('prices.bulk', 'variant', '*', { mode: input.mode, value: input.value, target: input.target, count: scope.length })
  })
  return scope.length
}

export async function distinctBrands(): Promise<string[]> {
  const products = await db.products.toArray()
  return [...new Set(products.map((p) => p.brand).filter(Boolean))].sort()
}

export function requireCatalogActor() {
  return requireActor()
}
