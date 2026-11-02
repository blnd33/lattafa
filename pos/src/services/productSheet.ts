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
import { cleanCode } from '@/lib/code128'
import { trimNum } from '@/lib/size'
import { readXlsx, writeXlsx } from '@/lib/xlsx'
import { AppError, assertCan } from './context'
import { importCatalog, parseCsv, productKey, type CsvRow } from './csv'

export const SHEET_COLUMNS = [
  'name_en', 'name_ar', 'name_ku', 'brand', 'category', 'gender', 'concentration', 'size', 'unit',
  'cost_iqd', 'retail_iqd', 'wholesale_iqd', 'wholesale_usd', 'stock', 'min_stock', 'barcode', 'sku',
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
  concentration: from?.concentration ?? 'EDP', size: '', unit: from?.unit ?? 'ml', cost_iqd: '', retail_iqd: '', wholesale_iqd: '', wholesale_usd: '',
  stock: '', min_stock: '', barcode: '', sku: '',
})

const TYPED: SheetCol[] = ['name_en', 'name_ar', 'name_ku', 'size', 'cost_iqd', 'retail_iqd', 'wholesale_iqd', 'wholesale_usd', 'stock', 'min_stock', 'barcode', 'sku']
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
  wholesale_usd: ['wholesale_usd', 'wholesale $', 'dollar', 'dollar price', 'usd', 'price usd', '$', 'سعر الدولار', 'بالدولار', 'دولار', 'نرخی دۆلار', 'دۆلار'],
  stock: ['stock', 'qty', 'quantity', 'opening stock', 'الكمية', 'المخزون', 'الكمية الافتتاحية', 'بڕ', 'کۆگا', 'بڕی سەرەتا'],
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

/* ───────── a supplier's invoice ───────── */

/**
 * The supplier's invoice as it comes (Arabic columns: الباركود · القيمة · الحسم · السعر · الكمية · المادة · ت), with the
 * shop's own columns added: the cost in dinars (السعر × the rate in the title row) and the selling price.
 */
const INVOICE_HEADERS = {
  barcode: ['الباركود', 'باركود', 'barcode', 'بارکۆد'],
  name: ['المادة', 'اسم المادة', 'الصنف', 'item', 'description'],
  qty: ['الكمية', 'العدد', 'qty', 'quantity'],
  usd: ['السعر', 'سعر الوحدة', 'price', 'unit price'],
  discount: ['الحسم', 'الخصم', 'خصم', 'discount'],
  // these three may have more words after them: "cost price in dinnar", "Rate (D × )"
  cost: ['cost', 'الكلفة', 'سعر الكلفة', 'التكلفة', 'تێچوو'],
  sell: ['selling price', 'sell price', 'sale price', 'retail', 'سعر البيع', 'البيع', 'سعر المفرد', 'نرخی فرۆشتن'],
  rate: ['rate', 'سعر الصرف', 'الصرف'],
}
type InvoiceCol = keyof typeof INVOICE_HEADERS
const PREFIX_COLS: InvoiceCol[] = ['cost', 'sell', 'rate']

function invoiceColumns(header: string[]): Partial<Record<InvoiceCol, number>> | null {
  const cols: Partial<Record<InvoiceCol, number>> = {}
  header.forEach((cell, i) => {
    const h = norm(cell)
    if (!h) return
    const kind = (Object.keys(INVOICE_HEADERS) as InvoiceCol[]).find((k) => cols[k] === undefined &&
      INVOICE_HEADERS[k].some((w) => h === norm(w) || (PREFIX_COLS.includes(k) && h.startsWith(`${norm(w)} `))))
    if (kind) cols[kind] = i
  })
  if (cols.barcode === undefined || cols.name === undefined || cols.qty === undefined || (cols.usd === undefined && cols.cost === undefined)) return null
  // the selling price may have no title yet: the column right after the cost
  if (cols.sell === undefined && cols.cost !== undefined && !(header[cols.cost + 1] ?? '').trim()) cols.sell = cols.cost + 1
  return cols
}

const SIZE_IN_NAME = /(\d+(?:[.,]\d+)?)\s*(?:مللي|ملل|ملي|مل|ml)(?![\p{L}])/iu
/** "عطر خمرة 100مل / لطافة 4د" → Khamrah's row: name خمرة, 100 ml, Lattafa. The size and brand stay empty when not in the name. */
export function readInvoiceName(raw: string): Pick<SheetRow, 'name_ar' | 'brand' | 'category' | 'gender' | 'concentration' | 'size' | 'unit'> {
  let text = raw.replace(/\s+/g, ' ').trim()
  const size = SIZE_IN_NAME.exec(text)
  if (size) text = text.replace(size[0], ' ')
  const [left, ...after] = text.split('/')
  const rest = after.join(' ')
  const brand = /لطاف[ةه]\s*برايد/.test(rest) ? 'Lattafa Pride' : /نيش/.test(rest) ? 'Niche Emarati' : 'Lattafa'
  // after the "/" come the brand and the supplier's codes ("4د", "@"); anything else there is part of the name
  const extra = rest.replace(/لطاف[ةه]\s*برايد|لطاف[ةه]|نيش/g, ' ').replace(/(^|\s)\d+\s*د(?=\s|$)/g, ' ').replace(/[@*]/g, ' ')
  let name = `${left} ${extra}`.replace(/\s+/g, ' ').trim()
  // the kind of product is the first word(s); "عطر" (perfume) is left out of the name, the others stay so a body mist
  // or an air freshener never becomes a size of the perfume of the same name
  let category = 'perfume', concentration = 'EDP'
  if (/^(سيت|طقم)(\s|$)/.test(name)) [category, concentration] = ['set', 'Set']
  else if (/^معطر\s?(جو|فراش)(\s|$)/.test(name)) [category, concentration] = ['home', 'Mist']
  else if (/^معطر(\s|$)/.test(name)) [category, concentration] = ['mist', 'Mist']
  else if (/^دهن(\s|$)/.test(name)) [category, concentration] = ['oil', 'Oil']
  else name = name.replace(/^عطر\s+/, '')
  const gender = /(^|\s)(لل)?رجال(ي|ى)?(\s|$)/.test(raw) ? 'men' : /(^|\s)(لل)?(نساء|نسائي|نسائى)(\s|$)/.test(raw) ? 'women' : 'unisex'
  return { name_ar: name, brand, category, gender, concentration, size: size ? trimNum(readNumber(size[1], true) ?? 0) : '', unit: 'ml' }
}

/**
 * A supplier's invoice → row patches, or null when the table isn't one. The free pieces (100% discount — the bottle the
 * supplier adds to show) are left out, so the stock counts what was bought; the same item twice becomes one row.
 */
export function invoiceToPatches(table: string[][]): { patches: Partial<SheetRow>[]; free: number } | null {
  for (let h = 0; h < Math.min(table.length, 15); h++) {
    const cols = table[h] && invoiceColumns(table[h])
    if (!cols) continue
    const header = table[h]
    // the exchange rate is the number next to its title ("Rate (D × )" | 1700)
    const rate = cols.rate !== undefined ? header.slice(cols.rate + 1).map((c) => readNumber(c)).find((n): n is number => typeof n === 'number' && n > 0) : undefined
    const cell = (r: string[], c?: number) => (c === undefined ? '' : (r[c] ?? '').trim())
    const byKey = new Map<string, Partial<SheetRow>>()
    let free = 0
    for (const r of table.slice(h + 1)) {
      if (!r) continue
      const raw = cell(r, cols.name)
      // the end of the list ("***** انتهى *****") and the totals under it are not items
      if (!/\p{L}/u.test(raw) || /انتهى/.test(raw)) continue
      const discount = readNumber(cell(r, cols.discount).replace('%', ''))
      if (discount === 100) { free++; continue }
      const qty = readNumber(cell(r, cols.qty))
      const usd = readNumber(cell(r, cols.usd))
      const cost = readNumber(cell(r, cols.cost)) ?? (typeof usd === 'number' && rate ? usd * rate : null)
      const sell = readNumber(cell(r, cols.sell))
      // a note in the barcode cell ("الباركود مكرر في …") is not a barcode: the item gets one of ours
      const code = cleanCode(cell(r, cols.barcode))
      const barcode = /^[0-9A-Za-z-]{4,32}$/.test(code) ? code : ''
      const p: Partial<SheetRow> = {
        ...readInvoiceName(raw), barcode, stock: typeof qty === 'number' && qty > 0 ? String(Math.round(qty)) : '',
        cost_iqd: typeof cost === 'number' && cost > 0 ? String(Math.round(cost)) : '', retail_iqd: typeof sell === 'number' && sell > 0 ? String(Math.round(sell)) : '',
      }
      const key = barcode || `${p.name_ar}|${p.brand}|${p.size}`
      const same = byKey.get(key)
      if (same) {
        // the same item on two lines: the pieces add up, the later prices win
        const pieces = Number(same.stock || 0) + Number(p.stock || 0)
        byKey.set(key, { ...same, cost_iqd: p.cost_iqd || same.cost_iqd, retail_iqd: p.retail_iqd || same.retail_iqd, stock: pieces ? String(pieces) : '' })
      } else byKey.set(key, p)
    }
    return { patches: [...byKey.values()], free }
  }
  return null
}

/** Cells a row from a supplier's invoice still needs: the selling price, and the size when the name doesn't say it (a gift set has none). */
export const invoiceNeeds = (p: Partial<SheetRow>): SheetCol[] =>
  [...(!p.retail_iqd?.trim() ? ['retail_iqd' as const] : []), ...(!p.size?.trim() && p.category !== 'set' ? ['size' as const] : [])]

/**
 * Items already in the catalogue are filled in from it: the row then updates that size — the new cost, the selling price
 * if the invoice has one, and its pieces are added to the stock. Found by barcode, else by the Arabic name, brand and
 * size (an item the supplier sends without a barcode; with no size in the name, a perfume that has only one size).
 */
async function matchCatalogue(patches: Partial<SheetRow>[]): Promise<{ patches: Partial<SheetRow>[]; known: number }> {
  const [products, variants] = await Promise.all([db.products.toArray(), db.variants.toArray()])
  const pmap = new Map(products.map((p) => [p.id, p]))
  const byBarcode = new Map(variants.filter((v) => v.barcode).map((v) => [v.barcode, v]))
  const nameKey = (ar: string, brand: string) => `${ar.trim().toLowerCase()}|${brand.trim().toLowerCase()}`
  const byName = new Map(products.filter((p) => p.name.ar?.trim()).map((p) => [nameKey(p.name.ar, p.brand), p]))
  const byNameAndSize = (p: Partial<SheetRow>) => {
    const prod = byName.get(nameKey(p.name_ar ?? '', p.brand ?? ''))
    if (!prod) return undefined
    const sizes = variants.filter((v) => v.productId === prod.id && v.active)
    const size = readNumber(p.size ?? '', true)
    return typeof size === 'number' ? sizes.find((v) => v.unit === p.unit && Math.abs(v.size - size) < 0.005) : sizes.length === 1 ? sizes[0] : undefined
  }
  let known = 0
  const out = patches.map((p) => {
    const v = (p.barcode && byBarcode.get(p.barcode)) || byNameAndSize(p)
    const prod = v && pmap.get(v.productId)
    if (!v || !prod) return p
    known++
    return {
      ...p, sku: v.sku, name_en: prod.name.en, name_ar: prod.name.ar || p.name_ar, name_ku: prod.name.ku, brand: prod.brand, category: prod.category,
      gender: prod.gender, concentration: prod.concentration, size: v.size > 0 ? trimNum(v.size) : '', unit: v.unit,
      cost_iqd: p.cost_iqd || (v.costIQD ? String(v.costIQD) : ''), retail_iqd: p.retail_iqd || String(v.retailIQD),
      wholesale_iqd: String(v.wholesaleIQD), wholesale_usd: v.wholesaleUSDCents ? trimNum(v.wholesaleUSDCents / 100) : '', min_stock: String(v.minStock),
    }
  })
  return { patches: out, known }
}

/* ───────── Excel files ───────── */

export interface SheetFile {
  patches: Partial<SheetRow>[]
  sheet: string
  /** Set when the file was a supplier's invoice: what each row still needs, the free-piece lines left out, the items already on file. */
  invoice?: { need: SheetCol[][]; free: number; known: number }
}

/**
 * Rows from an uploaded file: an Excel workbook (.xlsx — the first sheet with column titles, or a supplier's invoice)
 * or a CSV file. Errors: `file_xls` (the old binary format), `file_no_header`, `file_bad`.
 */
export async function readSheetFile(file: File): Promise<SheetFile> {
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
    const invoice = invoiceToPatches(t.rows)
    if (invoice) {
      const { patches, known } = await matchCatalogue(invoice.patches)
      return { patches, sheet: t.name, invoice: { need: patches.map((p) => (p.sku ? [] : invoiceNeeds(p))), free: invoice.free, known } }
    }
    const patches = tableToPatches(t.rows)
    if (patches) return { patches, sheet: t.name }
  }
  throw new AppError('file_no_header')
}

const tr = (lang: Lang, key: string) => translate(lang, key)
const WIDTHS: Record<SheetCol, number> = {
  name_en: 26, name_ar: 24, name_ku: 24, brand: 14, category: 16, gender: 12, concentration: 14, size: 9, unit: 8,
  cost_iqd: 13, retail_iqd: 18, wholesale_iqd: 15, wholesale_usd: 14, stock: 13, min_stock: 15, barcode: 18, sku: 24,
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
    if (['cost_iqd', 'retail_iqd', 'wholesale_iqd', 'wholesale_usd', 'stock', 'min_stock', 'size'].includes(c) && v !== '' && Number.isFinite(Number(v))) return Number(v)
    return v
  }))
  const lists = Object.fromEntries(SHEET_COLUMNS.map((c, i) => [i, CHOICE_COLUMNS[c]?.map((code) => choiceText(lang, c, code))]).filter(([, l]) => l))
  const ex = (en: string, ar: string, ku: string, size: number, unit: string, cost: number, retail: number, whole: number, usd: number, stock: number) =>
    [en, ar, ku, 'Lattafa', choiceText(lang, 'category', 'perfume'), choiceText(lang, 'gender', 'unisex'), 'EDP', size, unit, cost, retail, whole, usd, stock, 5, '', '']
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
        ...[1, 2, 3, 4, 5, 6, 7].map((n) => [`${n}. ${tr(lang, `sheet.help_${n}`)}`]),
        [],
        [tr(lang, 'sheet.help_example')],
        header,
        ex('Khamrah', 'خمرة', 'خەمرە', 100, 'ml', 22000, 36000, 30000, 20.5, 12),
        ex('Khamrah', 'خمرة', 'خەمرە', 3.4, 'oz', 25000, 39000, 33000, 22.5, 6),
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
      wholesale_iqd: String(v.wholesaleIQD), wholesale_usd: v.wholesaleUSDCents ? trimNum(v.wholesaleUSDCents / 100) : '', stock: '', min_stock: String(v.minStock), barcode: v.barcode, sku: v.sku,
    }
  }).sort((a, b) => (a.name_en || a.name_ar).localeCompare(b.name_en || b.name_ar) || Number(b.size) - Number(a.size))
}

/* ───────── checking and saving ───────── */

export type CellErrors = Partial<Record<SheetCol, { key: string; vars?: Record<string, string | number> }>>

/** What is wrong with a row, cell by cell (empty = fine). `need`: cells this row must have (a supplier's invoice). Pure — no database. */
export function checkRow(r: SheetRow, need: readonly SheetCol[] = []): CellErrors {
  const e: CellErrors = {}
  for (const c of need) if (!r[c].trim()) e[c] = { key: c === 'retail_iqd' ? 'sheet.err_retail' : 'sheet.err_needed' }
  if (!r.name_en.trim() && !r.name_ar.trim() && !r.name_ku.trim()) e.name_en = { key: 'sheet.err_name' }
  const retail = readNumber(r.retail_iqd)
  if (retail === null) e.retail_iqd = { key: 'sheet.err_retail' }
  for (const c of ['cost_iqd', 'retail_iqd', 'wholesale_iqd', 'stock', 'min_stock'] as const) {
    if (!e[c] && Number.isNaN(readNumber(r[c]))) e[c] = { key: 'sheet.err_number' }
  }
  if (Number.isNaN(readNumber(r.wholesale_usd, true))) e.wholesale_usd = { key: 'sheet.err_number' }
  if (Number.isNaN(readNumber(r.size, true))) e.size = { key: 'sheet.err_number' }
  for (const [col, list] of Object.entries(CHOICE_COLUMNS) as [SheetCol, readonly string[]][]) {
    if (!list.includes(r[col])) e[col] = { key: `sheet.err_${col}` }
  }
  if (cleanCode(r.barcode) && !/^[0-9A-Za-z\-]{4,32}$/.test(cleanCode(r.barcode))) e.barcode = { key: 'sheet.err_barcode' }
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
 * otherwise it gets a new SKU such as LAT-KHAMRAH-100ML. The quantity is the opening stock of a new size and is added
 * to the stock of one already on file. `need`: per row, cells that must be filled (see `checkRow`).
 */
export async function saveSheetRows(rows: SheetRow[], need: (readonly SheetCol[] | undefined)[] = []): Promise<(SaveResult | SaveFailure)[]> {
  assertCan('products.import')
  const [products, variants] = await Promise.all([db.products.toArray(), db.variants.toArray()])
  const productByKey = new Map(products.map((p) => [productKey(p.name.en, p.name.ar, p.name.ku, p.brand), p]))
  const bySku = new Map(variants.map((v) => [v.sku.toLowerCase(), v]))
  const nameOf = (productId: string) => { const p = products.find((x) => x.id === productId); return p ? p.name.en || p.name.ar || p.name.ku : '' }
  const usedSkus = new Set<string>(), usedBarcodes = new Map<string, number>(), sizesInBatch = new Map<string, number>()
  const out: (SaveResult | SaveFailure)[] = []
  const good: { i: number; row: CsvRow; existing: boolean }[] = []

  rows.forEach((r, i) => {
    const errors = checkRow(r, need[i])
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
    const barcode = cleanCode(r.barcode)
    if (barcode && !errors.barcode) {
      const owner = variants.find((v) => v.barcode === barcode && v.id !== existing?.id)
      if (owner) errors.barcode = { key: 'sheet.err_barcode_taken', vars: { name: `${nameOf(owner.productId)} ${owner.label}`.trim() } }
      else if (usedBarcodes.has(barcode)) errors.barcode = { key: 'sheet.err_barcode_row', vars: { n: usedBarcodes.get(barcode)! + 1 } }
      usedBarcodes.set(barcode, i)
    }

    if (Object.keys(errors).length) { out[i] = { ok: false, errors }; return }
    const n = (s: string) => { const v = readNumber(s); return v === null ? '' : String(Math.round(v)) }
    // "12.5" dollars → 1250 cents (kept whole so the price is exact)
    const cents = (s: string) => { const v = readNumber(s, true); return v === null ? '' : String(Math.round(v * 100)) }
    good.push({
      i, existing: !!existing,
      row: {
        sku, barcode, name_en: name.en, name_ar: name.ar, name_ku: name.ku, brand, category: r.category, gender: r.gender, concentration: r.concentration,
        size_label: '', size: size > 0 ? String(size) : '', unit, ml: '', cost_iqd: n(r.cost_iqd), retail_iqd: n(r.retail_iqd),
        wholesale_iqd: n(r.wholesale_iqd), wholesale_usd: cents(r.wholesale_usd), min_stock: n(r.min_stock), stock: n(r.stock),
      },
    })
  })

  if (good.length) {
    try {
      await importCatalog(good.map((g) => g.row), { addStock: true })
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
