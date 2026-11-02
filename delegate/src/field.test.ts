import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Actor, Customer, Product, Variant } from '@/data/types'
import { isAppError, setActor } from '@/services/context'
import { DEFAULT_SETTINGS } from '@/services/settings'
import { ddb } from './data'
import { addCustomer, collect, completeSale, myDay, requestStock, shopItems, submitClosing, usdListPrice, type DelegateCart } from './field'
import { applyPull } from './sync'

const now = Date.now()
const actor: Actor = {
  id: 'u-ahmed', name: 'Ahmed', username: 'ahmed', roleId: 'r-del', roleKey: 'delegate', roleName: 'Delegate', color: '#000',
  permissions: ['delegate.sell', 'delegate.visit', 'delegate.request_stock', 'delegate.close', 'customers.view', 'customers.create', 'customers.collect', 'customers.credit'],
  limits: { maxDiscountPct: 10, maxRefundIQD: 0 }, isSuperAdmin: false,
}
const product: Product = {
  id: 'p-kh', name: { en: 'Khamrah', ar: 'خمرة', ku: 'خەمرە' }, description: { en: '', ar: '', ku: '' }, brand: 'Lattafa', category: 'perfume', gender: 'unisex',
  concentration: 'EDP', scentFamilies: [], notes: { top: [], heart: [], base: [] }, season: 'all', longevity: 3, sillage: 3, image: null,
  art: { c1: '#000', c2: '#111', shape: 'rect' }, showOnMenu: true, featured: false, isNew: false, active: true, createdAt: now, updatedAt: now,
}
const variant: Variant = { id: 'v-kh', productId: 'p-kh', label: '100 ml', size: 100, unit: 'ml', ml: 100, sku: 'LTF-KHAM-100', barcode: '200', costIQD: 0, retailIQD: 45000, wholesaleIQD: 36000, minStock: 2, isTester: false, active: true }
const shop: Customer = { id: 'c-noor', name: 'Al-Noor', phone: '0751', type: 'shop', city: 'Duhok', notes: '', balanceIQD: 100000, creditLimitIQD: 200000, points: 0, active: true, createdAt: now, updatedAt: now }
const { key: _k, device: _d, sync: _s, ...settings } = DEFAULT_SETTINGS
void _k; void _d; void _s

const cart = (over: Partial<DelegateCart> = {}): DelegateCart => ({ customerId: 'c-noor', priceList: 'wholesale', lines: [{ variantId: 'v-kh', qty: 2 }], discountPct: 0, currency: 'IQD', payment: 'cash', paidNow: 0, note: '', ...over })

async function code(p: Promise<unknown>, c: string) {
  try { await p } catch (e) { expect(isAppError(e) ? e.code : String(e)).toBe(c); return }
  throw new Error(`expected ${c}`)
}

beforeEach(async () => {
  await ddb.delete()
  await ddb.open()
  vi.stubGlobal('fetch', async () => { throw new TypeError('offline') }) // the field: no signal
  await ddb.meta.put({ key: 'app', deviceId: 'dev-1', deviceCode: 'DL1', deviceName: 'Phone', lastPullAt: 1, pulledFor: 'u-ahmed', settings: { ...settings, setupDone: true } })
  await ddb.products.put(product)
  await ddb.variants.put(variant)
  await ddb.stock.put({ variantId: 'v-kh', qty: 5 }) // the shop has 5
  await ddb.customers.put(shop)
  setActor(actor)
})
afterEach(() => { vi.unstubAllGlobals(); setActor(null) })

describe('selling from the shop’s stock', () => {
  it('the delegate sees every perfume the shop has', async () => {
    expect((await shopItems()).map((r) => [r.variant.id, r.qty])).toEqual([['v-kh', 5]])
  })

  it('a cash sale at wholesale takes bottles out of the shop’s stock and queues the sale', async () => {
    const s = await completeSale(cart())
    expect(s).toMatchObject({ number: 'DL1-000001', channel: 'delegate', totalIQD: 72000, paidIQD: 72000, dueIQD: 0, customerId: 'c-noor' })
    expect(s.items[0]).toMatchObject({ unitPriceIQD: 36000, qty: 2 })
    expect((await ddb.stock.get('v-kh'))?.qty).toBe(3)
    expect((await ddb.outbox.toArray()).map((r) => r.entity)).toContain('sale')
    expect((await completeSale(cart({ priceList: 'retail', lines: [{ variantId: 'v-kh', qty: 1 }] }))).totalIQD).toBe(45000)
  })

  it('can never sell more than the shop has', async () => {
    await code(completeSale(cart({ lines: [{ variantId: 'v-kh', qty: 6 }] })), 'insufficient_stock')
    expect((await ddb.stock.get('v-kh'))?.qty).toBe(5)
  })

  it('the place is saved with the sale', async () => {
    const s = await completeSale(cart({ note: 'Zakho, main market' }), { lat: 37.1436, lng: 42.6819, accuracyM: 12 })
    expect(s).toMatchObject({ lat: 37.1436, lng: 42.6819, accuracyM: 12, note: 'Zakho, main market' })
    expect((await completeSale(cart({ lines: [{ variantId: 'v-kh', qty: 1 }] }))).lat).toBeNull() // no GPS: saved without a pin
  })

  it('debt and partial payments go on the customer, within the credit limit', async () => {
    const debt = await completeSale(cart({ payment: 'debt' }))
    expect([debt.paidIQD, debt.dueIQD]).toEqual([0, 72000])
    expect((await ddb.customers.get('c-noor'))?.balanceIQD).toBe(172000)
    const part = await completeSale(cart({ payment: 'partial', paidNow: 10000, lines: [{ variantId: 'v-kh', qty: 1 }] }))
    expect([part.paidIQD, part.dueIQD]).toEqual([10000, 26000])
    expect(part.payments.map((p) => p.method)).toEqual(['cash_iqd', 'debt'])
    // 198,000 owed of a 200,000 limit: no room for more
    await code(completeSale(cart({ payment: 'debt', lines: [{ variantId: 'v-kh', qty: 1 }] })), 'credit_limit_exceeded')
    await code(completeSale(cart({ customerId: null, payment: 'debt' })), 'customer_required_for_debt')
  })

  it('discounts stay within the delegate’s limit', async () => {
    expect((await completeSale(cart({ discountPct: 10 }))).totalIQD).toBe(64750) // 72,000 − 10% = 64,800 → 250 step
    await code(completeSale(cart({ discountPct: 15 })), 'invalid_discount')
  })
})

describe('customers, requests and my day', () => {
  it('collecting debt reduces the balance but never below zero', async () => {
    await collect('c-noor', 40000, 'cash_iqd', 'part')
    expect((await ddb.customers.get('c-noor'))?.balanceIQD).toBe(60000)
    await code(collect('c-noor', 70000, 'cash_iqd', ''), 'overpayment')
  })

  it('a shop added on the road is queued for the server', async () => {
    const c = await addCustomer({ name: 'Zakho Perfumes', phone: '0750 111', type: 'shop', city: 'Zakho', notes: '', position: { lat: 37.14, lng: 42.68, accuracyM: 10 } })
    expect(c).toMatchObject({ lat: 37.14, lng: 42.68, balanceIQD: 0 })
    expect((await ddb.outbox.toArray()).some((r) => r.entity === 'customer' && r.entityId === c.id)).toBe(true)
    await code(addCustomer({ name: 'Dup', phone: '0750 111', type: 'shop', city: '', notes: '', position: null }), 'phone_taken')
  })

  it('today’s numbers', async () => {
    await completeSale(cart())                                  // 72,000 cash
    await completeSale(cart({ payment: 'debt', lines: [{ variantId: 'v-kh', qty: 1 }] })) // 36,000 credit
    await collect('c-noor', 50000, 'cash_iqd', '')
    const d = await myDay()
    // vanUnits = bottles sold today
    expect([d.sales.length, d.salesIQD, d.cashSalesIQD, d.creditSalesIQD, d.collectionsIQD, d.cashInHandIQD, d.vanUnits]).toEqual([2, 108000, 72000, 36000, 50000, 122000, 3])
  })

  it('a closing with no signal is kept and queued after the day’s sales', async () => {
    await completeSale(cart())
    const c = await submitClosing({ countedCashIQD: 70000, countedCashUSD: 0, expensesIQD: 2000, note: 'fuel' })
    expect(c).toMatchObject({ status: 'pending', expectedCashIQD: 70000, varianceIQD: 0 })
    const order = (await ddb.outbox.orderBy('createdAt').toArray()).map((r) => r.entity)
    expect(order.indexOf('sale')).toBeLessThan(order.indexOf('closing'))
  })
})

describe('dollars', () => {
  const balance = async () => (await ddb.customers.get('c-noor'))?.balanceIQD

  it('dollar prices are the dinar price converted and rounded to half a dollar', () => {
    expect([usdListPrice(36000, 1460), usdListPrice(45000, 1460), usdListPrice(500, 1460)]).toEqual([35770, 45260, 730]) // $24.50, $31, never under $0.50
  })

  it('a dollar bill is priced per bottle in dollars and paid as dollars', async () => {
    const s = await completeSale(cart({ currency: 'USD' })) // 2 × $24.50 = $49 = 71,540
    expect(s).toMatchObject({ totalIQD: 71540, roundingIQD: 0, paidIQD: 71540, dueIQD: 0, currency: 'USD', exchangeRate: 1460 })
    expect(s.items[0]).toMatchObject({ unitPriceIQD: 35770, qty: 2 })
    expect(s.payments).toEqual([{ method: 'cash_usd', amountIQD: 71540, tendered: 49, currency: 'USD', rate: 1460, reference: '' }])
    expect((await completeSale(cart({ currency: 'USD', priceList: 'retail', lines: [{ variantId: 'v-kh', qty: 1 }] }))).payments[0].tendered).toBe(31)
  })

  it('a size with its own dollar price is sold at exactly that price, cents and all', async () => {
    // the shop set $23.70 for this size in the product sheet; it beats the converted-and-rounded $24.50
    await ddb.variants.update('v-kh', { wholesaleUSDCents: 2370 })
    const s = await completeSale(cart({ currency: 'USD' }))
    expect(s.items[0].unitPriceIQD).toBe(34602)           // $23.70 × 1460
    expect(s.payments[0].tendered).toBe(47.4)             // 2 × $23.70, no rounding to half a dollar
    // it is the dollar price list, so a dinar bill and a retail bill are untouched
    expect((await completeSale(cart({ lines: [{ variantId: 'v-kh', qty: 1 }] }))).items[0].unitPriceIQD).toBe(36000)
    expect((await completeSale(cart({ currency: 'USD', priceList: 'retail', lines: [{ variantId: 'v-kh', qty: 1 }] }))).items[0].unitPriceIQD).toBe(45260)
  })

  it('at an odd rate the bill is still whole half-dollars', async () => {
    const m = (await ddb.meta.get('app'))!
    await ddb.meta.put({ ...m, settings: { ...m.settings!, currency: { ...m.settings!.currency, rate: 1475 } } })
    // $24.50 a bottle is 36,137.5 IQD: kept as 36,138, two are 72,276 → $49 exactly is 72,275
    const s = await completeSale(cart({ currency: 'USD' }))
    expect([s.items[0].unitPriceIQD, s.totalIQD, s.roundingIQD, s.payments[0].tendered]).toEqual([36138, 72275, -1, 49])
    const d = await completeSale(cart({ currency: 'USD', discountPct: 5, lines: [{ variantId: 'v-kh', qty: 1 }] })) // $24.50 − 5% = $23.275 → $23.50
    expect([d.totalIQD, d.payments[0].tendered]).toEqual([34663, 23.5])
  })

  it('a discount on a dollar bill rounds to half a dollar', async () => {
    const s = await completeSale(cart({ currency: 'USD', discountPct: 5 })) // $49 − 5% = $46.55 → $46.50
    expect([s.totalIQD, s.payments[0].tendered]).toEqual([67890, 46.5])
  })

  it('part paid in dollars now, the rest goes on the account in dinars', async () => {
    const s = await completeSale(cart({ currency: 'USD', payment: 'partial', paidNow: 20 }))
    expect([s.paidIQD, s.dueIQD]).toEqual([29200, 42340])
    expect(s.payments.map((p) => [p.method, p.tendered])).toEqual([['cash_usd', 20], ['debt', 42340]])
    expect(await balance()).toBe(142340)
  })

  it('when the shop turns dollars off, the bill is in dinars', async () => {
    const m = (await ddb.meta.get('app'))!
    await ddb.meta.put({ ...m, settings: { ...m.settings!, currency: { ...m.settings!.currency, usdEnabled: false } } })
    const s = await completeSale(cart({ currency: 'USD' }))
    expect([s.totalIQD, s.payments[0].method]).toEqual([72000, 'cash_iqd'])
  })

  it('debt collected in dollars; paying all of it settles the balance exactly', async () => {
    const c = await collect('c-noor', 50, 'cash_usd', '') // $50 → 73,000
    expect(c).toMatchObject({ amountIQD: 73000, tendered: 50, currency: 'USD', rate: 1460 })
    expect(await balance()).toBe(27000)
    await collect('c-noor', 18.49, 'cash_usd', '') // 27,000 ÷ 1,460 = $18.49 → 26,995: the cents settle the whole debt
    expect(await balance()).toBe(0)
    await code(collect('c-noor', 1, 'cash_usd', ''), 'overpayment')
  })

  it('dinars and dollars are separate piles at the end of the day', async () => {
    await completeSale(cart({ currency: 'USD' }))                       // $49
    await completeSale(cart({ lines: [{ variantId: 'v-kh', qty: 1 }] })) // 36,000 IQD
    await collect('c-noor', 20, 'cash_usd', '')                         // $20
    const d = await myDay()
    expect([d.cashInHandIQD, d.cashInHandUSD, d.cashSalesUSD, d.collectionsUSD, d.cashSalesIQD]).toEqual([36000, 69, 49, 20, 107540])
    const c = await submitClosing({ countedCashIQD: 36000, countedCashUSD: 68, expensesIQD: 0, note: '' })
    expect(c).toMatchObject({ expectedCashIQD: 36000, varianceIQD: 0, expectedCashUSD: 69, countedCashUSD: 68, varianceUSD: -1 })
  })
})

describe('pull', () => {
  it('the shop’s stock comes from the server, minus sales not sent yet; pending requests stay', async () => {
    await completeSale(cart()) // −2, not pushed
    await requestStock([{ variantId: 'v-kh', qty: 3 }], '')
    await applyPull({
      serverTime: now + 1, since: 0, settings: { ...settings, setupDone: true }, roles: [], users: [],
      products: [{ ...product, variants: [{ ...variant, stock: 10 }] }], customers: [shop], deleted: { products: [], users: [], roles: [] },
      device: { id: 'dev-1', name: 'Phone', code: 'DL1', registeredAt: now, revoked: false }, counters: { sale: 7, return: 0 },
      van: { locationId: 'van:u-ahmed', stock: {}, requests: [], closings: [] },
    }, 'u-ahmed')
    expect((await ddb.stock.get('v-kh'))?.qty).toBe(8)
    expect(await ddb.requests.count()).toBe(1)
    expect((await ddb.customers.get('c-noor'))?.balanceIQD).toBe(100000)
    expect((await ddb.counters.get('sale:DL1'))?.value).toBe(7)
  })
})
