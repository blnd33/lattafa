import { db } from '@/data/db'
import type { CashMovement, Sale, SaleReturn, Shift, ShiftTotals } from '@/data/types'
import { usdToIqd } from '@/lib/money'
import { uuid } from '@/lib/id'
import { AppError, assertCan, can, requireActor } from './context'
import { audit } from './audit'
import { getSettings } from './settings'
import { queueOutbox } from './sync'
import { isServer } from './mode'
import * as remote from './remote'

export async function getOpenShiftForUser(userId: string): Promise<Shift | undefined> {
  return (await db.shifts.where('userId').equals(userId).toArray()).find((s) => s.status === 'open')
}

/** The signed-in user's open shift (if any). */
export async function getMyOpenShift(): Promise<Shift | null> {
  const a = requireActor()
  return (await getOpenShiftForUser(a.id)) ?? null
}

export async function openShift(input: { openingIQD: number; openingUSD: number }): Promise<Shift> {
  const a = assertCan('shifts.open')
  if (await getOpenShiftForUser(a.id)) throw new AppError('shift_already_open')
  if (input.openingIQD < 0 || input.openingUSD < 0) throw new AppError('invalid_amount')
  const s = await getSettings()
  const shift: Shift = {
    id: uuid(), userId: a.id, userName: a.name, deviceId: s.device.id, status: 'open', openedAt: Date.now(), closedAt: null,
    openingIQD: Math.round(input.openingIQD), openingUSD: Math.round(input.openingUSD * 100) / 100,
    movements: [], countedIQD: null, countedUSD: null, varianceIQD: null, totals: null, note: '',
  }
  await db.shifts.add(shift)
  await audit('shift.open', 'shift', shift.id, { openingIQD: shift.openingIQD, openingUSD: shift.openingUSD })
  await queueOutbox('shift', shift.id)
  return shift
}

export async function addCashMovement(input: { type: 'in' | 'out'; amountIQD: number; reason: string }): Promise<Shift> {
  const a = assertCan('shifts.cash_movement')
  const shift = await getOpenShiftForUser(a.id)
  if (!shift) throw new AppError('shift_required')
  const amount = Math.round(input.amountIQD)
  if (!(amount > 0)) throw new AppError('invalid_amount')
  if (!input.reason.trim()) throw new AppError('required_fields')
  const mv: CashMovement = { id: uuid(), type: input.type, amountIQD: amount, reason: input.reason.trim(), userId: a.id, createdAt: Date.now() }
  const next = { ...shift, movements: [...shift.movements, mv] }
  await db.shifts.put(next)
  await audit('shift.cash_movement', 'shift', shift.id, { type: input.type, amount, reason: input.reason })
  await queueOutbox('shift', shift.id)
  return next
}

/** Everything that happened in a shift, and what should be in the drawer. */
export async function computeShiftTotals(shift: Shift): Promise<ShiftTotals> {
  const [sales, returns, collections] = await Promise.all([
    db.sales.where('shiftId').equals(shift.id).toArray(),
    db.returns.where('shiftId').equals(shift.id).toArray(),
    db.collections.where('shiftId').equals(shift.id).toArray(),
  ])
  return totalsFrom(shift, sales, returns, collections.map((c) => ({ method: c.method, amountIQD: c.amountIQD })))
}

export function totalsFrom(shift: Shift, salesAll: Sale[], returns: SaleReturn[], collections: { method: string; amountIQD: number }[]): ShiftTotals {
  const sales = salesAll.filter((s) => s.status !== 'voided')
  const byMethod: Record<string, number> = {}
  let cashTenderedIQD = 0
  let changeIQD = 0
  let cashUSD = 0
  for (const s of sales) {
    changeIQD += s.changeIQD
    for (const p of s.payments) {
      byMethod[p.method] = (byMethod[p.method] ?? 0) + p.amountIQD
      if (p.method === 'cash_iqd') cashTenderedIQD += p.tendered
      if (p.method === 'cash_usd') cashUSD += p.tendered
    }
  }
  const collectedCash = collections.filter((c) => c.method === 'cash_iqd').reduce((a, c) => a + c.amountIQD, 0)
  const collectionsIQD = collections.reduce((a, c) => a + c.amountIQD, 0)
  for (const c of collections) byMethod[`collection_${c.method}`] = (byMethod[`collection_${c.method}`] ?? 0) + c.amountIQD
  const refundsIQD = returns.reduce((a, r) => a + (r.refundMethod === 'store_credit' || r.refundMethod === 'debt_reduction' ? 0 : r.refundIQD), 0)
  const refundsCash = returns.filter((r) => r.refundMethod === 'cash_iqd').reduce((a, r) => a + r.refundIQD, 0)
  const cashIn = shift.movements.filter((m) => m.type === 'in').reduce((a, m) => a + m.amountIQD, 0)
  const cashOut = shift.movements.filter((m) => m.type === 'out').reduce((a, m) => a + m.amountIQD, 0)
  const cashIQD = cashTenderedIQD - changeIQD
  return {
    salesCount: sales.length,
    salesIQD: sales.reduce((a, s) => a + s.totalIQD, 0),
    byMethod,
    cashIQD,
    cashUSD,
    refundsIQD,
    collectionsIQD,
    cashInIQD: cashIn,
    cashOutIQD: cashOut,
    expectedIQD: shift.openingIQD + cashIQD + collectedCash + cashIn - cashOut - refundsCash,
    expectedUSD: Math.round((shift.openingUSD + cashUSD) * 100) / 100,
  }
}

export async function closeShift(input: { countedIQD: number; countedUSD: number; note: string }): Promise<Shift> {
  const a = assertCan('shifts.close')
  const shift = await getOpenShiftForUser(a.id)
  if (!shift) throw new AppError('shift_required')
  if (input.countedIQD < 0 || input.countedUSD < 0) throw new AppError('invalid_amount')
  const s = await getSettings()
  const totals = await computeShiftTotals(shift)
  const variance = Math.round(input.countedIQD) - totals.expectedIQD + usdToIqd(input.countedUSD - totals.expectedUSD, s.currency.rate)
  const closed: Shift = {
    ...shift, status: 'closed', closedAt: Date.now(),
    countedIQD: Math.round(input.countedIQD), countedUSD: Math.round(input.countedUSD * 100) / 100,
    varianceIQD: variance, totals, note: input.note.trim(),
  }
  await db.shifts.put(closed)
  await audit('shift.close', 'shift', shift.id, { expectedIQD: totals.expectedIQD, countedIQD: closed.countedIQD, variance })
  await queueOutbox('shift', shift.id)
  return closed
}

export async function getShift(id: string): Promise<Shift | undefined> {
  const a = requireActor()
  const sh = (await db.shifts.get(id)) ?? (isServer() ? await remote.getShift(id) : undefined)
  if (sh && sh.userId !== a.id && !can('shifts.view_all')) throw new AppError('forbidden', { permission: 'shifts.view_all' })
  return sh
}

export async function listShifts(): Promise<Shift[]> {
  const a = requireActor()
  if (isServer()) {
    const r = await remote.listShifts(async () => (await db.shifts.toArray()).filter((s) => can('shifts.view_all') || s.userId === a.id))
    if (r) return r
  }
  const all = (await db.shifts.orderBy('openedAt').reverse().toArray())
  return can('shifts.view_all') ? all : all.filter((s) => s.userId === a.id)
}
