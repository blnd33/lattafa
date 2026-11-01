/**
 * Sales — checkout, void, history.
 *
 * `completeSale` is one atomic IndexedDB transaction: stock, customer balance,
 * loyalty points, the sale record and its sync-queue entry all commit together
 * or not at all (brief §10). Totals are recomputed here with PricingService, so
 * the numbers stored are never taken on trust from the screen.
 */
import { db, nextCounter } from '@/data/db'
import type { Payment, PaymentMethod, Sale, SaleItem, SaleStatus } from '@/data/types'
import { uuid } from '@/lib/id'
import { hasPerm } from '@/lib/permissions'
import { pointsEarned, priceCart, type OrderDiscount } from '@/lib/pricing'
import { usdToIqd } from '@/lib/money'
import { AppError, assertCan, can, requireActor } from './context'
import { audit } from './audit'
import { getSettings } from './settings'
import { getOpenShiftForUser } from './shifts'
import { applyMovement } from './stock'
import { isOfflineError } from './api'
import { isPending, queueOutbox } from './sync'
import { isServer } from './mode'
import * as remote from './remote'
import { verifyApprovedBy } from './approval'

export interface CheckoutLine {
  variantId: string
  qty: number
  discountPct: number
}

export interface CheckoutPayment {
  method: PaymentMethod
  /** amount handed over, in `currency` (USD dollars for cash_usd, else IQD) */
  tendered: number
  reference?: string
}

export interface CheckoutInput {
  lines: CheckoutLine[]
  customerId: string | null
  orderDiscount: OrderDiscount | null
  giftWrap: boolean
  redeemPoints: number
  payments: CheckoutPayment[]
  note: string
  /** supervisor who OK'd an over-limit discount (PIN approval) */
  approvedBy?: { id: string; name: string } | null
  /** value of a return being exchanged (paid with method 'return_credit') */
  returnCreditIQD?: number
}

const CASH: PaymentMethod[] = ['cash_iqd', 'cash_usd']

export async function completeSale(input: CheckoutInput): Promise<Sale> {
  const actor = assertCan('pos.sell')
  if (!input.lines.length) throw new AppError('cart_empty')
  const settings = await getSettings()

  const shift = await getOpenShiftForUser(actor.id)
  if (settings.sales.requireShift && !shift) throw new AppError('shift_required')

  let sale!: Sale
  await db.transaction(
    'rw',
    [db.sales, db.variants, db.products, db.stock, db.stockMovements, db.customers, db.counters, db.outbox, db.audit, db.users, db.roles],
    async () => {
      /* ---- 1. resolve lines ---- */
      const items: SaleItem[] = []
      const pricingLines = []
      const wantsLineDiscount = input.lines.some((l) => l.discountPct > 0)
      for (let i = 0; i < input.lines.length; i++) {
        const l = input.lines[i]
        if (!Number.isInteger(l.qty) || l.qty <= 0) throw new AppError('invalid_quantity')
        if (l.discountPct < 0 || l.discountPct > 100) throw new AppError('invalid_discount')
        const v = await db.variants.get(l.variantId)
        const p = v ? await db.products.get(v.productId) : undefined
        if (!v || !p || !v.active || !p.active) throw new AppError('product_unavailable')
        pricingLines.push({ key: String(i), unitPriceIQD: v.retailIQD, qty: l.qty, discountPct: l.discountPct })
        items.push({
          variantId: v.id, productId: p.id, name: p.name, brand: p.brand, label: v.label, sku: v.sku, barcode: v.barcode,
          qty: l.qty, unitPriceIQD: v.retailIQD, unitCostIQD: v.costIQD, discountPct: l.discountPct, discountIQD: 0, lineTotalIQD: 0, returnedQty: 0,
        })
      }

      /* ---- 2. discount permissions ---- */
      if (wantsLineDiscount && !can('sales.discount.item')) throw new AppError('forbidden', { permission: 'sales.discount.item' })
      if (input.orderDiscount && input.orderDiscount.value > 0 && !can('sales.discount.order')) throw new AppError('forbidden', { permission: 'sales.discount.order' })

      /* ---- 3. customer, points ---- */
      const customer = input.customerId ? await db.customers.get(input.customerId) : undefined
      if (input.customerId && !customer) throw new AppError('not_found')
      let redeemPoints = Math.max(0, Math.floor(input.redeemPoints || 0))
      if (redeemPoints > 0) {
        if (!settings.loyalty.enabled || !customer) throw new AppError('loyalty_unavailable')
        if (redeemPoints > customer.points) throw new AppError('not_enough_points', { points: customer.points })
      }
      const pointsIQD = redeemPoints * settings.loyalty.pointValueIQD

      /* ---- 4. price it (authoritative) ---- */
      const priced = priceCart({
        lines: pricingLines,
        orderDiscount: input.orderDiscount,
        pointsRedeemedIQD: pointsIQD,
        giftWrapIQD: input.giftWrap ? settings.sales.giftWrapFeeIQD : 0,
        taxPct: settings.tax.pct,
        rounding: settings.currency.rounding,
      })
      if (priced.pointsRedeemed < pointsIQD) redeemPoints = Math.ceil(priced.pointsRedeemed / settings.loyalty.pointValueIQD)
      priced.lines.forEach((pl, i) => { items[i].discountIQD = pl.discount; items[i].lineTotalIQD = pl.net })

      /* ---- 5. over-limit discount needs a supervisor ---- */
      let approvedBy: string | null = null
      if (priced.effectiveDiscountPct > actor.limits.maxDiscountPct + 1e-9 && !hasPerm(actor.permissions, 'sales.discount.above_limit')) {
        if (!input.approvedBy) throw new AppError('approval_required', { permission: 'sales.discount.above_limit' })
        approvedBy = (await verifyApprovedBy(input.approvedBy.id, 'sales.discount.above_limit')).id
      }

      /* ---- 6. payments ---- */
      const total = priced.total
      let remaining = total
      const payments: Payment[] = []
      const rate = settings.currency.rate
      const order: PaymentMethod[] = ['return_credit', 'card', 'fib', 'zain', 'debt', 'cash_iqd', 'cash_usd']
      const given = [...input.payments].filter((p) => p.tendered > 0).sort((a, b) => order.indexOf(a.method) - order.indexOf(b.method))
      let debt = 0
      let cashValue = 0
      let cashApplied = 0
      for (const p of given) {
        if (p.method === 'cash_usd' && !settings.currency.usdEnabled) throw new AppError('usd_disabled')
        const currency = p.method === 'cash_usd' ? 'USD' : 'IQD'
        const value = p.method === 'cash_usd' ? usdToIqd(p.tendered, rate) : Math.round(p.tendered)
        if (p.method === 'return_credit') {
          if (value > (input.returnCreditIQD ?? 0)) throw new AppError('invalid_amount')
        }
        if (CASH.includes(p.method)) {
          const applied = Math.min(value, Math.max(0, remaining))
          cashValue += value
          cashApplied += applied
          remaining -= applied
          payments.push({ method: p.method, amountIQD: applied, tendered: p.tendered, currency, rate, reference: p.reference ?? '' })
        } else {
          if (value > remaining) throw new AppError('overpayment_non_cash')
          remaining -= value
          if (p.method === 'debt') debt += value
          payments.push({ method: p.method, amountIQD: value, tendered: p.tendered, currency, rate, reference: p.reference ?? '' })
        }
      }
      if (remaining > 0) throw new AppError('underpayment', { remaining })
      const change = cashValue - cashApplied
      if (change > 0 && cashApplied === 0) throw new AppError('overpayment_non_cash')

      if (debt > 0) {
        if (!customer) throw new AppError('customer_required_for_debt')
        if (!can('customers.credit')) throw new AppError('forbidden', { permission: 'customers.credit' })
        if (customer.balanceIQD + debt > customer.creditLimitIQD) {
          throw new AppError('credit_limit_exceeded', { limit: customer.creditLimitIQD, balance: customer.balanceIQD })
        }
      }

      /* ---- 7. stock (via StockService) ---- */
      const id = uuid()
      // Aggregate by variant so two lines of the same bottle are checked together.
      for (const it of items) {
        await applyMovement({ variantId: it.variantId, delta: -it.qty, type: 'sale', refType: 'sale', refId: id, userId: actor.id, allowNegative: settings.sales.allowNegativeStock })
      }

      /* ---- 8. customer balance + points ---- */
      const earned = customer && settings.loyalty.enabled ? pointsEarned(total, settings.loyalty.pointsPer1000IQD) : 0
      if (customer) {
        await db.customers.update(customer.id, {
          balanceIQD: customer.balanceIQD + debt,
          points: customer.points - redeemPoints + earned,
          updatedAt: Date.now(),
        })
      }

      /* ---- 9. the sale ---- */
      const seq = await nextCounter(`sale:${settings.device.code}`)
      const paidIQD = payments.filter((p) => p.method !== 'debt').reduce((a, p) => a + p.amountIQD, 0)
      sale = {
        id, number: `${settings.device.code}-${String(seq).padStart(6, '0')}`,
        shiftId: shift?.id ?? null, userId: actor.id, userName: actor.name,
        customerId: customer?.id ?? null, customerName: customer?.name ?? '',
        channel: 'store', status: 'completed', items,
        subtotalIQD: priced.subtotal, itemDiscountIQD: priced.itemDiscount, orderDiscountIQD: priced.orderDiscount,
        orderDiscount: input.orderDiscount && input.orderDiscount.value > 0 ? input.orderDiscount : null,
        giftWrapIQD: priced.giftWrap, taxIQD: priced.tax, roundingIQD: priced.rounding, pointsRedeemedIQD: priced.pointsRedeemed,
        totalIQD: total, payments, paidIQD, changeIQD: change, dueIQD: debt,
        pointsEarned: earned, pointsRedeemed: redeemPoints, exchangeRate: rate,
        note: input.note.trim(), approvedBy, deviceId: settings.device.id, createdAt: Date.now(), voidedAt: null, voidReason: '',
      }
      await db.sales.add(sale)
      await queueOutbox('sale', sale.id)
      await audit('sale.create', 'sale', sale.id, { number: sale.number, total, items: items.length, approvedBy })
    },
  )
  return sale
}

/** Cancel a sale entirely: stock comes back, debt/points are reversed. */
export async function voidSale(saleId: string, reason: string, approvedBy?: { id: string; name: string } | null): Promise<Sale> {
  const actor = requireActor()
  let approver: string | null = null
  if (!can('sales.void')) {
    if (!approvedBy) throw new AppError('approval_required', { permission: 'sales.void' })
    approver = (await verifyApprovedBy(approvedBy.id, 'sales.void')).id
  }
  if (!reason.trim()) throw new AppError('required_fields')
  if (isServer()) {
    const local = await db.sales.get(saleId)
    // already on the server (or another till's sale): the server voids it and re-checks the approval itself
    if (!local || !(await isPending('sale', saleId))) {
      try { return await remote.voidSale(saleId, reason.trim(), approver) } catch (e) { if (!local || !isOfflineError(e)) throw e }
      // offline: void here; the next sync sends the voided sale and the server applies it
    }
  }
  let out!: Sale
  await db.transaction('rw', [db.sales, db.stock, db.stockMovements, db.customers, db.shifts, db.outbox, db.audit, db.users, db.roles], async () => {
    const sale = await db.sales.get(saleId)
    if (!sale) throw new AppError('not_found')
    if (sale.status !== 'completed') throw new AppError('sale_not_voidable')
    const shift = sale.shiftId ? await db.shifts.get(sale.shiftId) : undefined
    if (shift?.status === 'closed' && !can('sales.view_all')) throw new AppError('shift_closed')
    for (const it of sale.items) {
      await applyMovement({ variantId: it.variantId, delta: it.qty, type: 'void', refType: 'sale', refId: sale.id, userId: actor.id, note: reason })
    }
    if (sale.customerId) {
      const c = await db.customers.get(sale.customerId)
      if (c) await db.customers.update(c.id, { balanceIQD: Math.max(0, c.balanceIQD - sale.dueIQD), points: Math.max(0, c.points + sale.pointsRedeemed - sale.pointsEarned), updatedAt: Date.now() })
    }
    out = { ...sale, status: 'voided', voidedAt: Date.now(), voidReason: reason.trim() }
    await db.sales.put(out)
    await queueOutbox('sale', sale.id)
    await audit('sale.void', 'sale', sale.id, { number: sale.number, reason, approvedBy: approver })
  })
  return out
}

export interface SaleFilter {
  from?: number
  to?: number
  userId?: string
  status?: SaleStatus
  q?: string
  limit?: number
}

export async function listSales(f: SaleFilter = {}): Promise<Sale[]> {
  const a = requireActor()
  const all = can('sales.view_all')
  if (!all && !can('sales.view_own')) throw new AppError('forbidden', { permission: 'sales.view_own' })
  if (isServer()) {
    // every till's sales from the server (it applies the same own/all rule) + this till's not-yet-synced ones
    const r = await remote.listSales(f, () => localSales(f, a.id, all))
    if (r) return r
  }
  return localSales(f, a.id, all)
}

async function localSales(f: SaleFilter, actorId: string, all: boolean): Promise<Sale[]> {
  let rows = await db.sales.orderBy('createdAt').reverse().toArray()
  if (!all) rows = rows.filter((s) => s.userId === actorId)
  else if (f.userId) rows = rows.filter((s) => s.userId === f.userId)
  if (f.from) rows = rows.filter((s) => s.createdAt >= f.from!)
  if (f.to) rows = rows.filter((s) => s.createdAt <= f.to!)
  if (f.status) rows = rows.filter((s) => s.status === f.status)
  if (f.q?.trim()) {
    const q = f.q.trim().toLowerCase()
    rows = rows.filter((s) => s.number.toLowerCase().includes(q) || s.customerName.toLowerCase().includes(q) || s.items.some((i) => i.barcode === q || i.sku.toLowerCase() === q))
  }
  return rows.slice(0, f.limit ?? 500)
}

export async function getSale(id: string): Promise<Sale | undefined> {
  const a = requireActor()
  const s = (await db.sales.get(id)) ?? (isServer() ? await remote.fetchSale(id) : undefined)
  if (s && s.userId !== a.id && !can('sales.view_all')) throw new AppError('forbidden', { permission: 'sales.view_all' })
  return s
}

export async function findSaleByNumber(number: string): Promise<Sale | undefined> {
  const a = requireActor()
  const s = (await db.sales.where('number').equals(number.trim().toUpperCase()).first()) ?? (isServer() ? await remote.fetchSale(number) : undefined)
  if (s && s.userId !== a.id && !can('sales.view_all')) throw new AppError('forbidden', { permission: 'sales.view_all' })
  return s
}

