/**
 * What a delegate does in the field. Every action is written to the phone first (so it works with no signal),
 * changes the shop stock / customer balance locally right away, and is queued for the server.
 */
import type { Collection, Customer, CustomerType, Payment, PaymentMethod, Product, Sale, SaleItem, Variant } from '@/data/types'
import { uuid } from '@/lib/id'
import { iqdToUsd, usdToIqd } from '@/lib/money'
import { hasPerm } from '@/lib/permissions'
import { priceCart } from '@/lib/pricing'
import { AppError, requireActor } from '@/services/context'
import { api, isOfflineError } from '@/services/api'
import { ddb, getMeta, nextCounter, type Closing, type StockRequest, type Visit, type VisitOutcome } from './data'
import { queue, push } from './sync'

const need = (perm: string) => {
  const a = requireActor()
  if (!hasPerm(a.permissions, perm)) throw new AppError('forbidden', { permission: perm })
  return a
}

/* ───────── location ───────── */

export interface Position { lat: number; lng: number; accuracyM: number }

/** The phone's position, or null (no permission, no fix in time, plain-http page). Never blocks a sale for long. */
export function getPosition(timeoutMs = 6000): Promise<Position | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null)
    const done = setTimeout(() => resolve(null), timeoutMs + 500)
    navigator.geolocation.getCurrentPosition(
      (p) => { clearTimeout(done); resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: Math.round(p.coords.accuracy) }) },
      () => { clearTimeout(done); resolve(null) },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    )
  })
}

/** Straight-line distance in km. */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371, rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/* ───────── the shop's stock ───────── */

/** One size a delegate can sell, and how many the shop has (as of the last sync, less this phone's sales since). */
export interface ShopItem { variant: Variant; product: Product; qty: number }

/** Every perfume on sale (sold-out sizes too, so the delegate sees them), A–Z, big bottles first. */
export async function shopItems(): Promise<ShopItem[]> {
  const [products, variants, stock] = await Promise.all([ddb.products.toArray(), ddb.variants.toArray(), ddb.stock.toArray()])
  const pm = new Map(products.filter((p) => p.active).map((p) => [p.id, p]))
  const qty = new Map(stock.map((r) => [r.variantId, r.qty]))
  const nameOf = (p: Product) => p.name.en || p.name.ar || p.name.ku
  return variants.filter((v) => v.active && !v.isTester && pm.has(v.productId))
    .map((v) => ({ variant: v, product: pm.get(v.productId)!, qty: qty.get(v.id) ?? 0 }))
    .sort((a, b) => nameOf(a.product).localeCompare(nameOf(b.product)) || b.variant.ml - a.variant.ml)
}

/* ───────── selling ───────── */

export type PriceList = 'wholesale' | 'retail'
export const defaultPriceList = (t?: CustomerType): PriceList => (t === 'shop' || t === 'wholesale' ? 'wholesale' : 'retail')

export type Currency = 'IQD' | 'USD'

/**
 * A list price in dollars, as the delegate sees it: the dinar price at the shop's rate, to the nearest 50 cents (never
 * below 50 cents), kept in dinars — so "$24.50" on the phone is exactly what the bill says. The server accepts these
 * (SaleService::usdListPrice does the same sum).
 */
export function usdListPrice(iqd: number, rate: number): number {
  if (iqd <= 0 || rate <= 0) return iqd
  return Math.round(Math.max(0.5, Math.round((iqd / rate) * 2) / 2) * rate)
}

/**
 * A size's price on this bill, in dinars.
 *
 * A dollar bill at the wholesale list uses the shop's **dollar price list** when that size has one (set in the product
 * sheet, exact to the cent, the same price for every shop). Without one it falls back to the dinar price at the day's
 * rate, to the nearest 50 cents — how every dollar bill worked before the list existed.
 */
export function unitPrice(v: Variant, list: PriceList, currency: Currency = 'IQD', rate = 0): number {
  const usd = v.wholesaleUSDCents ?? 0
  if (currency === 'USD' && list === 'wholesale' && usd > 0 && rate > 0) return Math.round((usd / 100) * rate)
  const iqd = list === 'wholesale' ? v.wholesaleIQD || v.retailIQD : v.retailIQD
  return currency === 'USD' ? usdListPrice(iqd, rate) : iqd
}

export interface DelegateCart {
  customerId: string | null
  priceList: PriceList
  lines: { variantId: string; qty: number }[]
  discountPct: number
  /** the bill's currency: prices are kept in IQD and shown / paid in dollars at the shop's rate */
  currency: Currency
  /** cash = all paid now; debt = all on the customer's account; partial = `paidNow` (in `currency`) now, the rest on account */
  payment: 'cash' | 'debt' | 'partial'
  paidNow: number
  note: string
}

/** The shop's dollar rate and whether dollars are accepted at all (Settings → currency). */
export async function currencySettings() {
  const c = (await getMeta()).settings?.currency
  return { rate: c?.rate && c.rate > 0 ? c.rate : 1460, usdEnabled: c?.usdEnabled ?? true, rounding: c?.rounding ?? 250 }
}

/** Dollars with cents, never floating-point noise. */
export const cents = (n: number) => Math.round(n * 100) / 100

/** Bill maths — the same `priceCart` the POS and the server use. */
export async function priceDelegateCart(cart: DelegateCart) {
  const { rate, usdEnabled, rounding } = await currencySettings()
  const currency: Currency = usdEnabled && cart.currency === 'USD' ? 'USD' : 'IQD'
  const variants = new Map((await ddb.variants.bulkGet(cart.lines.map((l) => l.variantId))).filter((v): v is Variant => !!v).map((v) => [v.id, v]))
  const price = (step: number) => priceCart({
    lines: cart.lines.map((l) => ({ key: l.variantId, unitPriceIQD: variants.get(l.variantId) ? unitPrice(variants.get(l.variantId)!, cart.priceList, currency, rate) : 0, qty: l.qty, discountPct: 0 })),
    orderDiscount: cart.discountPct > 0 ? { type: 'pct', value: cart.discountPct } : null,
    rounding: step,
    taxPct: 0,
  })
  let priced = price(currency === 'USD' ? 0 : rounding)
  // a price the shop set itself ($23.70) is exact: a bill of those is left to the cent, never nudged to half a dollar
  const exact = cart.priceList === 'wholesale' && cart.lines.some((l) => (variants.get(l.variantId)?.wholesaleUSDCents ?? 0) > 0)
  if (currency === 'USD' && !exact) {
    // a dollar bill is rounded to 50 cents (like a dinar bill to 250), so a discount never leaves e.g. $24.66. Rounded
    // in dollars: at an odd rate (1,475) half a dollar isn't a whole number of dinars. Under half a dollar keeps the cents.
    const usd = Math.round(iqdToUsd(priced.total, rate) * 2) / 2
    if (usd > 0) { const total = usdToIqd(usd, rate); priced = { ...priced, rounding: priced.rounding + total - priced.total, total } }
  }
  const paidNow = Math.max(0, cart.paidNow || 0)
  const paid = cart.payment === 'cash' ? priced.total : cart.payment === 'debt' ? 0
    : Math.min(priced.total, currency === 'USD' ? usdToIqd(paidNow, rate) : Math.round(paidNow))
  const totalUSD = cents(iqdToUsd(priced.total, rate))
  // dollars handed over: the whole bill in dollars, or the part paid now
  const paidUSD = currency !== 'USD' || paid === 0 ? 0 : paid === priced.total ? totalUSD : cents(Math.min(paidNow, totalUSD))
  return { priced, paid, due: priced.total - paid, variants, currency, rate, paidUSD, totalUSD }
}

/** Finishes the bill. `position` is where the phone is (taken while the delegate picked the shop), or null. */
export async function completeSale(cart: DelegateCart, position: Position | null = null): Promise<Sale> {
  const actor = need('delegate.sell')
  if (!cart.lines.length) throw new AppError('cart_empty')
  if (cart.discountPct < 0 || cart.discountPct > actor.limits.maxDiscountPct) throw new AppError('invalid_discount')
  const meta = await getMeta()
  const { priced, paid, due, variants, currency, paidUSD, rate } = await priceDelegateCart(cart)
  const customer = cart.customerId ? await ddb.customers.get(cart.customerId) : undefined
  if (cart.customerId && !customer) throw new AppError('not_found')
  if (due > 0) {
    if (!customer) throw new AppError('customer_required_for_debt')
    if (!hasPerm(actor.permissions, 'customers.credit')) throw new AppError('forbidden', { permission: 'customers.credit' })
    if (customer.balanceIQD + due > customer.creditLimitIQD) throw new AppError('credit_limit_exceeded', { limit: customer.creditLimitIQD, balance: customer.balanceIQD })
  }
  let sale!: Sale
  await ddb.transaction('rw', [ddb.stock, ddb.sales, ddb.customers, ddb.counters, ddb.outbox, ddb.products], async () => {
    const items: SaleItem[] = []
    for (let i = 0; i < cart.lines.length; i++) {
      const l = cart.lines[i]
      const v = variants.get(l.variantId)
      if (!v || !Number.isInteger(l.qty) || l.qty <= 0) throw new AppError('invalid_quantity')
      const inShop = (await ddb.stock.get(v.id))?.qty ?? 0
      // the shop's stock is the limit: a delegate can't sell what the shop doesn't have
      if (l.qty > inShop) throw new AppError('insufficient_stock', { sku: v.sku, available: Math.max(0, inShop) })
      const p = await ddb.products.get(v.productId)
      const line = priced.lines[i]
      items.push({
        variantId: v.id, productId: v.productId, name: p?.name ?? { en: v.sku, ar: v.sku, ku: v.sku }, brand: p?.brand ?? '', label: v.label, sku: v.sku, barcode: v.barcode,
        qty: l.qty, unitPriceIQD: unitPrice(v, cart.priceList, currency, rate), unitCostIQD: 0, discountPct: 0, discountIQD: line.discount, lineTotalIQD: line.net, returnedQty: 0,
      })
      await ddb.stock.put({ variantId: v.id, qty: inShop - l.qty })
    }
    const payments: Payment[] = []
    if (paid > 0) {
      payments.push(currency === 'USD'
        ? { method: 'cash_usd', amountIQD: paid, tendered: paidUSD, currency: 'USD', rate, reference: '' }
        : { method: 'cash_iqd', amountIQD: paid, tendered: paid, currency: 'IQD', rate, reference: '' })
    }
    if (due > 0) payments.push({ method: 'debt', amountIQD: due, tendered: due, currency: 'IQD', rate, reference: '' })
    if (customer && due > 0) await ddb.customers.update(customer.id, { balanceIQD: customer.balanceIQD + due, updatedAt: Date.now() })
    const seq = await nextCounter(`sale:${meta.deviceCode}`)
    sale = {
      id: uuid(), number: `${meta.deviceCode || 'DL'}-${String(seq).padStart(6, '0')}`, shiftId: null, userId: actor.id, userName: actor.name,
      customerId: customer?.id ?? null, customerName: customer?.name ?? '', channel: 'delegate', status: 'completed', items,
      subtotalIQD: priced.subtotal, itemDiscountIQD: priced.itemDiscount, orderDiscountIQD: priced.orderDiscount,
      orderDiscount: cart.discountPct > 0 ? { type: 'pct', value: cart.discountPct } : null,
      giftWrapIQD: 0, taxIQD: priced.tax, roundingIQD: priced.rounding, pointsRedeemedIQD: 0, totalIQD: priced.total, payments,
      paidIQD: paid, changeIQD: 0, dueIQD: due, pointsEarned: 0, pointsRedeemed: 0, exchangeRate: rate, currency, note: cart.note.trim(),
      lat: position?.lat ?? null, lng: position?.lng ?? null, accuracyM: position?.accuracyM ?? null,
      approvedBy: null, deviceId: meta.deviceId, createdAt: Date.now(), voidedAt: null, voidReason: '',
    }
    await ddb.sales.add(sale)
    await queue('sale', sale.id)
  })
  // a sale at a shop is also a visit (with GPS when available) — logged in the background; never fails the sale
  if (customer) logVisit(customer, 'sale', '', position ?? undefined).catch(() => undefined)
  return sale
}

/* ───────── customers ───────── */

/** A debt payment. `amount` is in dinars — or in dollars for `cash_usd` (converted at the shop's rate; the balance stays IQD). */
export async function collect(customerId: string, amount: number, method: PaymentMethod, note: string): Promise<Collection> {
  const actor = need('customers.collect')
  const c = await ddb.customers.get(customerId)
  if (!c) throw new AppError('not_found')
  const usd = method === 'cash_usd'
  const { rate } = await currencySettings()
  const tendered = usd ? cents(amount) : Math.round(amount)
  if (!(tendered > 0)) throw new AppError('invalid_amount')
  let amountIQD = usd ? usdToIqd(tendered, rate) : tendered
  // paying the whole debt in dollars: the cents never land exactly on the dinar — settle it in full
  if (usd && Math.abs(amountIQD - c.balanceIQD) < rate / 100) amountIQD = c.balanceIQD
  if (amountIQD > c.balanceIQD) throw new AppError('overpayment', { balance: c.balanceIQD })
  const row: Collection = {
    id: uuid(), customerId, amountIQD, method, shiftId: null, userId: actor.id, note: note.trim(), createdAt: Date.now(),
    tendered, currency: usd ? 'USD' : 'IQD', ...(usd ? { rate } : {}),
  }
  await ddb.transaction('rw', [ddb.collections, ddb.customers, ddb.outbox], async () => {
    await ddb.collections.add(row)
    await ddb.customers.update(customerId, { balanceIQD: c.balanceIQD - amountIQD, updatedAt: Date.now() })
    await queue('collection', row.id)
  })
  logVisit(c, 'collection', '').catch(() => undefined)
  return row
}

export interface NewCustomer { name: string; phone: string; type: CustomerType; city: string; notes: string; position: Position | null }

export async function addCustomer(input: NewCustomer): Promise<Customer> {
  need('customers.create')
  const name = input.name.trim()
  if (!name) throw new AppError('required_fields')
  const phone = input.phone.trim()
  if (phone && (await ddb.customers.where('phone').equals(phone).toArray()).some((c) => c.active)) throw new AppError('phone_taken', { name })
  const now = Date.now()
  const meta = await getMeta()
  const c: Customer = {
    id: uuid(), name, phone, type: input.type, city: input.city.trim(), notes: input.notes.trim(), balanceIQD: 0,
    creditLimitIQD: meta.settings?.sales.defaultCustomerCreditIQD ?? 0, points: 0, active: true, createdAt: now, updatedAt: now,
    lat: input.position?.lat ?? null, lng: input.position?.lng ?? null,
  }
  await ddb.customers.add(c)
  await queue('customer', c.id)
  return c
}

/* ───────── visits ───────── */

async function logVisit(c: Customer | null, outcome: VisitOutcome, note: string, pos?: Position | null): Promise<Visit> {
  const actor = requireActor()
  const p = pos === undefined ? await getPosition(4000) : pos
  const v: Visit = {
    id: uuid(), userId: actor.id, customerId: c?.id ?? null, customerName: c?.name ?? '', lat: p?.lat ?? null, lng: p?.lng ?? null,
    accuracyM: p?.accuracyM ?? null, outcome, note: note.trim(), createdAt: Date.now(),
  }
  await ddb.visits.add(v)
  await queue('visit', v.id)
  // remember where the shop is (first good fix), so it shows on the map and in "nearest" lists
  if (c && p && p.accuracyM <= 100 && c.lat == null) await ddb.customers.update(c.id, { lat: p.lat, lng: p.lng })
  return v
}

export async function checkIn(customerId: string | null, outcome: VisitOutcome, note: string): Promise<Visit> {
  need('delegate.visit')
  const c = customerId ? (await ddb.customers.get(customerId)) ?? null : null
  return logVisit(c, outcome, note)
}

/* ───────── stock requests ───────── */

export async function requestStock(items: { variantId: string; qty: number }[], note: string): Promise<StockRequest> {
  const actor = need('delegate.request_stock')
  const clean = items.filter((i) => Number.isInteger(i.qty) && i.qty > 0)
  if (!clean.length) throw new AppError('invalid_quantity')
  const r: StockRequest = { id: uuid(), userId: actor.id, items: clean, note: note.trim(), status: 'open', createdAt: Date.now() }
  await ddb.requests.add(r)
  await queue('stock_request', r.id)
  return r
}

/* ───────── my day & daily closing ───────── */

export const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const dayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() }

/** Today's numbers from what is on the phone (the server recomputes them when the closing is sent). */
export async function myDay() {
  const actor = requireActor()
  const from = dayStart()
  const sales = (await ddb.sales.where('createdAt').aboveOrEqual(from).toArray()).filter((s) => s.userId === actor.id && s.status !== 'voided')
  const collections = (await ddb.collections.where('createdAt').aboveOrEqual(from).toArray()).filter((c) => c.userId === actor.id)
  const visits = (await ddb.visits.where('createdAt').aboveOrEqual(from).toArray()).filter((v) => v.userId === actor.id)
  const pays = sales.flatMap((s) => s.payments)
  const cashSales = pays.filter((p) => p.method === 'cash_iqd' || p.method === 'cash_usd').reduce((x, p) => x + p.amountIQD, 0)
  // dinar notes and dollar notes are two separate piles of cash
  const iqdIn = pays.filter((p) => p.method === 'cash_iqd').reduce((x, p) => x + p.amountIQD, 0) + collections.filter((c) => c.method === 'cash_iqd').reduce((a, c) => a + c.amountIQD, 0)
  const usdSales = cents(pays.filter((p) => p.method === 'cash_usd').reduce((x, p) => x + p.tendered, 0))
  const usdCollections = cents(collections.filter((c) => c.method === 'cash_usd').reduce((a, c) => a + (c.tendered ?? 0), 0))
  return {
    sales, salesIQD: sales.reduce((a, s) => a + s.totalIQD, 0), cashSalesIQD: cashSales, creditSalesIQD: sales.reduce((a, s) => a + s.dueIQD, 0),
    collectionsIQD: collections.reduce((a, c) => a + c.amountIQD, 0), cashInHandIQD: iqdIn,
    cashInHandUSD: cents(usdSales + usdCollections), cashSalesUSD: usdSales, collectionsUSD: usdCollections,
    visits: visits.length, visitedCustomers: new Set(visits.map((v) => v.customerId).filter(Boolean)).size,
    // bottles sold today (same as the server's closing figure; the name is from when delegates carried a van)
    vanUnits: sales.reduce((a, s) => a + s.items.reduce((x, i) => x + i.qty, 0), 0),
  }
}

/** Sends the day's closing. Everything recorded today is pushed first, so the server's figures include it. */
export async function submitClosing(input: { countedCashIQD: number; countedCashUSD: number; expensesIQD: number; note: string }): Promise<Closing> {
  const actor = need('delegate.close')
  const d = await myDay()
  const expected = d.cashInHandIQD - Math.max(0, Math.round(input.expensesIQD))
  const countedUSD = Math.max(0, cents(input.countedCashUSD || 0))
  const local: Closing = {
    id: uuid(), userId: actor.id, day: today(), salesCount: d.sales.length, salesIQD: d.salesIQD, cashSalesIQD: d.cashSalesIQD, creditSalesIQD: d.creditSalesIQD,
    collectionsIQD: d.collectionsIQD, expensesIQD: Math.max(0, Math.round(input.expensesIQD)), expectedCashIQD: expected,
    countedCashIQD: Math.max(0, Math.round(input.countedCashIQD)), varianceIQD: Math.round(input.countedCashIQD) - expected, vanUnits: d.vanUnits,
    visits: d.visits, note: input.note.trim(), status: 'pending', reviewNote: '', createdAt: Date.now(),
    cashSalesUSD: d.cashSalesUSD, collectionsUSD: d.collectionsUSD, expectedCashUSD: d.cashInHandUSD, countedCashUSD: countedUSD, varianceUSD: cents(countedUSD - d.cashInHandUSD),
  }
  try {
    await push()
    const r = await api<{ closing: Closing }>('POST', '/delegate-closings', { id: local.id, day: local.day, countedCashIQD: local.countedCashIQD, countedCashUSD: countedUSD, expensesIQD: local.expensesIQD, note: local.note })
    const saved = { ...r.closing, reviewNote: r.closing.reviewNote ?? '' }
    await ddb.closings.where('day').equals(local.day).delete()
    await ddb.closings.put(saved)
    return saved
  } catch (e) {
    if (!isOfflineError(e)) throw e
    // no signal: keep it here; it is sent (after today's sales) with the next sync
    await ddb.closings.put(local)
    await queue('closing', local.id)
    return local
  }
}
