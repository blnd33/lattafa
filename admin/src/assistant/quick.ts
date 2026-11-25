import type { Lang } from '@/data/types'
import type { TFn } from '@/i18n'
import { fmt, fmtUSD } from '@/lib/money'
import { getOrders } from '../catalogue/api'
import { getDashboard } from '../dashboard/api'
import { getDebts, type DebtPeriod } from '../debts/api'
import { listExpenses } from '../expenses/api'
import { presetRange, runReport, type Column, type ReportId, type ReportTable, type Row } from '../reports/api'
import { cellText } from '../reports/format'

/**
 * The assistant's built-in questions: free, instant and exact. Each one reads the same API the admin panel's screens
 * use (so the server's permission checks still apply) and writes its answer as the small Markdown the chat shows.
 * No AI is involved; typed questions need the Claude key (see AssistantPage).
 */
export type QuickPeriod = DebtPeriod // today | week | month | quarter
export const QUICK_PERIODS: QuickPeriod[] = ['today', 'week', 'month', 'quarter']

export interface QuickQuestion {
  id: string
  /** shown to people holding ANY of these */
  perms: string[]
  /** answers "as of now" — the period does not change it */
  now?: boolean
  run: (ctx: QuickCtx) => Promise<string>
}

export interface QuickCtx { period: QuickPeriod; t: TFn; lang: Lang }

const PRESET = { today: 'today', week: '7', month: '30', quarter: '90' } as const

/** The period's first and last millisecond, and the same stretch just before it (to compare). */
export function periodRange(p: QuickPeriod, now = new Date()): { from: number; to: number; prevFrom: number; prevTo: number } {
  const [from, to] = presetRange(PRESET[p], now)
  const len = to - from + 1
  return { from, to, prevFrom: from - len, prevTo: from - 1 }
}

/* ───────── writing the answer ───────── */

const iqd = (n: number, t: TFn) => `${n < 0 ? '−' : ''}${fmt(Math.abs(Math.round(n)))} ${t('unit.iqd')}`
const cell = (s: string) => s.replace(/\|/g, '/').replace(/\n/g, ' ')
const line = (label: string, value: string) => `- **${label}:** ${value}`

function table(head: string[], rows: string[][]): string {
  if (!rows.length) return ''
  return [`| ${head.map(cell).join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n')
}

/** Some of a report's columns as a table, each cell formatted as on the Reports screen. */
function reportTable(r: ReportTable, keys: string[], rows: Row[], ctx: QuickCtx): string {
  const cols = keys.map((k) => r.columns.find((c) => c.key === k)).filter((c): c is Column => !!c)
  const head = cols.map((c) => (c.type === 'iqd' ? `${ctx.t(c.label)} (${ctx.t('unit.iqd')})` : ctx.t(c.label)))
  return table(head, rows.map((row) => cols.map((c) => cellText(c, row, ctx.t, ctx.lang))))
}

/** A report's own summary figures, as bullet points. */
function summary(r: ReportTable, t: TFn): string {
  return r.summary.map((s) => line(t(s.label), s.type === 'iqd' ? iqd(s.value, t) : s.type === 'usd' ? `$${fmtUSD(s.value)}` : s.type === 'pct' ? `${s.value}%` : fmt(s.value))).join('\n')
}

const sortBy = (rows: Row[], key: string, dir: 1 | -1 = -1) => [...rows].sort((a, b) => (Number(a[key] ?? 0) - Number(b[key] ?? 0)) * dir)
const join = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join('\n\n')

async function report(type: ReportId, ctx: QuickCtx): Promise<ReportTable> {
  const { from, to } = periodRange(ctx.period)
  return runReport(type, from, to)
}

/* ───────── the questions ───────── */

export const QUICK: QuickQuestion[] = [
  {
    id: 'sales', perms: ['reports.view'],
    run: async (ctx) => {
      const { t } = ctx
      const r = periodRange(ctx.period)
      const [now, before] = await Promise.all([runReport('sales-by-day', r.from, r.to), runReport('sales-by-day', r.prevFrom, r.prevTo)])
      const tot = (x: ReportTable) => (x.totals ?? {}) as Record<string, number>
      const a = tot(now), b = tot(before)
      const change = b.revenue ? Math.round(((a.revenue - b.revenue) / Math.abs(b.revenue)) * 100) : null
      const debt = await getDebts(ctx.period).then((d) => d.receivable?.givenIQD ?? null).catch(() => null)
      return join(
        [
          line(t('as.a_sales'), iqd(a.revenue ?? 0, t)),
          change !== null && line(t('as.a_vs_before'), `${change >= 0 ? '+' : '−'}${Math.abs(change)}% (${iqd(b.revenue ?? 0, t)})`),
          line(t('rc.bills'), fmt(a.bills ?? 0)),
          line(t('rc.units'), fmt(a.units ?? 0)),
          debt !== null && line(t('as.a_on_debt'), iqd(debt, t)),
          (a.refunds ?? 0) > 0 && line(t('rc.refunds'), iqd(a.refunds, t)),
          a.profit !== undefined && line(t('rc.profit'), iqd(a.profit, t)),
        ].filter(Boolean).join('\n'),
      )
    },
  },
  {
    id: 'best', perms: ['reports.view'],
    run: async (ctx) => {
      const r = await report('sales-by-product', ctx)
      const top = sortBy(r.rows, 'units').filter((x) => Number(x.units) > 0).slice(0, 10)
      return top.length ? reportTable(r, ['product', 'size', 'units', 'revenue', 'profit'], top, ctx) : ctx.t('as.a_no_sales')
    },
  },
  {
    id: 'brands', perms: ['reports.view'],
    run: async (ctx) => {
      const r = await report('sales-by-brand', ctx)
      const top = sortBy(r.rows, 'revenue').slice(0, 10)
      return top.length ? reportTable(r, ['brand', 'units', 'revenue', 'share'], top, ctx) : ctx.t('as.a_no_sales')
    },
  },
  {
    id: 'sellers', perms: ['reports.view'],
    run: async (ctx) => {
      const r = await report('sales-by-seller', ctx)
      const rows = sortBy(r.rows, 'revenue')
      return rows.length ? reportTable(r, ['seller', 'channel', 'bills', 'revenue'], rows, ctx) : ctx.t('as.a_no_sales')
    },
  },
  {
    id: 'profit', perms: ['reports.financial'],
    run: async (ctx) => {
      const r = await report('profit-loss', ctx)
      return join(summary(r, ctx.t), reportTable(r, ['item', 'amount', 'share'], r.rows, ctx))
    },
  },
  {
    id: 'slow', perms: ['inventory.view'],
    run: async (ctx) => {
      const r = await report('slow-movers', ctx)
      return r.rows.length ? join(ctx.t('as.a_slow_n', { n: r.rows.length }), reportTable(r, ['product', 'size', 'stock', 'sold', 'lastSold'], r.rows.slice(0, 12), ctx)) : ctx.t('as.a_slow_none')
    },
  },
  {
    id: 'low', perms: ['inventory.view'], now: true,
    run: async (ctx) => {
      const low = (await getDashboard('today')).lowStock
      if (!low?.count) return ctx.t('ap.low_none')
      return join(ctx.t('ap.low_count', { n: low.count }), table([ctx.t('rc.product'), ctx.t('rc.size'), ctx.t('as.a_left'), ctx.t('as.a_alert')],
        low.items.map((v) => [v.name[ctx.lang] || v.name.en, v.label, fmt(v.qty), fmt(v.minStock)])))
    },
  },
  {
    id: 'debts', perms: ['customers.view'],
    run: async (ctx) => {
      const { t } = ctx
      const r = (await getDebts(ctx.period)).receivable!
      if (!r.customers) return t('ap.debts_none')
      return join(
        [line(t('debt.owed_to_us'), iqd(r.totalIQD, t)), line(t('rc.customers'), fmt(r.customers)), line(t('rc.debt_given'), iqd(r.givenIQD, t)),
          line(t('rc.debt_collected'), iqd(r.collectedIQD, t)), r.aging.age91 > 0 && line(t('rc.age91'), iqd(r.aging.age91, t))].filter(Boolean).join('\n'),
        table([t('rc.customer'), t('rc.phone'), `${t('rc.balance')} (${t('unit.iqd')})`, t('as.a_oldest')],
          r.rows.slice(0, 10).map((c) => [c.name, c.phone || '—', fmt(c.balanceIQD), c.oldestDays === null ? t('as.a_opening') : t('as.a_days', { n: c.oldestDays })])),
      )
    },
  },
  {
    id: 'suppliers', perms: ['purchasing.view'], now: true,
    run: async (ctx) => {
      const { t } = ctx
      const p = (await getDebts(ctx.period)).payable!
      if (!p.suppliers) return t('ap.sup_none')
      return join(
        [p.owedUSD > 0 && line(t('rc.usd_owed'), `$${fmtUSD(p.owedUSD)}`), p.owedIQD > 0 && line(t('as.a_iqd_owed'), iqd(p.owedIQD, t)),
          line(t('rc.debt_we_owe_now'), iqd(p.totalIQD, t))].filter(Boolean).join('\n'),
        table([t('rc.supplier'), t('rc.left'), t('rc.lastPayment')], p.rows.slice(0, 10).map((s) => [
          s.name, s.currency === 'USD' ? `$${fmtUSD(s.balance)}` : iqd(s.balance, t), s.lastPaymentAt ? new Date(s.lastPaymentAt).toISOString().slice(0, 10) : t('rx.never'),
        ])),
      )
    },
  },
  {
    id: 'expenses', perms: ['expenses.view'],
    run: async (ctx) => {
      const { t } = ctx
      const { from, to } = periodRange(ctx.period)
      const e = await listExpenses(from, to)
      if (!e.count && !e.delegateIQD) return t('exp.none')
      return join(
        [line(t('as.a_spent'), iqd(e.totalIQD + e.delegateIQD, t)), e.delegateIQD > 0 && line(t('pl.delegate_expenses'), iqd(e.delegateIQD, t)), line(t('as.a_entries'), fmt(e.count))].filter(Boolean).join('\n'),
        table([t('exp.category'), `${t('rc.amountIQD')}`], e.byCategory.map((c) => [t(`exp.cat_${c.category}`), fmt(c.amountIQD)])),
      )
    },
  },
  {
    id: 'delegates', perms: ['delegates.manage'],
    run: async (ctx) => {
      const r = await report('sales-by-seller', ctx)
      const rows = sortBy(r.rows.filter((x) => x.channel === 'delegate'), 'revenue')
      return rows.length ? reportTable(r, ['seller', 'bills', 'units', 'revenue', 'refunds'], rows, ctx) : ctx.t('as.a_no_delegate_sales')
    },
  },
  {
    id: 'wholesale', perms: ['catalogue.orders'], now: true,
    run: async (ctx) => {
      const { t } = ctx
      const orders = await getOrders({ status: 'pending_approval' })
      if (!orders.length) return t('as.a_wholesale_none')
      return join(t('as.a_wholesale_n', { n: orders.length }), table([t('as.a_order'), t('as.a_business'), t('as.a_country'), t('rc.units'), t('rc.amount')],
        orders.slice(0, 15).map((o) => [`LAT-${o.number}`, o.businessName, o.country ? (o.country.name[ctx.lang] || o.country.name.en || o.country.iso2) : '—', fmt(o.units), `$${fmtUSD(o.subtotalCents / 100)}`])))
    },
  },
  {
    id: 'stock', perms: ['reports.financial'], now: true,
    run: async (ctx) => summary(await report('stock-valuation', ctx), ctx.t),
  },
  {
    id: 'cost', perms: ['prices.edit'],
    run: async (ctx) => {
      const r = await report('missing-cost', ctx)
      return r.rows.length ? join(ctx.t('as.a_cost_n', { n: r.rows.length }), reportTable(r, ['product', 'size', 'units', 'revenue'], r.rows.slice(0, 12), ctx)) : ctx.t('as.a_cost_none')
    },
  },
]
