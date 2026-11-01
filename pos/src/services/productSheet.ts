/**
 * The product sheet: an Excel-like grid inside the POS for adding many products fast.
 *
 * One row = one size of a perfume (like the import template). Enter on a row saves it through the same import as a
 * CSV/Excel file — upsert by SKU, sizes of one perfume grouped by name + brand — so it works offline and against the
 * server alike. Values may be typed or pasted from Excel in English, Arabic or Kurdish ("رجالي", "پیاوان", "men"…).
 */
import { db } from '@/data/db'
import type { Gender, Lang, SizeUnit } from '@/data/types'
import { DICTS, translate } from '@/i18n'
import { trimNum } from '@/lib/size'
import { readXlsx, writeXlsx } from '@/lib/xlsx'
import { AppError, assertCan } from './context'
import { importCatalog, parseCsv, productKey, type CsvRow } from './csv'

export const SHEET_COLUMNS = [
  'name_en', 'name_ar', 'name_ku', 'brand', 'category', 'gender', 'concentration', 'size', 'unit',
  'cost_iqd', 'retail_iqd', 'wholesale_iqd', 'stock', 'min_stock', 'barcode', 'sku',
] as const
export type SheetCol = (typeof SHEET_COLUMNS)[number]
export type SheetRow = Record<SheetCol, string>

export const CATEGORIES = ['perfume', 'oud', 'mist', 'oil', 'set', 'home'] as const
export const CONCENTRATIONS = ['EDP', 'EDT', 'Parfum', 'Extrait', 'Oil', 'Mist', 'Set'] as const
export const GENDERS: Gender[] = ['men', 'women', 'unisex']
export const UNITS: SizeUnit[] = ['ml', 'oz']
/** Columns that are a choice from a list (a <select> in the grid). */
export const CHOICE_COLUMNS: Partial<Record<SheetCol, readonly string[]>> = { category: CATEGORIES, gender: GENDERS, concentration: CONCENTRATIONS, unit: UNITS }

/** A new row: empty, but with brand / category / gender / concentration / unit carried over from the row above. */
export const blankRow = (from?: Partial<SheetRow>): SheetRow => ({
  name_en: '', name_ar: '', name_ku: '', brand: from?.brand ?? 'Lattafa', category: from?.category ?? 'perfume', gender: from?.gender ?? 'unisex',
  concentration: from?.concentration ?? 'EDP', size: '', unit: from?.unit ?? 'ml', cost_iqd: '', retail_iqd: '', wholesale_iqd: '',
  stock: '', min_stock: '', barcode: '', sku: '',
})

const TYPED: SheetCol[] = ['name_en', 'name_ar', 'name_ku', 'size', 'cost_iqd', 'retail_iqd', 'wholesale_iqd', 'stock', 'min_stock', 'barcode', 'sku']
/** Nobody has typed in this row yet (only the carried-over choices). */
export const isBlank = (r: SheetRow) => TYPED.every((c) => !r[c].trim())

/* ───────── reading what people type or paste ───────── */

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_\-.:]+/g, ' ').trim()
const LANG_CODES = ['en', 'ar', 'ku'] as const
const labels = (key: string) => LANG_CODES.map((l) => DICTS[l][key]).filter(Boolean)

/** Every way a choice may be written: the code, the label the app shows in each language, and common words. */
const CHOICE_ALIASES: Record<'gender' | 'unit' | 'category' | 'concentration', Record<string, string[]>> = {
  gender: {
    men: [...labels('gender.men'), 'men', 'man', 'male', 'm', 'for men', 'رجال', 'للرجال', 'رجالى', 'پیاو', 'پياوان', 'نێر'],
    women: [...labels('gender.women'), 'women', 'woman', 'female', 'f', 'w', 'for women', 'نساء', 'للنساء', 'نسائى', 'ئافرەت', 'ئافرەتان', 'مێ'],
    unisex: [...labels('gender.unisex'), 'unisex', 'both', 'u', 'all', 'مشترك', 'يونيسكس', 'هەردوو', 'هەردووکیان', 'هاوبەش'],
  },
  unit: {
    ml: ['ml', 'mls', 'milliliter', 'millilitre', 'مل', 'ملل', 'مللي', 'ملي', 'میلی', 'مڵ', 'ملی لیتر'],
    oz: ['oz', 'ounce', 'ounces', 'fl oz', 'fl.oz', 'أونصة', 'اونصة', 'اونس', 'ئۆنس', 'ئونس'],
  },
  category: Object.fromEntries(CATEGORIES.map((c) => [c, [...labels(`prod.cat_${c}`), c, ...({
    perfume: ['perfume', 'parfum', 'fragrance', 'عطور', 'بۆن'], oud: ['oud', 'عوود', 'دهن عود'], mist: ['body mist', 'mist', 'spray', 'سبراي', 'میست'],
    oil: ['oil', 'perfume oil', 'دهن', 'زيت عطري'], set: ['set', 'gift set', 'gift', 'box', 'طقم', 'بوكس', 'هدية', 'سێت', 'دیاری'], home: ['home', 'home fragrance', 'بخور', 'معطر منزل'],
  } as Record<string, string[]>)[c]]])),
  concentration: {
    EDP: ['edp', 'eau de parfum', 'او دو بارفان', 'او دي بارفان'], EDT: ['edt', 'eau de toilette', 'او دو تواليت'], Parfum: ['parfum', 'pure parfum', 'بارفان'],
    Extrait: ['extrait', 'extrait de parfum', 'اكستريه'], Oil: ['oil', 'زيت', 'دهن'], Mist: ['mist', 'body mist'], Set: ['set', 'gift set', 'طقم'],
  },
}
const CHOICE_INDEX = Object.fromEntries(Object.entries(CHOICE_ALIASES).map(([col, map]) => [col, new Map(Object.entries(map).flatMap(([code, words]) => words.map((w) => [norm(w), code])))])) as Record<keyof typeof CHOICE_ALIASES, Map<string, string>>

/** "رجالي" → "men", "Fl Oz" → "oz"; anything not recognised comes back as typed (and fails the row's check). */
export function readChoice(col: SheetCol, value: string): string {
  const idx = CHOICE_INDEX[col as keyof typeof CHOICE_INDEX]
  if (!idx) return value
  return idx.get(norm(value)) ?? value.trim()
}

const DIGITS = (s: string) => s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
/** "35,000" / "٣٥٠٠٠" / "35000 IQD" → 35000; "" → null; letters → NaN. A decimal comma ("3,4") only for sizes. */
export function readNumber(raw: string, decimals = false): number | null {
  let s = DIGITS(raw).trim().replace(/(iqd|د\.?ع|دينار|دینار|\$|usd)/gi, '').replace(/[\s٬]/g, '')
  if (!s) return null
  s = decimals && /^\d+[,٫]\d{1,2}$/.test(s) ? s.replace(/[,٫]/, '.') : s.replace(/,/g, '')
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN
}

/* ───────── paste from Excel ───────── */

/** Tab-separated text as Excel / Google Sheets put it on the clipboard (quoted cells may hold tabs or new lines). */
export function parseClipboard(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cur = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++ } else q = false } else cur += c }
    else if (c === '"' && cur === '') q = true
    else if (c === '\t') { row.push(cur); cur = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = '' }
    else cur += c
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row) }
  while (rows.length && rows[rows.length - 1].every((x) => !x.trim())) rows.pop()
  return rows
}

/** Header words that identify a column when a whole sheet (with its header row) is pasted — in any language. */
const HEADER_ALIASES: Record<SheetCol, string[]> = {
  name_en: ['name_en', 'name', 'name en', 'english name', 'name (english)', 'product', 'product name', 'perfume', 'الاسم بالانجليزي', 'ناو بە ئینگلیزی', 'ناوی ئینگلیزی'],
  name_ar: ['name_ar', 'name ar', 'arabic name', 'name (arabic)', 'الاسم', 'اسم', 'الاسم بالعربي', 'اسم المنتج', 'ناو بە عەرەبی', 'ناوی عەرەبی'],
  name_ku: ['name_ku', 'name ku', 'kurdish name', 'name (kurdish)', 'الاسم بالكردي', 'ناو', 'ناو بە کوردی', 'ناوی کوردی'],
  brand: ['brand', 'make', 'الماركة', 'ماركة', 'العلامة', 'براند', 'مارکە', 'براند'],
  category: ['category', 'type', 'الفئة', 'النوع', 'جۆر', 'پۆل'],
  gender: ['gender', 'for', 'sex', 'الجنس', 'لمن', 'ڕەگەز', 'بۆ'],
  concentration: ['concentration', 'conc', 'التركيز', 'چڕی'],
  size: ['size', 'ml', 'volume', 'الحجم', 'السعة', 'قەبارە'],
  unit: ['unit', 'الوحدة', 'یەکە'],
  cost_iqd: ['cost_iqd', 'cost', 'buy price', 'purchase price', 'التكلفة', 'سعر الشراء', 'تێچوو', 'نرخی کڕین'],
  retail_iqd: ['retail_iqd', 'retail', 'price', 'retail price', 'sell price', 'السعر', 'سعر البيع', 'سعر المفرد', 'نرخ', 'نرخی فرۆشتن', 'نرخی تاک'],
  wholesale_iqd: ['wholesale_iqd', 'wholesale', 'wholesale price', 'الجملة', 'سعر الجملة', 'نرخی کۆ', 'کۆ'],
  stock: ['stock', 'qty', 'quantity', 'opening stock', 'الكمية', 'المخزون', 'بڕ', 'کۆگا'],
  min_stock: ['min_stock', 'min', 'min stock', 'minimum', 'low stock', 'الحد الأدنى', 'کەمترین'],
  barcode: ['barcode', 'ean', 'upc', 'الباركود', 'باركود', 'بارکۆد'],
  sku: ['sku', 'code', 'item code', 'الرمز', 'كود', 'کۆد'],
}
for (const col of SHEET_COLUMNS) {
  // the sheet's own column titles in every language count too
  HEADER_ALIASES[col].push(...labels(`sheet.col_${col}`).map((l) => l.replace(/\s*\*$/, '')))
}
const HEADER_INDEX = new Map(SHEET_COLUMNS.flatMap((col) => HEADER_ALIASES[col].map((w) => [norm(w), col] as const)))

/** If the first pasted line is a header row, which sheet column each pasted column belongs to (else null). */
export function headerMapping(first: string[]): (SheetCol | null)[] | null {
  const filled = first.filter((h) => h.trim())
  // a header row has no numbers in it, and most of its cells are column names — a product row such as
  // "Asad · Perfume · 100 · ml · 33500" has words like "perfume" or "ml" but also prices
  if (filled.some((h) => typeof readNumber(h) === 'number' && !Number.isNaN(readNumber(h)))) return null
  const map = first.map((h) => HEADER_INDEX.get(norm(h.replace(/\*/g, ''))) ?? null)
  const hits = map.filter(Boolean).length
  return hits >= 2 && hits * 2 >= filled.length ? map : null
}

/** Cells → a row patch, with choices read in any language. */
const toPatch = (cells: string[], colOf: (i: number) => SheetCol | null | undefined): Partial<SheetRow> => {
  const patch: Partial<SheetRow> = {}
  cells.forEach((v, i) => {
    const col = colOf(i)
    if (col) patch[col] = CHOICE_COLUMNS[col] ? readChoice(col, v ?? '') : (v ?? '').trim()
  })
  return patch
}
const hasValues = (cells: string[]) => cells.some((c) => (c ?? '').trim())

/**
 * Pasted cells → row patches. With a header row the columns are matched by name (any order, any language);
 * without one they fill the sheet's columns from `startCol` onward, like Excel.
 */
export function pasteToPatches(text: string, startCol: SheetCol): Partial<SheetRow>[] {
  const grid = parseClipboard(text)
  if (!grid.length) return []
  const header = headerMapping(grid[0])
  const body = header ? grid.slice(1) : grid
  const start = SHEET_COLUMNS.indexOf(startCol)
  return body.filter(hasValues).map((cells) => toPatch(cells, (i) => (header ? header[i] : SHEET_COLUMNS[start + i])))
}

/**
 * A table from a file → row patches. The header row is looked for in the first rows (a title above it is fine)
 * and decides which column is which; rows above it and empty rows are left out. Null when no header row is found.
 */
export function tableToPatches(table: string[][]): Partial<SheetRow>[] | null {
  for (let h = 0; h < Math.min(table.length, 15); h++) {
    const header = table[h] && headerMapping(table[h])
    if (header) return table.slice(h + 1).filter((r) => r && hasValues(r)).map((cells) => toPatch(cells, (i) => header[i]))
  }
  return null
}

/* ───────── Excel files ───────── */

/**
 * Rows from an uploaded file: an Excel workbook (.xlsx — the first sheet with column titles) or a CSV file.
 * Errors: `file_xls` (the old binary format), `file_no_header`, `file_bad`.
 */
export async function readSheetFile(file: File): Promise<{ patches: Partial<SheetRow>[]; sheet: string }> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.xls')) throw new AppError('file_xls')
  let tables: { name: string; rows: string[][] }[]
  try {
    if (name.endsWith('.csv') || file.type === 'text/csv') tables = [{ name: file.name, rows: parseCsv(await file.text()) }]
    else tables = await readXlsx(await file.arrayBuffer())
  } catch {
    throw new AppError('file_bad')
  }
  for (const t of tables) {
    const patches = tableToPatches(t.rows)
    if (patches) return { patches, sheet: t.name }
  }
  throw new AppError('file_no_header')
}

const tr = (lang: Lang, key: string) => translate(lang, key)
const WIDTHS: Record<SheetCol, number> = {
  name_en: 26, name_ar: 24, name_ku: 24, brand: 14, category: 16, gender: 12, concentration: 14, size: 9, unit: 8,
  cost_iqd: 13, retail_iqd: 18, wholesale_iqd: 15, stock: 13, min_stock: 15, barcode: 18, sku: 24,
}
/** How a choice is written in the file: the label in the user's language (any language is read back). */
const choiceText = (lang: Lang, col: SheetCol, code: string) =>
  col === 'category' ? tr(lang, `prod.cat_${code}`) : col === 'gender' ? tr(lang, `gender.${code}`) : code

/** An Excel workbook: a "Products" sheet (column titles, dropdown lists, the given rows) and a "How to fill" sheet. */
export async function sheetWorkbook(rows: SheetRow[], lang: Lang): Promise<Blob> {
  const header = SHEET_COLUMNS.map((c) => tr(lang, `sheet.col_${c}`))
  const body = rows.map((r) => SHEET_COLUMNS.map((c) => {
    const v = r[c]
    if (CHOICE_COLUMNS[c]) return choiceText(lang, c, v)
    if (['cost_iqd', 'retail_iqd', 'wholesale_iqd', 'stock', 'min_stock', 'size'].includes(c) && v !== '' && Number.isFinite(Number(v))) return Number(v)
    return v
  }))
  const lists = Object.fromEntries(SHEET_COLUMNS.map((c, i) => [i, CHOICE_COLUMNS[c]?.map((code) => choiceText(lang, c, code))]).filter(([, l]) => l))
  const ex = (en: string, ar: string, ku: string, size: number, unit: string, cost: number, retail: number, whole: number, stock: number) =>
    [en, ar, ku, 'Lattafa', choiceText(lang, 'category', 'perfume'), choiceText(lang, 'gender', 'unisex'), 'EDP', size, unit, cost, retail, whole, stock, 5, '', '']
  return writeXlsx([
    {
      name: tr(lang, 'sheet.file_products'), rtl: lang !== 'en', rows: [header, ...body], lists,
      columns: SHEET_COLUMNS.map((c) => ({ width: WIDTHS[c], text: c === 'barcode' || c === 'sku', number: ['cost_iqd', 'retail_iqd', 'wholesale_iqd', 'stock', 'min_stock'].includes(c) })),
    },
    {
      name: tr(lang, 'sheet.file_help'), rtl: lang !== 'en', header: false, bold: [0, 8],
      columns: [{ width: 110 }, ...SHEET_COLUMNS.slice(1).map((c) => ({ width: WIDTHS[c] }))],
      rows: [
        [tr(lang, 'sheet.help_title')],
        ...[1, 2, 3, 4, 5, 6].map((n) => [`${n}. ${tr(lang, `sheet.help_${n}`)}`]),
        [],
        [tr(lang, 'sheet.help_example')],
        header,
        ex('Khamrah', 'خمرة', 'خەمرە', 100, 'ml', 22000, 36000, 30000, 12),
        ex('Khamrah', 'خمرة', 'خەمرە', 3.4, 'oz', 25000, 39000, 33000, 6),
      ],
    },
  ])
}

/** The catalogue as sheet rows (to download, change prices in Excel and upload again — rows are matched by SKU). */
export async function catalogueSheetRows(): Promise<SheetRow[]> {
  assertCan('products.import')
  const [products, variants] = await Promise.all([db.products.toArray(), db.variants.toArray()])
  const pmap = new Map(products.filter((p) => p.active).map((p) => [p.id, p]))
  return variants.filter((v) => v.active && pmap.has(v.productId)).map((v) => {
    const p = pmap.get(v.productId)!
    return {
      name_en: p.name.en, name_ar: p.name.ar, name_ku: p.name.ku, brand: p.brand, category: p.category, gender: p.gender, concentration: p.concentration,
      size: v.size > 0 ? trimNum(v.size) : '', unit: v.unit, cost_iqd: v.costIQD ? String(v.costIQD) : '', retail_iqd: String(v.retailIQD),
      wholesale_iqd: String(v.wholesaleIQD), stock: '', min_stock: String(v.minStock), barcode: v.barcode, sku: v.sku,
    }
  }).sort((a, b) => (a.name_en || a.name_ar).localeCompare(b.name_en || b.name_ar) || Number(b.size) - Number(a.size))
}

/* ───────── checking and saving ───────── */

export type CellErrors = Partial<Record<SheetCol, { key: string; vars?: Record<string, string | number> }>>

/** What is wrong with a row, cell by cell (empty = fine). Pure — no database. */
export function checkRow(r: SheetRow): CellErrors {
  const e: CellErrors = {}
  if (!r.name_en.trim() && !r.name_ar.trim() && !r.name_ku.trim()) e.name_en = { key: 'sheet.err_name' }
  const retail = readNumber(r.retail_iqd)
  if (retail === null) e.retail_iqd = { key: 'sheet.err_retail' }
  for (const c of ['cost_iqd', 'retail_iqd', 'wholesale_iqd', 'stock', 'min_stock'] as const) {
    if (!e[c] && Number.isNaN(readNumber(r[c]))) e[c] = { key: 'sheet.err_number' }
  }
  if (Number.isNaN(readNumber(r.size, true))) e.size = { key: 'sheet.err_number' }
  for (const [col, list] of Object.entries(CHOICE_COLUMNS) as [SheetCol, readonly string[]][]) {
    if (!list.includes(r[col])) e[col] = { key: `sheet.err_${col}` }
  }
  if (r.barcode.trim() && !/^[0-9A-Za-z\-]{4,32}$/.test(r.barcode.trim())) e.barcode = { key: 'sheet.err_barcode' }
  return e
}

/** ASCII letters/digits only, for SKUs: "Khamrah Qahwa" → "KHAMRAH-QAHWA". */
const skuPart = (s: string) => s.normalize('NFKD').replace(/[^\x20-\x7E]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')
const shortHash = (s: string) => { let h = 0; for (const ch of s) h = (h * 31 + ch.codePointAt(0)!) >>> 0; return h.toString(36).toUpperCase().slice(0, 5) }

export interface SaveResult { ok: true; status: 'added' | 'updated'; sku: string }
export interface SaveFailure { ok: false; errors: CellErrors; message?: string }

/**
 * Saves rows (one Enter = one row; "Add all" = many). Each row is checked first; the good ones go to the import in
 * one go. A row without a SKU that matches a size already in the catalogue (same perfume, same size) updates it;
 * otherwise it gets a new SKU such as LAT-KHAMRAH-100ML.
 */
export async function saveSheetRows(rows: SheetRow[]): Promise<(SaveResult | SaveFailure)[]> {
  assertCan('products.import')
  const [products, variants] = await Promise.all([db.products.toArray(), db.variants.toArray()])
  const productByKey = new Map(products.map((p) => [productKey(p.name.en, p.name.ar, p.name.ku, p.brand), p]))
  const bySku = new Map(variants.map((v) => [v.sku.toLowerCase(), v]))
  const nameOf = (productId: string) => { const p = products.find((x) => x.id === productId); return p ? p.name.en || p.name.ar || p.name.ku : '' }
  const usedSkus = new Set<string>(), usedBarcodes = new Map<string, number>(), sizesInBatch = new Map<string, number>()
  const out: (SaveResult | SaveFailure)[] = []
  const good: { i: number; row: CsvRow; existing: boolean }[] = []

  rows.forEach((r, i) => {
    const errors = checkRow(r)
    const name = { en: r.name_en.trim(), ar: r.name_ar.trim(), ku: r.name_ku.trim() }
    const brand = r.brand.trim() || 'Lattafa'
    const size = readNumber(r.size, true) ?? 0
    const unit = r.unit as SizeUnit
    const key = productKey(name.en, name.ar, name.ku, brand)
    // the same perfume and size twice in what is being saved
    const sizeKey = `${key}|${trimNum(size)}${unit}`
    if (!errors.name_en && sizesInBatch.has(sizeKey)) errors.size = { key: 'sheet.err_dup', vars: { n: sizesInBatch.get(sizeKey)! + 1 } }
    sizesInBatch.set(sizeKey, i)

    // which SKU: the one typed, the one of the same size already on file, or a new one
    let sku = r.sku.trim()
    if (!sku) {
      const p = productByKey.get(key)
      const same = p && variants.find((v) => v.productId === p.id && v.unit === unit && Math.abs(v.size - size) < 0.005)
      if (same) sku = same.sku
      else {
        const base = [skuPart(brand).slice(0, 3) || 'LTF', skuPart(name.en).slice(0, 14) || `P${shortHash(name.ar || name.ku)}`, size > 0 ? `${trimNum(size).replace('.', '_')}${unit.toUpperCase()}` : ''].filter(Boolean).join('-')
        sku = base
        for (let n = 2; bySku.has(sku.toLowerCase()) || usedSkus.has(sku.toLowerCase()); n++) sku = `${base}-${n}`
      }
    }
    if (usedSkus.has(sku.toLowerCase())) errors.sku = { key: 'sheet.err_sku_dup' }
    usedSkus.add(sku.toLowerCase())
    const existing = bySku.get(sku.toLowerCase())

    // a barcode belongs to one size only
    const barcode = r.barcode.trim()
    if (barcode && !errors.barcode) {
      const owner = variants.find((v) => v.barcode === barcode && v.id !== existing?.id)
      if (owner) errors.barcode = { key: 'sheet.err_barcode_taken', vars: { name: `${nameOf(owner.productId)} ${owner.label}`.trim() } }
      else if (usedBarcodes.has(barcode)) errors.barcode = { key: 'sheet.err_barcode_row', vars: { n: usedBarcodes.get(barcode)! + 1 } }
      usedBarcodes.set(barcode, i)
    }

    if (Object.keys(errors).length) { out[i] = { ok: false, errors }; return }
    const n = (s: string) => { const v = readNumber(s); return v === null ? '' : String(Math.round(v)) }
    good.push({
      i, existing: !!existing,
      row: {
        sku, barcode, name_en: name.en, name_ar: name.ar, name_ku: name.ku, brand, category: r.category, gender: r.gender, concentration: r.concentration,
        size_label: '', size: size > 0 ? String(size) : '', unit, ml: '', cost_iqd: n(r.cost_iqd), retail_iqd: n(r.retail_iqd),
        wholesale_iqd: n(r.wholesale_iqd), min_stock: n(r.min_stock), stock: n(r.stock),
      },
    })
  })

  if (good.length) {
    try {
      await importCatalog(good.map((g) => g.row))
      for (const g of good) out[g.i] = { ok: true, status: g.existing ? 'updated' : 'added', sku: g.row.sku }
    } catch (e) {
      // nothing was saved (the import is all-or-nothing): every row that was about to go keeps its place
      const code = e instanceof AppError ? e.code : ''
      for (const g of good) {
        const bad = code === 'barcode_taken' && (e as AppError).params?.sku === g.row.sku
        out[g.i] = { ok: false, errors: bad ? { barcode: { key: 'sheet.err_barcode_taken', vars: { name: String((e as AppError).params?.barcode ?? '') } } } : {}, message: bad ? undefined : code || String(e) }
      }
      if (!(e instanceof AppError)) throw e
    }
  }
  return out
}
