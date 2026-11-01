/** Bottle sizes: millilitres or fluid ounces, with the maths to compare them. */
import type { SizeUnit } from '@/data/types'

export const SIZE_UNITS: SizeUnit[] = ['ml', 'oz']

/** 1 US fluid ounce = 29.5735 ml. */
export const OZ_IN_ML = 29.5735

/** 3.40 → "3.4", 100 → "100" (no trailing zeros). */
export const trimNum = (n: number): string => String(Number(n.toFixed(2)))

/** The size as whole millilitres (3.4 oz → 101 ml). */
export const toMl = (size: number, unit: SizeUnit): number => (size > 0 ? Math.round(unit === 'oz' ? size * OZ_IN_ML : size) : 0)

/** "100 ml" / "3.4 oz"; empty when there is no size (gift sets, accessories). */
export const sizeLabel = (size: number, unit: SizeUnit): string => (size > 0 ? `${trimNum(size)} ${unit}` : '')

/**
 * A size label inside plain text (toasts, titles, <option>s): wrapped in Unicode first-strong isolates so
 * "100 ml" never shows as "ml 100" in Arabic / Kurdish. In JSX use <span className="num"> instead.
 */
export const bidiSize = (label: string): string => (label ? `\u2068${label}\u2069` : '')

/** The same bottle in the other unit, for a hint next to the input: 100 ml → "≈ 3.4 oz", 3.4 oz → "≈ 101 ml". */
export function otherUnit(size: number, unit: SizeUnit): string {
  if (!(size > 0)) return ''
  return unit === 'oz' ? `≈ ${toMl(size, 'oz')} ml` : `≈ ${(Math.round((size / OZ_IN_ML) * 10) / 10).toFixed(1).replace(/\.0$/, '')} oz`
}

/**
 * What a size box accepts while typing: digits, at most one dot, two decimals. Arabic-Indic digits
 * (٣٫٤ / ۳.۴) and a comma decimal ("3,4") are understood too. "3.4" stays "3.4"; "3." is kept so you can keep typing.
 */
export function cleanDecimal(s: string): string {
  const latin = s
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٫,]/g, '.')
  const x = latin.replace(/[^0-9.]/g, '')
  const i = x.indexOf('.')
  return i < 0 ? x : x.slice(0, i + 1) + x.slice(i + 1).replace(/[.]/g, '').slice(0, 2)
}

export const isSizeUnit =(u: unknown): u is SizeUnit => u === 'ml' || u === 'oz'
