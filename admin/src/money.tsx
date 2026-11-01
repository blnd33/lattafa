import { Amt, UsdAmt } from '@/components/ui/Amt'
import type { TFn } from '@/i18n'
import { fmt, fmtUSD } from '@/lib/money'

/** Buying and spending happen in dinars or dollars. */
export type Currency = 'IQD' | 'USD'
export const CURRENCIES: Currency[] = ['USD', 'IQD']

/** "$1,234.50" or "1,250,000 IQD" — digits left-to-right in every language. */
export function Money({ v, currency, className }: { v: number; currency: Currency; className?: string }) {
  return currency === 'USD' ? <UsdAmt n={v} className={className} /> : <Amt n={v} className={className} />
}

/** The same as text, for messages. */
export const fmtMoney = (v: number, currency: Currency, t: TFn) => (currency === 'USD' ? `$${fmtUSD(v)}` : `${fmt(v)} ${t('unit.iqd')}`)

/** Cents, so sums never drift: 18.5 × 3 is exactly 55.50. */
export const cents = (v: number | string, currency: Currency) => {
  const n = typeof v === 'string' ? Number(v.replace(/,/g, '')) : v
  if (!Number.isFinite(n)) return 0
  return currency === 'IQD' ? Math.round(n) * 100 : Math.round(n * 100)
}
export const fromCents = (c: number) => Math.round(c) / 100
