import { db } from '@/data/db'
import type { Collection, Customer, CustomerType, PaymentMethod, Sale } from '@/data/types'
import { uuid } from '@/lib/id'
import { AppError, assertCan, requireActor } from './context'
import { audit } from './audit'
import { queueOutbox } from './sync'
import { getOpenShiftForUser } from './shifts'
import { isServer } from './mode'
import * as remote from './remote'

export async function listCustomers(): Promise<Customer[]> {
  assertCan('customers.view')
  return (await db.customers.toArray()).filter((c) => c.active).sort((a, b) => a.name.localeCompare(b.name))
}

export async function getCustomer(id: string): Promise<Customer | undefined> {
  assertCan('customers.view')
  return db.customers.get(id)
}

export interface CustomerInput {
  id?: string
  name: string
  phone: string
  type: CustomerType
  city: string
  notes: string
  creditLimitIQD: number
}

const normPhone = (p: string) => p.replace(/[^\d+]/g, '')

export async function saveCustomer(input: CustomerInput): Promise<Customer> {
  assertCan(input.id ? 'customers.edit' : 'customers.create')
  const name = input.name.trim()
  if (!name) throw new AppError('required_fields')
  const phone = normPhone(input.phone)
  if (phone) {
    const dup = (await db.customers.where('phone').equals(input.phone.trim()).toArray()).find((c) => c.id !== input.id && c.active)
    if (dup) throw new AppError('phone_taken', { name: dup.name })
  }
  if (isServer()) {
    const saved = await remote.saveCustomer(input, uuid())
    if (saved) return saved
    // offline: recorded on this till and sent with the next sync
  }
  const now = Date.now()
  if (input.id) {
    const cur = await db.customers.get(input.id)
    if (!cur) throw new AppError('not_found')
    // Only people who may grant credit can change a credit limit.
    let limit = cur.creditLimitIQD
    if (input.creditLimitIQD !== cur.creditLimitIQD) { assertCan('customers.credit'); limit = Math.max(0, Math.round(input.creditLimitIQD)) }
    const next: Customer = { ...cur, name, phone: input.phone.trim(), type: input.type, city: input.city.trim(), notes: input.notes.trim(), creditLimitIQD: limit, updatedAt: now }
    await db.customers.put(next)
    await audit('customer.update', 'customer', cur.id, { name })
    await queueOutbox('customer', cur.id)
    return next
  }
  const settings = await db.settings.get('app')
  const c: Customer = {
    id: uuid(), name, phone: input.phone.trim(), type: input.type, city: input.city.trim(), notes: input.notes.trim(),
    balanceIQD: 0, creditLimitIQD: Math.max(0, Math.round(input.creditLimitIQD || settings?.sales.defaultCustomerCreditIQD || 0)),
    points: 0, active: true, createdAt: now, updatedAt: now,
  }
  await db.customers.add(c)
  await audit('customer.create', 'customer', c.id, { name })
  await queueOutbox('customer', c.id)
  return c
}

export async function deleteCustomer(id: string): Promise<void> {
  assertCan('customers.delete')
  if (isServer()) return remote.deleteCustomer(id)
  const c = await db.customers.get(id)
  if (!c) throw new AppError('not_found')
  if (c.balanceIQD > 0) throw new AppError('customer_has_debt')
  await db.customers.update(id, { active: false, updatedAt: Date.now() })
  await audit('customer.delete', 'customer', id, { name: c.name })
}

/** Money received against a customer's outstanding balance. */
export async function collectPayment(input: { customerId: string; amountIQD: number; method: PaymentMethod; note: string }): Promise<Collection> {
  const actor = assertCan('customers.collect')
  const amount = Math.round(input.amountIQD)
  if (!(amount > 0)) throw new AppError('invalid_amount')
  let result!: Collection
  await db.transaction('rw', [db.customers, db.collections, db.shifts, db.outbox, db.audit], async () => {
    const c = await db.customers.get(input.customerId)
    if (!c) throw new AppError('not_found')
    if (amount > c.balanceIQD) throw new AppError('overpayment', { balance: c.balanceIQD })
    const shift = await getOpenShiftForUser(actor.id)
    result = { id: uuid(), customerId: c.id, amountIQD: amount, method: input.method, shiftId: shift?.id ?? null, userId: actor.id, note: input.note, createdAt: Date.now() }
    await db.collections.add(result)
    await db.customers.update(c.id, { balanceIQD: c.balanceIQD - amount, updatedAt: Date.now() })
    await audit('customer.collect', 'customer', c.id, { amount, method: input.method })
    await queueOutbox('collection', result.id)
  })
  return result
}

export interface StatementRow {
  id: string
  at: number
  kind: 'sale' | 'payment' | 'return'
  ref: string
  amountIQD: number // + increases what they owe, − reduces it
  note: string
}

export async function customerStatement(customerId: string): Promise<{ rows: StatementRow[]; sales: Sale[] }> {
  assertCan('customers.view')
  if (isServer()) { const r = await remote.customerStatement(customerId); if (r) return r }
  const [sales, collections, returns] = await Promise.all([
    db.sales.where('customerId').equals(customerId).toArray(),
    db.collections.where('customerId').equals(customerId).toArray(),
    db.returns.toArray(),
  ])
  const saleIds = new Set(sales.map((s) => s.id))
  const rows: StatementRow[] = [
    ...sales.filter((s) => s.status !== 'voided').map((s) => ({ id: s.id, at: s.createdAt, kind: 'sale' as const, ref: s.number, amountIQD: s.dueIQD, note: '' })),
    ...collections.map((c) => ({ id: c.id, at: c.createdAt, kind: 'payment' as const, ref: '', amountIQD: -c.amountIQD, note: c.note })),
    ...returns.filter((r) => saleIds.has(r.saleId) && r.refundMethod === 'debt_reduction').map((r) => ({ id: r.id, at: r.createdAt, kind: 'return' as const, ref: r.number, amountIQD: -r.refundIQD, note: '' })),
  ].sort((a, b) => b.at - a.at)
  return { rows, sales: sales.sort((a, b) => b.createdAt - a.createdAt) }
}

export function currentUserId(): string {
  return requireActor().id
}
