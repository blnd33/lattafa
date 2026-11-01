import { useMemo } from 'react'
import { Amt } from '@/components/ui/Amt'
import { isRtl, useT } from '@/i18n'
import { fmt } from '@/lib/money'
import { useUI } from '@/store/ui'
import { compact, dayDate, dayMonth, plural, weekday } from '../lib'
import type { Dashboard } from './api'

/** Store = gold, delegates = ink (ivory in dark mode): the two brand colours, told apart by lightness and the legend. */
export const STORE_FILL = 'fill-gold'
export const DELEGATE_FILL = 'fill-ink dark:fill-ivory'
export const STORE_BG = 'bg-gold'
export const DELEGATE_BG = 'bg-ink dark:bg-ivory'

/** A round number at or above `n` for the top of the axis: 1, 2, 2.5, 5 × 10^k. */
function niceCeil(n: number): number {
  if (n <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(n))
  return ([1, 2, 2.5, 5, 10].find((m) => m * p >= n) ?? 10) * p
}

/** A bar with rounded top corners only (so stacked parts sit flush). */
function topRounded(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h)
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`
}

type Point = Dashboard['series']['points'][number]

/** Takings per hour (today) or per day, the shop and the delegates stacked. */
export function SalesChart({ series }: { series: Dashboard['series'] }) {
  const t = useT()
  const lang = useUI((s) => s.lang)
  const points = useMemo(() => {
    if (series.unit !== 'hour') return series.points
    // today: start at 8 in the morning, or earlier if something was sold earlier
    const first = series.points.findIndex((p) => p.storeIQD + p.delegateIQD > 0)
    const start = Math.min(first === -1 ? 8 : first, 8)
    return series.points.slice(Math.min(start, Math.max(0, series.points.length - 1)))
  }, [series])

  const label = useMemo(() => {
    if (series.unit === 'hour') return (p: Point) => `${p.key}:00`
    return points.length <= 7 ? (p: Point) => weekday(dayDate(p.key), lang) : (p: Point) => dayMonth(dayDate(p.key), lang)
  }, [series.unit, lang, points.length])

  const max = niceCeil(Math.max(0, ...points.map((p) => p.storeIQD + p.delegateIQD)))
  const H = 230
  const top = 12
  const base = 192
  const axis = 46 // room for the amounts
  const slot = points.length > 14 ? 26 : points.length > 8 ? 40 : 64
  const W = axis + points.length * slot + 8
  // Arabic / Kurdish read right to left: time runs from the right, the amounts sit on the right edge
  const rtl = isRtl(lang)
  const plotStart = rtl ? 8 : axis
  const plotEnd = rtl ? W - axis : W - 8
  const slotX = (i: number) => (rtl ? plotEnd - (i + 1) * slot : plotStart + i * slot)
  const barW = Math.min(30, slot * 0.62)
  const y = (v: number) => base - (v / max) * (base - top)
  const every = points.length > 20 ? 5 : points.length > 14 ? 2 : 1
  const total = points.reduce((s, p) => s + p.storeIQD + p.delegateIQD, 0)

  return (
    <div className="-mx-1 overflow-x-auto px-1 scroll-hide">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-60 w-full" style={{ minWidth: Math.min(W, 640) }} role="img" aria-label={`${t('ap.chart_title')}: ${fmt(total)} ${t('unit.iqd')}`}>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={plotStart} x2={plotEnd} y1={y(max * f)} y2={y(max * f)} className="stroke-line" strokeDasharray={f === 0 ? undefined : '3 4'} />
            <text x={rtl ? plotEnd + 8 : plotStart - 8} y={y(max * f) + 3.5} textAnchor={rtl ? 'start' : 'end'} direction="ltr" className="num fill-fg-2 text-[10px]">{compact(max * f)}</text>
          </g>
        ))}
        {points.map((p, i) => {
          const x = slotX(i) + (slot - barW) / 2
          const hs = base - y(p.storeIQD)
          const hd = base - y(p.delegateIQD)
          const tip = `${label(p)} — ${t('ap.shop')}: ${fmt(p.storeIQD)} · ${t('ap.delegates')}: ${fmt(p.delegateIQD)} ${t('unit.iqd')}`
          return (
            <g key={p.key}>
              <title>{tip}</title>
              {/* a wide invisible target so the tooltip is easy to hit */}
              <rect x={slotX(i)} y={top} width={slot} height={base - top} fill="transparent" />
              {hs > 0 && (hd > 0 ? <rect x={x} y={base - hs} width={barW} height={hs} className={STORE_FILL} /> : <path d={topRounded(x, base - hs, barW, hs, 5)} className={STORE_FILL} />)}
              {hd > 0 && <path d={topRounded(x, base - hs - hd, barW, hd, 5)} className={DELEGATE_FILL} />}
              {(i % every === 0 || i === points.length - 1) && (
                <text x={slotX(i) + slot / 2} y={base + 18} textAnchor="middle" className="num fill-fg-2 text-[10px]">{label(p)}</text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/** Shop vs delegates as a ring, with the amounts beside it. */
export function SplitRing({ channels }: { channels: Dashboard['channels'] }) {
  const t = useT()
  const store = channels.store.revenueIQD
  const delegate = channels.delegate.revenueIQD
  const total = store + delegate
  const R = 52
  const C = 2 * Math.PI * R
  const storeLen = total ? (store / total) * C : 0
  const pct = (v: number) => (total ? Math.round((v / total) * 100) : 0)
  const rows = [
    { key: 'store', label: t('ap.shop'), v: store, n: channels.store.count, bg: 'bg-gold' },
    { key: 'delegate', label: t('ap.delegates'), v: delegate, n: channels.delegate.count, bg: DELEGATE_BG },
  ]
  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg viewBox="0 0 140 140" className="size-36 shrink-0 -rotate-90" role="img" aria-label={rows.map((r) => `${r.label} ${pct(r.v)}%`).join(', ')}>
        <circle cx="70" cy="70" r={R} fill="none" strokeWidth="16" className="stroke-surface-2" />
        {total > 0 && <circle cx="70" cy="70" r={R} fill="none" strokeWidth="16" className="stroke-ink dark:stroke-ivory" />}
        {storeLen > 0 && <circle cx="70" cy="70" r={R} fill="none" strokeWidth="16" className="stroke-gold" strokeDasharray={`${storeLen} ${C}`} strokeLinecap={storeLen < C ? 'butt' : undefined} />}
      </svg>
      <ul className="min-w-0 flex-1 space-y-3">
        {rows.map((r) => (
          <li key={r.key} className="flex items-start gap-2.5">
            <span className={`mt-1.5 size-3 shrink-0 rounded-full ${r.bg}`} aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{r.label}</span>
                <span className="num text-sm font-semibold">{pct(r.v)}%</span>
              </div>
              <div className="text-xs text-fg-2"><Amt n={r.v} /> · {plural(t, r.n, 'ap.bill_1', 'ap.bills_n')}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
