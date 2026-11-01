/** Money helpers. IQD is always an integer; USD is shown with 2 decimals. */

const int = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const usd = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** 1234567 → "1,234,567" (Latin digits on purpose — cashiers read them faster). */
export const fmt = (n: number): string => int.format(Math.round(n))
export const fmtUSD = (n: number): string => usd.format(n)

/** Round to the nearest `step` (250 = smallest IQD note). step 0 → whole dinar. */
export function roundTo(n: number, step: number): number {
  if (!step) return Math.round(n)
  return Math.round(n / step) * step
}

/** Round *up* to a step (used for "customer pays enough" suggestions). */
export function ceilTo(n: number, step: number): number {
  if (!step) return Math.ceil(n)
  return Math.ceil(n / step) * step
}

export const iqdToUsd = (iqd: number, rate: number): number => (rate > 0 ? iqd / rate : 0)
export const usdToIqd = (usdAmount: number, rate: number): number => Math.round(usdAmount * rate)

/** "12345" | "12,345" | "١٢٣٤٥" → 12345; garbage → 0. */
export function parseAmount(s: string | number): number {
  if (typeof s === 'number') return Number.isFinite(s) ? s : 0
  const latin = s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
  const n = parseFloat(latin.replace(/[^\d.]/g, ''))
  return Number.isFinite(n) ? n : 0
}

export const IQD_NOTES = [50000, 25000, 10000, 5000, 1000, 500, 250] as const
export const USD_NOTES = [100, 50, 20, 10, 5, 1] as const

/** Handy "customer gives" suggestions for a bill: exact + next round notes. */
export function cashSuggestions(amountIQD: number): number[] {
  const out = new Set<number>([amountIQD])
  for (const step of [5000, 10000, 25000, 50000, 100000]) out.add(ceilTo(amountIQD, step))
  return [...out].filter((v) => v >= amountIQD).sort((a, b) => a - b).slice(0, 4)
}
