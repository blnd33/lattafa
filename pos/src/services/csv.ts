/**
 * Catalogue import / export as CSV (opens in Excel / Google Sheets).
 * Import is *upsert by SKU*: an existing SKU gets its prices/barcode/min-stock
 * updated, a new SKU creates a variant (and a product if the product name is new).
 */
import { db } from '@/data/db'
import type { Gender, Product, SizeUnit, Variant } from '@/data/types'
import { uuid } from '@/lib/id'
import { isSizeUnit, sizeLabel, toMl } from '@/lib/size'
import { AppError, assertCan } from './context'
import { audit } from './audit'
import { applyMovement, stockMap } from './stock'
import { nextBarcode } from './catalog'
import { isServer } from './mode'
import * as remote from './remote'

export const CSV_COLUMNS = ['sku', 'barcode', 'name_en', 'name_ar', 'name_ku', 'brand', 'category', 'gender', 'concentration', 'size_label', 'size', 'unit', 'cost_iqd', 'retail_iqd', 'wholesale_iqd', 'wholesale_usd', 'min_stock', 'stock'] as const
/** Files made before ml/oz units existed have an `ml` column instead of `size` + `unit`; still accepted on import. */
const READ_COLUMNS = [...CSV_COLUMNS, 'ml'] as const
export type CsvRow = Record<(typeof READ_COLUMNS)[number], string>

const esc = (v: string | number) => {
  const s = String(v ?? '')
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Parses RFC-4180-ish CSV (quotes, commas, newlines inside quotes). Handles a UTF-8 BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cur = '', q = false
  const src = text.replace(/^﻿/, '')
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { cur += '"'; i++ } else q = false } else cur += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(cur); cur = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && src[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some((x) => x !== '')) rows.push(row); row = [] }
    else cur += c
  }
  row.push(cur)
  if (row.some((x) => x !== '')) rows.push(row)
  return rows
}

export async function exportCatalogCsv(): Promise<string> {
  assertCan('products.import')
  const [products, variants, stock] = await Promise.all([db.products.toArray(), db.variants.toArray(), stockMap()])
  const pmap = new Map(products.map((p) => [p.id, p]))
  const lines = [CSV_COLUMNS.join(',')]
  for (const v of variants.filter((x) => x.active)) {
    const p = pmap.get(v.productId)
    if (!p || !p.active) continue
    lines.push([v.sku, v.barcode, p.name.en, p.name.ar, p.name.ku, p.brand, p.category, p.gender, p.concentration, v.label, v.size, v.unit, v.costIQD, v.retailIQD, v.wholesaleIQD, v.wholesaleUSDCents ?? 0, v.minStock, stock[v.id] ?? 0].map(esc).join(','))
  }
  return '﻿' + lines.join('\r\n')
}

export function csvTemplate(): string {
  return '﻿' + CSV_COLUMNS.join(',') + '\r\n' + ['LTF-DEMO-100', '', 'Demo Perfume', 'عطر تجريبي', 'عەتری نموونە', 'Lattafa', 'perfume', 'unisex', 'EDP', '100 ml', '100', 'ml', '20000', '35000', '28000', '5', '10'].map(esc).join(',') + '\r\n'
}

export interface ImportPreview {
  rows: CsvRow[]
  errors: { line: number; message: string }[]
}

export function previewImport(text: string): ImportPreview {
  const table = parseCsv(text)
  if (table.length < 2) return { rows: [], errors: [{ line: 1, message: 'empty' }] }
  const head = table[0].map((h) => h.trim().toLowerCase())
  const missing = ['sku', 'name_en', 'retail_iqd'].filter((c) => !head.includes(c))
  if (missing.length) return { rows: [], errors: [{ line: 1, message: `missing columns: ${missing.join(', ')}` }] }
  const rows: CsvRow[] = []
  const errors: ImportPreview['errors'] = []
  const seen = new Set<string>()
  table.slice(1).forEach((cells, i) => {
    const r = Object.fromEntries(READ_COLUMNS.map((c) => [c, (cells[head.indexOf(c)] ?? '').trim()])) as CsvRow
    const line = i + 2
    if (!r.sku) return errors.push({ line, message: 'sku is empty' })
    if (seen.has(r.sku.toLowerCase())) return errors.push({ line, message: `duplicate sku ${r.sku}` })
    seen.add(r.sku.toLowerCase())
    if (!r.name_en && !r.name_ar && !r.name_ku) return errors.push({ line, message: 'product name is empty' })
    if (!(Number(r.retail_iqd) >= 0) || r.retail_iqd === '') return errors.push({ line, message: 'retail_iqd must be a number' })
    if (r.unit && !isSizeUnit(r.unit.toLowerCase())) return errors.push({ line, message: `unit must be ml or oz (got "${r.unit}")` })
    if ((r.size || r.ml) && !(Number(r.size || r.ml) >= 0)) return errors.push({ line, message: 'size must be a number' })
    rows.push(r)
  })
  return { rows, errors }
}

/** One product per name + brand: the name in whichever language was filled in, an empty brand = the default brand. */
export const productKey = (en: string, ar: string, ku: string, brand: string) => `${(en || ar || ku).trim().toLowerCase()}|${(brand.trim() || 'Lattafa').toLowerCase()}`

/** A number from a cell; an empty cell means the default (an empty low-stock alert is 5, not 0). */
const num = (s: string, d = 0) => { if (String(s ?? '').trim() === '') return d; const n = Number(String(s).replace(/,/g, '')); return Number.isFinite(n) ? Math.round(n) : d }
const GENDERS: Gender[] = ['men', 'women', 'unisex']
const art = (i: number) => ['#8B4A2B', '#27365C', '#6A2F42', '#3E6B4F', '#B5442F', '#7A4FA0'][i % 6]

/**
 * `addStock`: a row for a SKU already on file also adds its `stock` to that size (a delivery — the product sheet and
 * supplier invoices). Without it the stock of a known SKU is left alone, so an exported file can be imported again.
 */
export async function importCatalog(rows: CsvRow[], opts: { addStock?: boolean } = {}): Promise<{ created: number; updated: number }> {
  const actor = assertCan('products.import')
  if (!rows.length) throw new AppError('nothing_to_import')
  if (isServer()) return remote.importCatalog(rows, opts)
  let created = 0, updated = 0, received = 0
  const receipt = uuid()
  await db.transaction('rw', [db.products, db.variants, db.stock, db.stockMovements, db.counters, db.audit], async () => {
    const products = await db.products.toArray()
    const byKey = new Map(products.map((p) => [productKey(p.name.en, p.name.ar, p.name.ku, p.brand), p]))
    let n = products.length
    for (const r of rows) {
      const existing = await db.variants.where('sku').equals(r.sku).first()
      // two sizes on one barcode would make scanning ambiguous
      if (r.barcode && (await db.variants.where('barcode').equals(r.barcode).toArray()).some((x) => x.id !== existing?.id)) throw new AppError('barcode_taken', { barcode: r.barcode, sku: r.sku })
      const retail = num(r.retail_iqd), cost = num(r.cost_iqd), wholesale = num(r.wholesale_iqd, retail)
      if (existing) {
        await db.variants.update(existing.id, { retailIQD: retail, costIQD: cost, wholesaleIQD: wholesale, wholesaleUSDCents: num(r.wholesale_usd, existing.wholesaleUSDCents ?? 0), minStock: num(r.min_stock, existing.minStock), ...(r.barcode ? { barcode: r.barcode } : {}) })
        const pieces = num(r.stock)
        if (opts.addStock && pieces > 0) {
          await applyMovement({ variantId: existing.id, delta: pieces, type: 'purchase', refType: 'receipt', refId: receipt, note: 'Excel import', userId: actor.id })
          received += pieces
        }
        updated++
        continue
      }
      const key = productKey(r.name_en, r.name_ar, r.name_ku, r.brand)
      let p = byKey.get(key)
      if (!p) {
        const now = Date.now()
        const gender = (GENDERS as string[]).includes(r.gender) ? (r.gender as Gender) : 'unisex'
        p = {
          id: uuid(), name: { en: r.name_en, ar: r.name_ar, ku: r.name_ku }, description: { en: '', ar: '', ku: '' },
          brand: r.brand.trim() || 'Lattafa', category: r.category || 'perfume', gender, concentration: r.concentration || 'EDP',
          scentFamilies: [], notes: { top: [], heart: [], base: [] }, season: 'all', longevity: 3, sillage: 3, image: null,
          art: { c1: art(n), c2: '#1A1714', shape: 'rect' }, showOnMenu: true, featured: false, isNew: false, active: true, createdAt: now, updatedAt: now,
        } satisfies Product
        n++
        await db.products.add(p)
        byKey.set(key, p)
      }
      const unit: SizeUnit = r.unit.toLowerCase() === 'oz' ? 'oz' : 'ml'
      const size = Math.round(Number(r.size || r.ml || 0) * 100) / 100
      const v: Variant = {
        id: uuid(), productId: p.id, label: r.size_label || sizeLabel(size, unit), size, unit, ml: toMl(size, unit), sku: r.sku,
        barcode: r.barcode || (await nextBarcode()), costIQD: cost, retailIQD: retail, wholesaleIQD: wholesale, wholesaleUSDCents: num(r.wholesale_usd),
        minStock: num(r.min_stock, 5), isTester: false, active: true,
      }
      await db.variants.add(v)
      const opening = num(r.stock)
      if (opening > 0) await applyMovement({ variantId: v.id, delta: opening, type: 'opening', note: 'CSV import', userId: actor.id })
      created++
    }
    await audit('products.import', 'product', '*', { created, updated, ...(received ? { received } : {}) })
  })
  return { created, updated }
}
