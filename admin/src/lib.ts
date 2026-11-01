import type { Lang } from '@/data/types'
import type { TFn } from '@/i18n'

/** 1,250,000 → "1.25M", 450,000 → "450K": short amounts for chart axes and tight spots. */
export function compact(n: number): string {
  const a = Math.abs(n)
  if (a >= 1_000_000) return `${+(n / 1_000_000).toFixed(a >= 10_000_000 ? 1 : 2)}M`
  if (a >= 1_000) return `${+(n / 1_000).toFixed(a >= 100_000 ? 0 : 1)}K`
  return String(Math.round(n))
}

/** "1 bill" / "3 bills": `one` is the key for exactly one, `many` takes {n}. */
export const plural = (t: TFn, n: number, one: string, many: string) => (n === 1 ? t(one) : t(many, { n }))

/** Change against the period before, in %; null when there is nothing to compare with. */
export function change(cur: number, prev: number): number | null {
  if (!prev) return null
  return ((cur - prev) / Math.abs(prev)) * 100
}

const MIN = 60_000
/** "just now" / "12 min ago" / "3 h ago" / "2 days ago" (same words as the POS delegates page). */
export function ago(at: number, t: TFn, now = Date.now()): string {
  const d = now - at
  if (d < 2 * MIN) return t('dlg.ago_now')
  if (d < 60 * MIN) return t('dlg.ago_min', { n: Math.round(d / MIN) })
  if (d < 48 * 60 * MIN) return t('dlg.ago_h', { n: Math.round(d / (60 * MIN)) })
  return t('dlg.ago_d', { n: Math.round(d / (24 * 60 * MIN)) })
}

/** Seen in the last 10 minutes = green, within the hour = amber, older = grey. */
export const freshness = (at: number | null, now = Date.now()) =>
  at === null ? 'bg-fg-2/30' : now - at < 10 * MIN ? 'bg-success' : now - at < 60 * MIN ? 'bg-warning' : 'bg-fg-2/40'

export function greeting(t: TFn, name: string, hour = new Date().getHours()): string {
  const first = name.trim().split(/\s+/)[0] ?? name
  return t(hour < 12 ? 'ap.greet_morning' : hour < 17 ? 'ap.greet_afternoon' : 'ap.greet_evening', { name: first })
}

/** Dates with Latin digits in every language, like the rest of the system. */
export const locale = (lang: Lang) => (lang === 'ar' ? 'ar-IQ-u-nu-latn' : lang === 'ku' ? 'ckb-IQ-u-nu-latn' : 'en-GB')

/** "2026-10-09" (shop day) → a local Date at noon (safe from any timezone edge). */
export const dayDate = (key: string) => new Date(`${key}T12:00:00`)

// Browsers have no Kurdish (Sorani) dates and quietly fall back to English, so those names are kept here.
const KU_DAYS = ['یەکشەممە', 'دووشەممە', 'سێشەممە', 'چوارشەممە', 'پێنجشەممە', 'هەینی', 'شەممە']
const KU_MONTHS = ['کانوونی دووەم', 'شوبات', 'ئازار', 'نیسان', 'ئایار', 'حوزەیران', 'تەممووز', 'ئاب', 'ئەیلوول', 'تشرینی یەکەم', 'تشرینی دووەم', 'کانوونی یەکەم']

/** "Friday 9 October 2026" in the chosen language. */
export function longDate(d: Date, lang: Lang): string {
  if (lang === 'ku') return `${KU_DAYS[d.getDay()]}، ${d.getDate()}ی ${KU_MONTHS[d.getMonth()]} ${d.getFullYear()}`
  return new Intl.DateTimeFormat(locale(lang), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d)
}

/** Day name for the week chart: "Fri" / "الجمعة" / "هەینی". */
export function weekday(d: Date, lang: Lang): string {
  return lang === 'ku' ? KU_DAYS[d.getDay()] : new Intl.DateTimeFormat(locale(lang), { weekday: 'short' }).format(d)
}

/** "October 2026" */
export function monthYear(d: Date, lang: Lang): string {
  return lang === 'ku' ? `${KU_MONTHS[d.getMonth()]} ${d.getFullYear()}` : new Intl.DateTimeFormat(locale(lang), { month: 'long', year: 'numeric' }).format(d)
}

/** "9 Oct" for the month chart. */
export function dayMonth(d: Date, lang: Lang): string {
  return lang === 'ku' ? `${d.getDate()} ${KU_MONTHS[d.getMonth()]}` : new Intl.DateTimeFormat(locale(lang), { day: 'numeric', month: 'short' }).format(d)
}
