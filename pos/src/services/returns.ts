/**
 * Returns & exchanges.
 *
 * Refund value per unit = the line's net price (after its discount) scaled by how
 * much of the *whole bill* discount/points/rounding applied, so a customer is
 * never refunded more than they actually paid for that item.
 */
import { db, nextCounter } from '@/data/db'
import type { ReturnItem, Sale, SaleReturn } from '@/data/types'
import { uuid } from '@/lib/id'
import { hasPerm } from '@/lib/permissions'
import { AppError, assertCan, can, requireActor } from './context'
import { audit } from './audit'
import { getSettings } from './settings'
import { getOpenShiftForUser } from './shifts'
import { applyMovement } from './stock'
import { queueOutbox } from './sync'
import { isServer } from './mode'
import * as remote from './remote'
import { verifyApprovedBy } from './approval'

export interface ReturnLineInput {
  saleItemIndex: number
  qty: number
  restock: boolean
  reason: string
}

export type RefundMethod = SaleReturn['refundMethod']

/** Value of one returned unit of `sale.items[index]`. */
export function unitRefund(sale: Sale, index: number): number {
  const it = sale.items[index]
  const sumLines = sale.items.reduce((a, i) => a + i.lineTotalIQD, 0)
  if (!sumLines || !it.qty) return 0
  const payableForGoods = sale.totalIQD - sale.giftWrapIQD - sale.taxIQD
  const factor = Math.min(1, Math.max(0, payableForGoods / sumLines))
  return Math.round(((it.lineTotalIQD / it.qty) * factor) / 1) // whole dinar
}

export function returnableQty(sale: Sale, index: number): number {
  const it = sale.items[index]
  return it.qty - it.returnedQty
}

/** What has been handed back on this bill — the same sum the refund itself paid out, so the two always agree. */
export const refundedOf = (sale: Sale): number =>
  sale.items.reduce((a, it, i) => a + it.returnedQty * unitRefund(sale, i), 0)

/** What the shop actually kept: nothing for a cancelled bill, the rest less whatever went back. */
export const keptOf = (sale: Sale): number =>
  sale.status === 'voided' ? 0 : Math.max(0, sale.totalIQD - refundedOf(sale))

export async function createReturn(input: {
  saleId: string
  lines: ReturnLineInput[]
  refundMethod: RefundMethod
  note: string
  approvedBy?: { id: string; name: string } | null
}): Promise<SaleReturn> {
  const actor = assertCan('returns.create')
  const settings = await getSettings()
  const lines = input.lines.filter((l) => l.qty > 0)
  if (!lines.length) throw new AppError('nothing_to_return')
  // a sale from another till (or older than this till's copy) is fetched from the server first
  if (isServer() && !(await db.sales.get(input.saleId))) await remote.fetchSale(input.saleId)
  let out!: SaleReturn

  await db.transaction('rw', [db.sales, db.returns, db.stock, db.stockMovements, db.customers, db.counters, db.shifts, db.outbox, db.audit, db.users, db.roles], async () => {
    const sale = await db.sales.get(input.saleId)
    if (!sale) throw new AppError('not_found')
    if (sale.status === 'voided') throw new AppError('sale_voided')

    // Return window — outside it, only someone who may exceed limits can proceed.
    const ageDays = (Date.now() - sale.createdAt) / 86_400_000
    const overWindow = ageDays > settings.sales.returnWindowDays

    const items: ReturnItem[] = []
    let refund = 0
    const updated = sale.items.map((i) => ({ ...i }))
    for (const l of lines) {
      const it = updated[l.saleItemIndex]
      if (!it) throw new AppError('not_found')
      if (!Number.isInteger(l.qty) || l.qty > it.qty - it.returnedQty) throw new AppError('invalid_quantity')
      const unit = unitRefund(sale, l.saleItemIndex)
      refund += unit * l.qty
      it.returnedQty += l.qty
      items.push({ saleItemIndex: l.saleItemIndex, variantId: it.variantId, productId: it.productId, name: it.name, label: it.label, qty: l.qty, unitNetIQD: unit, restock: l.restock, reason: l.reason })
    }

    // Over the cashier's refund limit (or outside the window) → supervisor approval.
    let approver: string | null = null
    const exceeds = refund > actor.limits.maxRefundIQD || overWindow
    if (exceeds && !hasPerm(actor.permissions, 'returns.above_limit')) {
      if (!input.approvedBy) throw new AppError('approval_required', { permission: 'returns.above_limit' })
      approver = (await verifyApprovedBy(input.approvedBy.id, 'returns.above_limit')).id
    }

    // Where does the money go?
    const shift = await getOpenShiftForUser(actor.id)
    if (input.refundMethod === 'cash_iqd' && settings.sales.requireShift && !shift) throw new AppError('shift_required')
    if (input.refundMethod === 'debt_reduction') {
      if (!sale.customerId) throw new AppError('customer_required_for_debt')
      const c = await db.customers.get(sale.customerId)
      if (!c || c.balanceIQD <= 0) throw new AppError('no_debt_to_reduce')
      await db.customers.update(c.id, { balanceIQD: Math.max(0, c.balanceIQD - refund), updatedAt: Date.now() })
    }

    for (const it of items) {
      if (it.restock) await applyMovement({ variantId: it.variantId, delta: it.qty, type: 'return', refType: 'return', refId: sale.id, userId: actor.id, note: it.reason })
    }

    // Points earned on the returned share are taken back.
    if (sale.customerId && sale.pointsEarned > 0 && sale.totalIQD > 0) {
      const c = await db.customers.get(sale.customerId)
      if (c) await db.customers.update(c.id, { points: Math.max(0, c.points - Math.floor((sale.pointsEarned * refund) / sale.totalIQD)), updatedAt: Date.now() })
    }

    const allReturned = updated.every((i) => i.returnedQty >= i.qty)
    await db.sales.put({ ...sale, items: updated, status: allReturned ? 'returned' : 'partially_returned' })

    const seq = await nextCounter(`return:${settings.device.code}`)
    out = {
      id: uuid(), number: `${settings.device.code}-R${String(seq).padStart(5, '0')}`,
      saleId: sale.id, saleNumber: sale.number, shiftId: shift?.id ?? null, userId: actor.id, userName: actor.name,
      items, refundIQD: refund, refundMethod: input.refundMethod, note: input.note.trim(), approvedBy: approver, createdAt: Date.now(),
    }
    await db.returns.add(out)
    await queueOutbox('return', out.id)
    await audit('return.create', 'return', out.id, { number: out.number, sale: sale.number, refund, method: input.refundMethod, approvedBy: approver })
  })
  return out
}

export async function listReturns(limit = 300): Promise<SaleReturn[]> {
  requireActor()
  if (!can('sales.view_all') && !can('sales.view_own')) throw new AppError('forbidden', { permission: 'sales.view_own' })
  if (isServer()) { const r = await remote.listReturns(limit, () => db.returns.toArray()); if (r) return r }
  const rows = await db.returns.orderBy('createdAt').reverse().toArray()
  const a = requireActor()
  return (can('sales.view_all') ? rows : rows.filter((r) => r.userId === a.id)).slice(0, limit)
}
