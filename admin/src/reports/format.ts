import type { Lang } from '@/data/types'
import { pick, type TFn } from '@/i18n'
import { fmtDate, fmtDateTime } from '@/lib/date'
import { fmt, fmtUSD } from '@/lib/money'
import { dayDate } from '../lib'
import type { Column, Row, SoldLine } from './api'

/** Number-like columns: shown at the end of the cell, summed in totals. */
export const NUMERIC = new Set(['int', 'iqd', 'money', 'usd', 'pct'])
export const isNumeric = (c: Column) => NUMERIC.has(c.type)

/** Columns whose empty date means "never happened" (rather than "not applicable"). */
const NEVER = new Set(['lastSold', 'lastPayment'])

/** A cell as text — for the PDF and anywhere a plain string is wanted. */
export function cellText(c: Column, row: Row, t: TFn, lang: Lang): string {
  const v = row[c.key]
  if (v === null || v === undefined || v === '') {
    if ((c.type === 'date' || c.type === 'datetime') && NEVER.has(c.key)) return t('rx.never')
    return '—'
  }
  switch (c.type) {
    case 'name': return pick(v as Record<Lang, string>, lang) || '—'
    case 'label': return t(String(v))
    case 'day': return fmtDate(dayDate(String(v)).getTime())
    case 'date': return fmtDate(Number(v))
    case 'datetime': return fmtDateTime(Number(v))
    case 'int': return fmt(Number(v))
    case 'iqd': return `${Number(v) < 0 ? '−' : ''}${fmt(Math.abs(Number(v)))}`
    case 'money': return row.currency === 'USD' ? `$${fmtUSD(Number(v))}` : `${fmt(Number(v))} ${t('unit.iqd')}`
    case 'usd': return `$${fmtUSD(Number(v))}`
    case 'items': return (v as SoldLine[]).map((i) => `${pick(i.name as Record<Lang, string>, lang) || i.name.en} ${i.label} ×${i.qty}`).join(', ') || '—'
    case 'map': return String(v).replace(',', ', ')
    case 'pct': return `${Number(v).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`
    default:
      if (c.type.startsWith('enum:')) return t(c.type.slice(5) + String(v))
      return String(v)
  }
}

/** A cell for the Excel file: real numbers stay numbers (so they can be summed there), everything else is text. */
export function cellValue(c: Column, row: Row, t: TFn, lang: Lang): string | number | null {
  const v = row[c.key]
  if (v === null || v === undefined || v === '') return null
  if (NUMERIC.has(c.type)) return Number(v)
  if (c.type === 'day') return String(v)
  // a map spot becomes a link that opens in Google Maps from the Excel file too
  if (c.type === 'map') return mapUrl(String(v))
  if (c.type === 'date' || c.type === 'datetime') {
    const d = new Date(Number(v))
    const p = (n: number) => String(n).padStart(2, '0')
    const day = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    return c.type === 'date' ? day : `${day} ${p(d.getHours())}:${p(d.getMinutes())}`
  }
  return cellText(c, row, t, lang)
}

/** Google Maps at a "lat,lng" spot. */
export const mapUrl = (latLng: string) => `https://www.google.com/maps?q=${encodeURIComponent(latLng)}`

/** Dates are always Latin ("11 Oct 2026"): shown as one left-to-right piece, even inside Arabic or Kurdish text. */
export const isDateLike = (c: Column) => c.type === 'day' || c.type === 'date' || c.type === 'datetime'

/** Client-side sorting: numbers by value, the rest alphabetically; empty cells always last. */
export function sortRows(rows: Row[], c: Column, dir: 1 | -1, t: TFn, lang: Lang): Row[] {
  const num = NUMERIC.has(c.type) || c.type === 'date' || c.type === 'datetime'
  return [...rows].sort((a, b) => {
    const x = a[c.key], y = b[c.key]
    if (x === null || x === undefined) return 1
    if (y === null || y === undefined) return -1
    if (num) return (Number(x) - Number(y)) * dir
    return cellText(c, a, t, lang).localeCompare(cellText(c, b, t, lang), lang) * dir
  })
}
