import { beforeEach, describe, expect, it } from 'vitest'
import { backfillSizes, db } from '@/data/db'
import { completeSetup, loginWithPassword, loginWithPin, listLoginUsers, verifyApproval, ensureSystemRoles } from './auth'
import { setActor, isAppError, getActor } from './context'
import { saveUser, saveRole, deleteUser, listUsers, resetCredentials } from './users'
import { listCatalog, saveProduct } from './catalog'
import { exportCatalogCsv, importCatalog, previewImport } from './csv'
import { completeSale, voidSale, listSales } from './sales'
import { createReturn, unitRefund } from './returns'
import { openShift, closeShift, computeShiftTotals } from './shifts'
import { stockMap, adjustStock, applyStockCount, markTester } from './stock'
import { collectPayment } from './customers'
import { salesReport, startOfDay, endOfDay } from './reports'
import { updateSettings } from './settings'
import { DEFAULT_LIMITS } from '@/lib/permissions'
import type { Actor } from '@/data/types'

async function expectCode(p: Promise<unknown>, code: string) {
  try {
    await p
  } catch (e) {
    expect(isAppError(e) ? e.code : String(e)).toBe(code)
    return
  }
  throw new Error(`expected AppError(${code}) but nothing was thrown`)
}

const login = async (username: string, password: string): Promise<Actor> => {
  const a = await loginWithPassword(username, password)
  setActor(a)
  return a
}

async function freshShop() {
  await db.delete()
  await db.open()
  setActor(null)
  await completeSetup({
    store: { name: 'Lattafa Test', phone: '', address: '', city: 'Duhok' },
    rate: 1460,
    admin: { name: 'Owner', username: 'owner', password: 'Owner1234', pin: '1111' },
    demoData: true,
    deviceName: 'Counter 1',
  })
  return login('owner', 'Owner1234')
}

async function makeCashier(name = 'Cashier', pin = '2222') {
  const roles = await db.roles.toArray()
  const role = roles.find((r) => r.key === 'cashier')!
  const u = await saveUser({ name, username: name.toLowerCase(), roleId: role.id, active: true, pin, password: 'Cashier123', grants: [], denies: [], limits: DEFAULT_LIMITS })
  return u
}

beforeEach(async () => { await freshShop() })

describe('setup + login', () => {
  it('creates a super admin, roles, settings and demo data — with no default account before that', async () => {
    const roles = await db.roles.toArray()
    expect(roles.map((r) => r.key).sort()).toEqual(['cashier', 'delegate', 'manager', 'stock_keeper', 'super_admin'])
    expect(getActor()?.isSuperAdmin).toBe(true)
    expect((await listCatalog()).length).toBeGreaterThan(10)
  })
  it('refuses to run setup twice', async () => {
    await expectCode(completeSetup({ store: { name: 'x', phone: '', address: '', city: '' }, rate: 1400, admin: { name: 'A', username: 'a1', password: 'Abcdef12', pin: '1234' }, demoData: false, deviceName: '' }), 'setup_already_done')
  })
  it('rejects weak passwords and bad PINs at setup', async () => {
    await db.delete(); await db.open()
    const base = { store: { name: 'x', phone: '', address: '', city: '' }, rate: 1400, demoData: false, deviceName: '' }
    await expectCode(completeSetup({ ...base, admin: { name: 'A', username: 'a1', password: 'abc', pin: '1234' } }), 'password_short')
    await expectCode(completeSetup({ ...base, admin: { name: 'A', username: 'a1', password: 'a'.repeat(73), pin: '1234' } }), 'password_long')
    await expectCode(completeSetup({ ...base, admin: { name: 'A', username: 'a1', password: 'ک'.repeat(37), pin: '1234' } }), 'password_long') // 74 bytes
    await expectCode(completeSetup({ ...base, admin: { name: 'A', username: 'a1', password: 'Abcdef12', pin: '12' } }), 'pin_invalid')
  })
  it('PIN login works, wrong PIN counts down then locks', async () => {
    const c = await makeCashier()
    const ok = await loginWithPin(c.id, '2222')
    expect(ok.roleKey).toBe('cashier')
    for (let i = 0; i < 4; i++) await expectCode(loginWithPin(c.id, '9999'), 'invalid_credentials')
    await expectCode(loginWithPin(c.id, '9999'), 'account_locked')
    await expectCode(loginWithPin(c.id, '2222'), 'account_locked') // even the right PIN is refused while locked
  })
  it('lists sign-in tiles only for users who may use the POS', async () => {
    await makeCashier('Ali', '3333')
    const roles = await db.roles.toArray()
    await saveUser({ name: 'Rep', username: 'rep1', roleId: roles.find((r) => r.key === 'delegate')!.id, active: true, pin: '4444', grants: [], denies: [], limits: DEFAULT_LIMITS })
    const tiles = (await listLoginUsers()).map((u) => u.name)
    expect(tiles).toContain('Ali')
    expect(tiles).not.toContain('Rep')
    await expectCode(loginWithPin((await db.users.where('username').equals('rep1').first())!.id, '4444'), 'app_not_allowed')
  })
})

describe('super admin manages accounts and permissions', () => {
  it('a cashier cannot create users or roles', async () => {
    await makeCashier()
    const c = await loginWithPin((await db.users.where('username').equals('cashier').first())!.id, '2222')
    setActor(c)
    const roles = await db.roles.toArray()
    await expectCode(saveUser({ name: 'X', username: 'xxx', roleId: roles[0].id, active: true, pin: '5555', grants: [], denies: [], limits: DEFAULT_LIMITS }), 'forbidden')
    await expectCode(saveRole({ name: 'Evil', description: '', permissions: ['*'], apps: ['pos'] }), 'forbidden')
    await expectCode(listUsers(), 'forbidden')
  })
  it('a manager can create cashiers but never a super admin, and cannot grant extras', async () => {
    const roles = await db.roles.toArray()
    const mgr = await saveUser({ name: 'Boss', username: 'boss', roleId: roles.find((r) => r.key === 'manager')!.id, active: true, pin: '6666', password: 'Manager123', grants: [], denies: [], limits: DEFAULT_LIMITS })
    setActor(await login('boss', 'Manager123'))
    void mgr
    await saveUser({ name: 'New Cashier', username: 'newc', roleId: roles.find((r) => r.key === 'cashier')!.id, active: true, pin: '7777', grants: [], denies: [], limits: DEFAULT_LIMITS })
    await expectCode(saveUser({ name: 'Sneaky', username: 'sneaky', roleId: roles.find((r) => r.key === 'super_admin')!.id, active: true, pin: '8888', grants: [], denies: [], limits: DEFAULT_LIMITS }), 'forbidden')
    await expectCode(saveUser({ name: 'Gr', username: 'gr1', roleId: roles.find((r) => r.key === 'cashier')!.id, active: true, pin: '8899', grants: ['reports.view'], denies: [], limits: DEFAULT_LIMITS }), 'forbidden')
    await expectCode(saveRole({ name: 'Nope', description: '', permissions: ['pos.sell'], apps: ['pos'] }), 'forbidden')
  })
  it('super admin builds a custom role and gives a user extra grants / denies', async () => {
    const role = await saveRole({ name: 'Perfume Consultant', description: 'sells + sees reports', permissions: ['pos.sell', 'products.view', 'reports.view'], apps: ['pos'] })
    const u = await saveUser({ name: 'Nora', username: 'nora', roleId: role.id, active: true, pin: '1212', grants: ['customers.view'], denies: ['reports.view'], limits: DEFAULT_LIMITS })
    const actor = await loginWithPin(u.id, '1212')
    expect(actor.permissions).toContain('pos.sell')
    expect(actor.permissions).toContain('customers.view') // grant
    expect(actor.permissions).not.toContain('reports.view') // deny beats role
  })
  it('PINs are unique; usernames are unique', async () => {
    await makeCashier('Aaa', '3131')
    const roles = await db.roles.toArray()
    const cashier = roles.find((r) => r.key === 'cashier')!
    await expectCode(saveUser({ name: 'B', username: 'bbb', roleId: cashier.id, active: true, pin: '3131', grants: [], denies: [], limits: DEFAULT_LIMITS }), 'pin_taken')
    await expectCode(saveUser({ name: 'C', username: 'aaa', roleId: cashier.id, active: true, pin: '3232', grants: [], denies: [], limits: DEFAULT_LIMITS }), 'username_taken')
  })
  it('protects the last super admin and yourself', async () => {
    const owner = (await db.users.where('username').equals('owner').first())!
    const roles = await db.roles.toArray()
    const cashierRole = roles.find((r) => r.key === 'cashier')!
    await expectCode(deleteUser(owner.id), 'cannot_modify_self')
    await expectCode(saveUser({ id: owner.id, name: 'Owner', username: 'owner', roleId: cashierRole.id, active: true, grants: [], denies: [], limits: DEFAULT_LIMITS }), 'last_super_admin')
    await expectCode(saveUser({ id: owner.id, name: 'Owner', username: 'owner', roleId: owner.roleId, active: false, grants: [], denies: [], limits: DEFAULT_LIMITS }), 'last_super_admin')
  })
  it('super_admin role cannot be edited; roles in use cannot be deleted', async () => {
    const roles = await db.roles.toArray()
    await expectCode(saveRole({ id: roles.find((r) => r.key === 'super_admin')!.id, name: 'x', description: '', permissions: [], apps: [] }), 'role_locked')
  })
  it('admin can reset a cashier PIN and unlock them', async () => {
    const c = await makeCashier('Sara', '4545')
    for (let i = 0; i < 5; i++) try { await loginWithPin(c.id, '0000') } catch { /* expected */ }
    await resetCredentials(c.id, { pin: '5656' })
    expect((await loginWithPin(c.id, '5656')).name).toBe('Sara')
  })
  it('deleting a user with history is blocked (disable instead)', async () => {
    const c = await makeCashier('Hist', '6767')
    setActor(await loginWithPin(c.id, '6767'))
    await openShift({ openingIQD: 0, openingUSD: 0 })
    setActor(await login('owner', 'Owner1234'))
    await expectCode(deleteUser(c.id), 'user_has_history')
  })
})

describe('selling', () => {
  async function cashierSession(limits = DEFAULT_LIMITS) {
    const roles = await db.roles.toArray()
    const u = await saveUser({ name: 'Till', username: 'till', roleId: roles.find((r) => r.key === 'cashier')!.id, active: true, pin: '2468', password: 'Cashier123', grants: [], denies: [], limits })
    setActor(await loginWithPin(u.id, '2468'))
    return u
  }
  const pick = async (en: string, i = 0) => {
    const cat = await listCatalog()
    const item = cat.find((c) => c.product.name.en === en)!
    return item.variants[i]
  }

  it('sells without a shift unless the shop asks for one', async () => {
    await cashierSession()
    const v = await pick('Khamrah')
    const sale = await completeSale({ lines: [{ variantId: v.id, qty: 1, discountPct: 0 }], customerId: null, orderDiscount: null, giftWrap: false, redeemPoints: 0, payments: [{ method: 'cash_iqd', tendered: 50000 }], note: '' })
    expect(sale.shiftId).toBeNull()
  })

  it('needs an open shift when Settings asks for one', async () => {
    setActor(await login('owner', 'Owner1234'))
    await updateSettings({ sales: { requireShift: true } })
    await cashierSession()
    const v = await pick('Khamrah')
    await expectCode(completeSale({ lines: [{ variantId: v.id, qty: 1, discountPct: 0 }], customerId: null, orderDiscount: null, giftWrap: false, redeemPoints: 0, payments: [{ method: 'cash_iqd', tendered: 50000 }], note: '' }), 'shift_required')
  })

  it('completes a cash sale: stock drops, totals rounded, change given', async () => {
    await cashierSession()
    await openShift({ openingIQD: 100000, openingUSD: 0 })
    const v = await pick('Khamrah')
    const before = (await stockMap())[v.id]
    const sale = await completeSale({ lines: [{ variantId: v.id, qty: 2, discountPct: 0 }], customerId: null, orderDiscount: null, giftWrap: true, redeemPoints: 0, payments: [{ method: 'cash_iqd', tendered: 100000 }], note: '' })
    expect(sale.totalIQD).toBe(45000 * 2 + 2000)
    expect(sale.changeIQD).toBe(100000 - 92000)
    expect(sale.number).toMatch(/^ST1-\d{6}$/)
    expect((await stockMap())[v.id]).toBe(before - 2)
    expect(sale.payments[0].amountIQD).toBe(92000)
  })

  it('USD cash converts at the shop rate and gives IQD change', async () => {
    await cashierSession()
    await openShift({ openingIQD: 0, openingUSD: 0 })
    const v = await pick('Asad') // 42,000
    const sale = await completeSale({ lines: [{ variantId: v.id, qty: 1, discountPct: 0 }], customerId: null, orderDiscount: null, giftWrap: false, redeemPoints: 0, payments: [{ method: 'cash_usd', tendered: 50 }], note: '' })
    expect(sale.payments[0].amountIQD).toBe(42000)
    expect(sale.changeIQD).toBe(50 * 1460 - 42000) // 31,000
    expect(sale.payments[0].rate).toBe(1460)
    const shift = (await db.shifts.toArray())[0]
    const t = await computeShiftTotals(shift)
    expect(t.cashUSD).toBe(50)
    expect(t.cashIQD).toBe(-31000) // change paid out of the IQD drawer
  })

  it('split payment and underpayment', async () => {
    await cashierSession()
    await openShift({ openingIQD: 0, openingUSD: 0 })
    const v = await pick('Asad')
    const line = { variantId: v.id, qty: 1, discountPct: 0 }
    const base = { lines: [line], customerId: null, orderDiscount: null, giftWrap: false, redeemPoints: 0, note: '' }
    await expectCode(completeSale({ ...base, payments: [{ method: 'card', tendered: 10000 }] }), 'underpayment')
    const s = await completeSale({ ...base, payments: [{ method: 'card', tendered: 20000, reference: 'A1' }, { method: 'cash_iqd', tendered: 22000 }] })
    expect(s.paidIQD).toBe(42000)
    expect(s.changeIQD).toBe(0)
    await expectCode(completeSale({ ...base, payments: [{ method: 'card', tendered: 90000 }] }), 'overpayment_non_cash')
  })

  it('refuses to oversell', async () => {
    await cashierSession()
    await openShift({ openingIQD: 0, openingUSD: 0 })
    const v = await pick('Raghba') // 3 in stock
    await expectCode(completeSale({ lines: [{ variantId: v.id, qty: 4, discountPct: 0 }], customerId: null, orderDiscount: null, giftWrap: false, redeemPoints: 0, payments: [{ method: 'cash_iqd', tendered: 999999 }], note: '' }), 'insufficient_stock')
    expect((await stockMap())[v.id]).toBe(3) // transaction rolled back
  })

  it('discount above the cashier limit needs supervisor approval', async () => {
    await cashierSession()
    await openShift({ openingIQD: 0, openingUSD: 0 })
    const v = await pick('Asad')
    const base = { lines: [{ variantId: v.id, qty: 1, discountPct: 25 }], customerId: null, orderDiscount: null, giftWrap: false, redeemPoints: 0, payments: [{ method: 'cash_iqd' as const, tendered: 50000 }], note: '' }
    await expectCode(completeSale(base), 'approval_required')
    // owner's PIN is 1111
    const approver = await verifyApproval('1111', 'sales.discount.above_limit')
    expect(approver?.name).toBe('Owner')
    expect(await verifyApproval('2468', 'sales.discount.above_limit')).toBeNull() // a cashier's PIN can't approve
    const s = await completeSale({ ...base, approvedBy: approver })
    expect(s.approvedBy).toBe(approver!.id)
    expect(s.totalIQD).toBe(31500)
    // a forged approver (a cashier's id) is rejected
    const me = getActor()!
    await expectCode(completeSale({ ...base, approvedBy: { id: me.id, name: me.name } }), 'approval_invalid')
  })

  it('credit sales respect the customer limit and update the balance', async () => {
    await cashierSession()
    await openShift({ openingIQD: 0, openingUSD: 0 })
    const cust = (await db.customers.toArray()).find((c) => c.name === 'Al-Noor Perfumes')! // owes 350k, limit 1M
    const v = await pick('Khamrah')
    const mk = (qty: number) => ({ lines: [{ variantId: v.id, qty, discountPct: 0 }], customerId: cust.id, orderDiscount: null, giftWrap: false, redeemPoints: 0, payments: [{ method: 'debt' as const, tendered: 45000 * qty }], note: '' })
    const s = await completeSale(mk(2))
    expect(s.dueIQD).toBe(90000)
    expect((await db.customers.get(cust.id))!.balanceIQD).toBe(440000)
    await expectCode(completeSale(mk(14)), 'credit_limit_exceeded') // would exceed 1M (and stock)
    await expectCode(completeSale({ ...mk(1), customerId: null }), 'customer_required_for_debt')
  })

  it('collects a debt payment and blocks over-payment', async () => {
    await cashierSession()
    await openShift({ openingIQD: 0, openingUSD: 0 })
    const cust = (await db.customers.toArray()).find((c) => c.name === 'Al-Noor Perfumes')!
    await collectPayment({ customerId: cust.id, amountIQD: 100000, method: 'cash_iqd', note: '' })
    expect((await db.customers.get(cust.id))!.balanceIQD).toBe(250000)
    await expectCode(collectPayment({ customerId: cust.id, amountIQD: 999999, method: 'cash_iqd', note: '' }), 'overpayment')
    const t = await computeShiftTotals((await db.shifts.toArray())[0])
    expect(t.expectedIQD).toBe(100000) // collected cash is in the drawer
  })

  it('earns and redeems loyalty points', async () => {
    await cashierSession()
    await openShift({ openingIQD: 0, openingUSD: 0 })
    const zana = (await db.customers.toArray()).find((c) => c.name === 'Zana Ahmed')! // 320 pts
    const v = await pick('Asad')
    const s = await completeSale({ lines: [{ variantId: v.id, qty: 1, discountPct: 0 }], customerId: zana.id, orderDiscount: null, giftWrap: false, redeemPoints: 200, payments: [{ method: 'cash_iqd', tendered: 40000 }], note: '' })
    expect(s.pointsRedeemedIQD).toBe(2000) // 200 pts × 10 IQD
    expect(s.totalIQD).toBe(40000)
    expect((await db.customers.get(zana.id))!.points).toBe(320 - 200 + 40)
    await expectCode(completeSale({ lines: [{ variantId: v.id, qty: 1, discountPct: 0 }], customerId: zana.id, orderDiscount: null, giftWrap: false, redeemPoints: 999, payments: [{ method: 'cash_iqd', tendered: 42000 }], note: '' }), 'not_enough_points')
  })

  it('return: refunds the paid value, restocks, updates status; over-limit needs approval', async () => {
    await cashierSession({ maxDiscountPct: 10, maxRefundIQD: 50000 })
    await openShift({ openingIQD: 0, openingUSD: 0 })
    const v = await pick('Khamrah')
    const stock0 = (await stockMap())[v.id]
    const sale = await completeSale({ lines: [{ variantId: v.id, qty: 2, discountPct: 10 }], customerId: null, orderDiscount: null, giftWrap: false, redeemPoints: 0, payments: [{ method: 'cash_iqd', tendered: 81000 }], note: '' })
    expect(sale.totalIQD).toBe(81000)
    expect(unitRefund(sale, 0)).toBe(40500)
    const r = await createReturn({ saleId: sale.id, lines: [{ saleItemIndex: 0, qty: 1, restock: true, reason: 'changed mind' }], refundMethod: 'cash_iqd', note: '' })
    expect(r.refundIQD).toBe(40500)
    expect((await stockMap())[v.id]).toBe(stock0 - 2 + 1)
    expect((await db.sales.get(sale.id))!.status).toBe('partially_returned')
    // 2nd unit = 40,500 (< 50,000 limit) is fine, but a bigger refund needs a supervisor
    const big = await completeSale({ lines: [{ variantId: v.id, qty: 2, discountPct: 0 }], customerId: null, orderDiscount: null, giftWrap: false, redeemPoints: 0, payments: [{ method: 'cash_iqd', tendered: 90000 }], note: '' })
    await expectCode(createReturn({ saleId: big.id, lines: [{ saleItemIndex: 0, qty: 2, restock: true, reason: '' }], refundMethod: 'cash_iqd', note: '' }), 'approval_required')
    const approver = await verifyApproval('1111', 'returns.above_limit')
    const r2 = await createReturn({ saleId: big.id, lines: [{ saleItemIndex: 0, qty: 2, restock: true, reason: '' }], refundMethod: 'cash_iqd', note: '', approvedBy: approver })
    expect(r2.refundIQD).toBe(90000)
    expect((await db.sales.get(big.id))!.status).toBe('returned')
    await expectCode(createReturn({ saleId: big.id, lines: [{ saleItemIndex: 0, qty: 1, restock: true, reason: '' }], refundMethod: 'cash_iqd', note: '' }), 'invalid_quantity')
  })

  it('void: cashier needs approval; stock and debt are restored', async () => {
    await cashierSession()
    await openShift({ openingIQD: 0, openingUSD: 0 })
    const cust = (await db.customers.toArray()).find((c) => c.name === 'Rose Gift Gallery')!
    const v = await pick('Asad')
    const stock0 = (await stockMap())[v.id]
    const s = await completeSale({ lines: [{ variantId: v.id, qty: 1, discountPct: 0 }], customerId: cust.id, orderDiscount: null, giftWrap: false, redeemPoints: 0, payments: [{ method: 'debt', tendered: 42000 }], note: '' })
    await expectCode(voidSale(s.id, 'mistake'), 'approval_required')
    const approver = await verifyApproval('1111', 'sales.void')
    const voided = await voidSale(s.id, 'mistake', approver)
    expect(voided.status).toBe('voided')
    expect((await stockMap())[v.id]).toBe(stock0)
    expect((await db.customers.get(cust.id))!.balanceIQD).toBe(0)
    await expectCode(voidSale(s.id, 'again', approver), 'sale_not_voidable')
  })

  it('shift close: expected vs counted with variance, then a new shift can open', async () => {
    await cashierSession()
    await openShift({ openingIQD: 50000, openingUSD: 0 })
    const v = await pick('Asad')
    await completeSale({ lines: [{ variantId: v.id, qty: 1, discountPct: 0 }], customerId: null, orderDiscount: null, giftWrap: false, redeemPoints: 0, payments: [{ method: 'cash_iqd', tendered: 42000 }], note: '' })
    await completeSale({ lines: [{ variantId: v.id, qty: 1, discountPct: 0 }], customerId: null, orderDiscount: null, giftWrap: false, redeemPoints: 0, payments: [{ method: 'card', tendered: 42000 }], note: '' })
    const closed = await closeShift({ countedIQD: 90000, countedUSD: 0, note: 'short 2k' })
    expect(closed.totals!.salesCount).toBe(2)
    expect(closed.totals!.expectedIQD).toBe(92000) // 50k float + 42k cash (card isn't in the drawer)
    expect(closed.varianceIQD).toBe(-2000)
    expect(closed.status).toBe('closed')
    await openShift({ openingIQD: 0, openingUSD: 0 })
  })

  it('cashier sees only their own sales; manager sees all', async () => {
    const c1 = await cashierSession()
    await openShift({ openingIQD: 0, openingUSD: 0 })
    const v = await pick('Asad')
    await completeSale({ lines: [{ variantId: v.id, qty: 1, discountPct: 0 }], customerId: null, orderDiscount: null, giftWrap: false, redeemPoints: 0, payments: [{ method: 'cash_iqd', tendered: 42000 }], note: '' })
    expect((await listSales()).length).toBe(1)
    void c1
    setActor(await login('owner', 'Owner1234'))
    expect((await listSales()).length).toBe(1)
    await makeCashier('Other', '9090')
    setActor(await loginWithPin((await db.users.where('username').equals('other').first())!.id, '9090'))
    expect((await listSales()).length).toBe(0)
  })
})

describe('inventory & reports', () => {
  it('adjust, count and tester movements are audited and never go negative', async () => {
    const cat = await listCatalog()
    const v = cat.find((c) => c.product.name.en === 'Yara')!.variants[0]
    await adjustStock({ variantId: v.id, newQty: 20, reason: 'adjustment', note: 'recount' })
    expect((await stockMap())[v.id]).toBe(20)
    await markTester(v.id, 1, 'shop tester')
    expect((await stockMap())[v.id]).toBe(19)
    const r = await applyStockCount([{ variantId: v.id, expected: 19, counted: 18 }], 'monthly')
    expect(r.changed).toBe(1)
    expect((await stockMap())[v.id]).toBe(18)
    await expectCode(adjustStock({ variantId: v.id, newQty: -1, reason: 'damage', note: '' }), 'invalid_quantity')
    const types = (await db.stockMovements.where('variantId').equals(v.id).toArray()).map((m) => m.type)
    expect(types).toEqual(expect.arrayContaining(['opening', 'adjustment', 'tester', 'count']))
  })

  it('sales report totals, profit only for financial permission', async () => {
    const roles = await db.roles.toArray()
    const u = await saveUser({ name: 'Till', username: 'till', roleId: roles.find((r) => r.key === 'cashier')!.id, active: true, pin: '2468', grants: ['reports.view'], denies: [], limits: DEFAULT_LIMITS })
    setActor(await loginWithPin(u.id, '2468'))
    await openShift({ openingIQD: 0, openingUSD: 0 })
    const cat = await listCatalog()
    const v = cat.find((c) => c.product.name.en === 'Asad')!.variants[0]
    await completeSale({ lines: [{ variantId: v.id, qty: 2, discountPct: 0 }], customerId: null, orderDiscount: null, giftWrap: false, redeemPoints: 0, payments: [{ method: 'cash_iqd', tendered: 84000 }], note: '' })
    const r = await salesReport(startOfDay(), endOfDay())
    expect(r.count).toBe(1)
    expect(r.revenueIQD).toBe(84000)
    expect(r.unitsSold).toBe(2)
    expect(r.profitIQD).toBeNull() // cashier has no reports.financial
    setActor(await login('owner', 'Owner1234'))
    const r2 = await salesReport(startOfDay(), endOfDay())
    expect(r2.profitIQD).toBe(84000 - 2 * 25000)
  })

  it('settings can be changed only with settings.edit', async () => {
    const roles = await db.roles.toArray()
    const m = await saveUser({ name: 'Boss', username: 'boss', roleId: roles.find((r) => r.key === 'manager')!.id, active: true, pin: '6666', password: 'Manager123', grants: [], denies: [], limits: DEFAULT_LIMITS })
    void m
    const s = await updateSettings({ currency: { rate: 1500 } })
    expect(s.currency.rate).toBe(1500)
    expect(s.currency.rounding).toBe(250) // untouched siblings survive the deep merge
    setActor(await login('boss', 'Manager123'))
    await expectCode(updateSettings({ currency: { rate: 1 } }), 'forbidden')
  })

  it('ensureSystemRoles is idempotent', async () => {
    const n = (await db.roles.count())
    await ensureSystemRoles()
    expect(await db.roles.count()).toBe(n)
  })
})

describe('bottle sizes in ml or oz', () => {
  const baseProduct = () => ({
    name: { en: 'Oz Test', ar: '', ku: '' }, description: { en: '', ar: '', ku: '' }, brand: 'Lattafa', category: 'perfume', gender: 'unisex' as const, concentration: 'EDP',
    scentFamilies: [], notes: { top: [], heart: [], base: [] }, season: 'all' as const, longevity: 3, sillage: 3, image: null,
    art: { c1: '#000000', c2: '#111111', shape: 'rect' as const }, showOnMenu: true, featured: false, isNew: false, active: true,
  })
  const variant = (sku: string, size: number, unit: 'ml' | 'oz', label = '') => ({
    label, size, unit, sku, barcode: '', costIQD: 10000, retailIQD: 20000, wholesaleIQD: 16000, minStock: 2, isTester: false, active: true, openingStock: 3,
  })

  it('stores size + unit as typed and keeps a normalised ml value; the label fills itself in', async () => {
    await saveProduct({ product: baseProduct(), variants: [variant('OZ-1', 3.4, 'oz'), variant('ML-1', 100, 'ml'), variant('OZ-2', 1, 'oz', 'Travel')] })
    const item = (await listCatalog()).find((c) => c.product.name.en === 'Oz Test')!
    const bySku = Object.fromEntries(item.variants.map((v) => [v.sku, v]))
    expect(bySku['OZ-1']).toMatchObject({ size: 3.4, unit: 'oz', ml: 101, label: '3.4 oz' })
    expect(bySku['ML-1']).toMatchObject({ size: 100, unit: 'ml', ml: 100, label: '100 ml' })
    expect(bySku['OZ-2']).toMatchObject({ size: 1, unit: 'oz', ml: 30, label: 'Travel' }) // a typed label wins
    expect(item.variants.map((v) => v.sku)).toEqual(['OZ-1', 'ML-1', 'OZ-2']) // biggest first, regardless of unit (101 > 100 > 30 ml)
  })

  it('rejects a bad unit or a negative size', async () => {
    await expectCode(saveProduct({ product: baseProduct(), variants: [variant('BAD-1', 5, 'cl' as never)] }), 'invalid_size')
    await expectCode(saveProduct({ product: baseProduct(), variants: [variant('BAD-2', -1, 'ml')] }), 'invalid_size')
  })

  it('demo data is millilitres', async () => {
    const v = (await listCatalog()).find((c) => c.product.name.en === 'Khamrah')!.variants[0]
    expect(v).toMatchObject({ size: 100, unit: 'ml', ml: 100, label: '100 ml' })
  })

  it('CSV import accepts size + unit, and old files with only an ml column', async () => {
    const head = 'sku,name_en,brand,retail_iqd,'
    const prev = previewImport(`${head}size,unit\r\nCSV-OZ,Csv Oz,Lattafa,30000,3.4,oz\r\nCSV-NEW,Csv Ml,Lattafa,30000,50,ml\r\n`)
    expect(prev.errors).toEqual([])
    const old = previewImport(`${head}ml\r\nCSV-OLD,Csv Old,Lattafa,30000,75\r\n`)
    expect(old.errors).toEqual([])
    await importCatalog([...prev.rows, ...old.rows])
    const all = (await listCatalog({ includeInactive: true })).flatMap((c) => c.variants)
    expect(all.find((v) => v.sku === 'CSV-OZ')).toMatchObject({ size: 3.4, unit: 'oz', ml: 101, label: '3.4 oz' })
    expect(all.find((v) => v.sku === 'CSV-NEW')).toMatchObject({ size: 50, unit: 'ml', label: '50 ml' })
    expect(all.find((v) => v.sku === 'CSV-OLD')).toMatchObject({ size: 75, unit: 'ml', ml: 75, label: '75 ml' })
    expect(previewImport(`${head}size,unit\r\nX,Bad,Lattafa,1,5,cl\r\n`).errors[0].message).toMatch(/unit must be ml or oz/)
  })

  it('an exported catalogue carries the unit and re-imports cleanly', async () => {
    await saveProduct({ product: baseProduct(), variants: [variant('RT-1', 1.7, 'oz')] })
    const csv = await exportCatalogCsv()
    const lines = csv.replace(/^﻿/, '').split('\r\n')
    expect(lines[0]).toContain('size_label,size,unit,cost_iqd')
    const row = lines.find((l) => l.startsWith('RT-1'))!
    expect(row).toContain(',1.7 oz,1.7,oz,')
    expect(previewImport(csv).errors).toEqual([])
  })

  it('old bottles (saved before units existed) are upgraded to ml', async () => {
    const v = (await db.variants.toArray())[0]
    const { size: _s, unit: _u, ...legacy } = v // what an old database / backup holds
    await db.variants.put(legacy as typeof v)
    await backfillSizes(db.variants)
    expect(await db.variants.get(v.id)).toMatchObject({ size: v.ml, unit: 'ml' })
  })
})
