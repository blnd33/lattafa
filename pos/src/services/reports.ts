import { db } from '@/data/db'
import type { Customer, PaymentMethod, Sale } from '@/data/types'
import { assertCan, can } from './context'
import { stockMap } from './stock'
import { isServer } from './mode'
import * as remote from './remote'

export interface SalesReport {
  from: number
  to: number
  count: number
  revenueIQD: number
  discountIQD: number
  refundsIQD: number
  netIQD: number
  avgBasketIQD: number
  unitsSold: number
  /** only when the actor holds reports.financial */
  costIQD: number | null
  profitIQD: number | null
  byDay: { day: string; count: number; revenueIQD: number }[]
  byHour: { hour: number; count: number; revenueIQD: number }[]
  byCashier: { userId: string; name: string; count: number; revenueIQD: number }[]
  byMethod: { method: PaymentMethod; amountIQD: number }[]
  topProducts: { productId: string; name: string; units: number; revenueIQD: number }[]
  byBrand: { brand: string; units: number; revenueIQD: number }[]
}

const dayKey = (t: number) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const startOfDay = (t = Date.now()) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime() }
export const endOfDay = (t = Date.now()) => { const d = new Date(t); d.setHours(23, 59, 59, 999); return d.getTime() }

export async function salesReport(from: number, to: number, opts: { userId?: string } = {}): Promise<SalesReport> {
  assertCan('reports.view')
  if (isServer()) { const r = await remote.salesReport(from, to, opts.userId); if (r) return r } // every till, from the server
  const financial = can('reports.financial')
  let sales: Sale[] = (await db.sales.where('createdAt').between(from, to, true, true).toArray()).filter((s) => s.status !== 'voided')
  if (opts.userId) sales = sales.filter((s) => s.userId === opts.userId)
  const ids = new Set(sales.map((s) => s.id))
  const returns = (await db.returns.where('createdAt').between(from, to, true, true).toArray()).filter((r) => ids.has(r.saleId))

  const days = new Map<string, { count: number; revenueIQD: number }>()
  const hours = new Map<number, { count: number; revenueIQD: number }>()
  const cashiers = new Map<string, { name: string; count: number; revenueIQD: number }>()
  const methods = new Map<PaymentMethod, number>()
  const products = new Map<string, { name: string; units: number; revenueIQD: number }>()
  const brands = new Map<string, { units: number; revenueIQD: number }>()
  let revenue = 0, discount = 0, units = 0, cost = 0

  for (const s of sales) {
    revenue += s.totalIQD
    discount += s.itemDiscountIQD + s.orderDiscountIQD + s.pointsRedeemedIQD
    const dk = dayKey(s.createdAt)
    const d = days.get(dk) ?? { count: 0, revenueIQD: 0 }; d.count++; d.revenueIQD += s.totalIQD; days.set(dk, d)
    const hr = new Date(s.createdAt).getHours()
    const h = hours.get(hr) ?? { count: 0, revenueIQD: 0 }; h.count++; h.revenueIQD += s.totalIQD; hours.set(hr, h)
    const c = cashiers.get(s.userId) ?? { name: s.userName, count: 0, revenueIQD: 0 }; c.count++; c.revenueIQD += s.totalIQD; cashiers.set(s.userId, c)
    for (const p of s.payments) methods.set(p.method, (methods.get(p.method) ?? 0) + p.amountIQD)
    for (const it of s.items) {
      units += it.qty
      cost += it.unitCostIQD * it.qty
      const pr = products.get(it.productId) ?? { name: it.name.en || it.name.ar || it.name.ku, units: 0, revenueIQD: 0 }
      pr.units += it.qty; pr.revenueIQD += it.lineTotalIQD; products.set(it.productId, pr)
      const b = brands.get(it.brand) ?? { units: 0, revenueIQD: 0 }; b.units += it.qty; b.revenueIQD += it.lineTotalIQD; brands.set(it.brand, b)
    }
  }
  const refunds = returns.reduce((a, r) => a + (r.refundMethod === 'store_credit' ? 0 : r.refundIQD), 0)
  const returnedCost = returns.reduce((a, r) => a + r.items.reduce((x, i) => x + (sales.find((s) => s.id === r.saleId)?.items[i.saleItemIndex]?.unitCostIQD ?? 0) * i.qty, 0), 0)
  const net = revenue - refunds

  return {
    from, to, count: sales.length, revenueIQD: revenue, discountIQD: discount, refundsIQD: refunds, netIQD: net,
    avgBasketIQD: sales.length ? Math.round(revenue / sales.length) : 0, unitsSold: units,
    costIQD: financial ? cost - returnedCost : null,
    profitIQD: financial ? net - (cost - returnedCost) : null,
    byDay: [...days].map(([day, v]) => ({ day, ...v })).sort((a, b) => a.day.localeCompare(b.day)),
    byHour: [...hours].map(([hour, v]) => ({ hour, ...v })).sort((a, b) => a.hour - b.hour),
    byCashier: [...cashiers].map(([userId, v]) => ({ userId, ...v })).sort((a, b) => b.revenueIQD - a.revenueIQD),
    byMethod: [...methods].map(([method, amountIQD]) => ({ method, amountIQD })).sort((a, b) => b.amountIQD - a.amountIQD),
    topProducts: [...products].map(([productId, v]) => ({ productId, ...v })).sort((a, b) => b.revenueIQD - a.revenueIQD).slice(0, 10),
    byBrand: [...brands].map(([brand, v]) => ({ brand, ...v })).sort((a, b) => b.revenueIQD - a.revenueIQD),
  }
}

export interface LowStockRow { variantId: string; productName: string; label: string; sku: string; qty: number; minStock: number }

export async function lowStock(): Promise<LowStockRow[]> {
  assertCan('inventory.view')
  const [variants, products, stock] = await Promise.all([db.variants.toArray(), db.products.toArray(), stockMap()])
  const pmap = new Map(products.map((p) => [p.id, p]))
  return variants
    .filter((v) => v.active && (stock[v.id] ?? 0) <= v.minStock)
    .map((v) => ({ variantId: v.id, productName: pmap.get(v.productId)?.name.en ?? v.sku, label: v.label, sku: v.sku, qty: stock[v.id] ?? 0, minStock: v.minStock }))
    .sort((a, b) => a.qty - b.qty)
}

export async function stockValuation(): Promise<{ costIQD: number; retailIQD: number; units: number }> {
  assertCan('reports.financial')
  const [variants, stock] = await Promise.all([db.variants.toArray(), stockMap()])
  let costIQD = 0, retailIQD = 0, units = 0
  for (const v of variants) { const q = Math.max(0, stock[v.id] ?? 0); costIQD += q * v.costIQD; retailIQD += q * v.retailIQD; units += q }
  return { costIQD, retailIQD, units }
}

export async function debtors(): Promise<Customer[]> {
  assertCan('customers.view')
  return (await db.customers.toArray()).filter((c) => c.active && c.balanceIQD > 0).sort((a, b) => b.balanceIQD - a.balanceIQD)
}
