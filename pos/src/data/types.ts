/**
 * Domain model for the Store POS.
 *
 * These shapes mirror the tables the Laravel backend will expose (see the build
 * brief §5), so the local IndexedDB store and the server can exchange the same
 * JSON. Rules that never change:
 *  - every record has a client-generated UUID `id` (offline sync can never duplicate)
 *  - money is stored as integer IQD; USD is only ever a *tender* recorded with the
 *    exchange rate used at the time of sale
 *  - timestamps are epoch milliseconds
 */

export type ID = string
export type Lang = 'en' | 'ar' | 'ku'
export type I18nText = Record<Lang, string>
export type AppKey = 'pos' | 'admin' | 'delegate'

/* ───────── users, roles, permissions ───────── */

export interface Role {
  id: ID
  key: string // stable machine key: super_admin, manager, cashier, …
  name: string
  description: string
  permissions: string[] // '*' = everything
  apps: AppKey[] // which client apps this role may sign in to
  isSystem: boolean // system roles can't be deleted; super_admin can't be edited
  createdAt: number
  updatedAt: number
}

export interface UserLimits {
  maxDiscountPct: number // above this needs manager approval
  maxRefundIQD: number // above this needs manager approval
}

export interface User {
  id: ID
  name: string
  username: string
  roleId: ID
  active: boolean
  color: string // avatar colour
  pinHash: string
  pinSalt: string
  passwordHash: string | null
  passwordSalt: string | null
  /** Per-user overrides on top of the role: extra grants and explicit denies. */
  grants: string[]
  denies: string[]
  limits: UserLimits
  failedAttempts: number
  lockedUntil: number | null
  lastLoginAt: number | null
  createdAt: number
  updatedAt: number
  createdBy: ID | null
}

/** What the UI/services need to know about whoever is signed in. */
export interface Actor {
  id: ID
  name: string
  username: string
  roleId: ID
  roleKey: string
  roleName: string
  color: string
  permissions: string[]
  limits: UserLimits
  isSuperAdmin: boolean
}

/* ───────── catalog ───────── */

export type Gender = 'men' | 'women' | 'unisex'
export type BottleShape = 'rect' | 'tall' | 'round' | 'flask'

export interface Product {
  id: ID
  name: I18nText
  description: I18nText
  brand: string
  category: string // perfume | oud | mist | oil | set | home
  gender: Gender
  concentration: string // EDP | EDT | Parfum | Extrait | Oil | Mist
  scentFamilies: string[]
  notes: { top: string[]; heart: string[]; base: string[] }
  season: 'all' | 'winter' | 'summer'
  longevity: number // 1–5
  sillage: number // 1–5
  image: string | null // data URL (resized) — falls back to generated bottle art
  art: { c1: string; c2: string; shape: BottleShape }
  showOnMenu: boolean
  featured: boolean
  isNew: boolean
  active: boolean
  createdAt: number
  updatedAt: number
}

/** How a bottle's size is measured: millilitres or (fluid) ounces. */
export type SizeUnit = 'ml' | 'oz'

export interface Variant {
  id: ID
  productId: ID
  label: string // what the cashier and the receipt show — "100 ml", "3.4 oz" (auto-filled from size + unit, editable)
  size: number // as printed on the bottle, may have decimals (3.4)
  unit: SizeUnit
  ml: number // size normalised to whole millilitres — used for sorting and reports, never typed by hand
  sku: string
  barcode: string
  costIQD: number
  retailIQD: number
  wholesaleIQD: number
  minStock: number
  isTester: boolean
  active: boolean
}

export interface StockRow {
  variantId: ID
  locationId: ID
  qty: number
}

export type MovementType =
  | 'purchase'
  | 'sale'
  | 'return'
  | 'void'
  | 'adjustment'
  | 'damage'
  | 'tester'
  | 'count'
  | 'transfer_in'
  | 'transfer_out'
  | 'opening'

export interface StockMovement {
  id: ID
  variantId: ID
  locationId: ID
  type: MovementType
  qty: number // signed: + adds to stock, − removes
  balanceAfter: number
  refType: string | null
  refId: ID | null
  note: string
  userId: ID
  createdAt: number
}

export interface StockCountLine {
  variantId: ID
  expected: number
  counted: number
}
export interface StockCount {
  id: ID
  locationId: ID
  lines: StockCountLine[]
  note: string
  userId: ID
  createdAt: number
}

/* ───────── customers ───────── */

export type CustomerType = 'retail' | 'shop' | 'wholesale'

export interface Customer {
  id: ID
  name: string
  phone: string
  type: CustomerType
  city: string
  notes: string
  balanceIQD: number // > 0 means the customer owes us
  creditLimitIQD: number
  /** map position (set by a delegate's GPS); absent for shops nobody has pinned yet */
  lat?: number | null
  lng?: number | null
  points: number
  active: boolean
  createdAt: number
  updatedAt: number
}

export interface Collection {
  id: ID
  customerId: ID
  /** taken off the customer's balance (balances are always IQD) */
  amountIQD: number
  method: PaymentMethod
  /** what was handed over, in `currency` — set for dollar collections (`cash_usd`) */
  tendered?: number
  currency?: 'IQD' | 'USD'
  rate?: number | null
  shiftId: ID | null
  userId: ID
  note: string
  createdAt: number
}

/* ───────── sales ───────── */

export type PaymentMethod =
  | 'cash_iqd'
  | 'cash_usd'
  | 'card'
  | 'fib'
  | 'zain'
  | 'debt'
  | 'return_credit'

export interface Payment {
  method: PaymentMethod
  /** value applied to the bill, in IQD */
  amountIQD: number
  /** what the customer actually handed over, in `currency` */
  tendered: number
  currency: 'IQD' | 'USD'
  rate: number // IQD per USD at the time
  reference: string // card slip / FIB / Zain reference, optional
}

export interface SaleItem {
  variantId: ID
  productId: ID
  name: I18nText
  brand: string
  label: string
  sku: string
  barcode: string
  qty: number
  unitPriceIQD: number
  unitCostIQD: number
  discountPct: number
  discountIQD: number
  lineTotalIQD: number
  returnedQty: number
}

export type SaleStatus = 'completed' | 'voided' | 'partially_returned' | 'returned'

export interface Sale {
  id: ID
  number: string
  shiftId: ID | null
  userId: ID
  userName: string
  customerId: ID | null
  customerName: string
  /** store = sold at a POS till; delegate = sold from a delegate's van */
  channel: 'store' | 'delegate'
  /** where the stock came from: the shop, or a van (server-assigned) */
  locationId?: string
  status: SaleStatus
  items: SaleItem[]
  subtotalIQD: number
  itemDiscountIQD: number
  orderDiscountIQD: number
  orderDiscount: { type: 'pct' | 'fixed'; value: number } | null
  giftWrapIQD: number
  taxIQD: number
  roundingIQD: number
  pointsRedeemedIQD: number
  totalIQD: number
  payments: Payment[]
  paidIQD: number // sum of non-debt payments
  changeIQD: number
  dueIQD: number // put on customer's account
  pointsEarned: number
  pointsRedeemed: number
  exchangeRate: number
  /** the currency the bill was shown in on a delegate phone (amounts are still stored in IQD) */
  currency?: 'IQD' | 'USD'
  /** where a delegate's phone was when the bill was finished (no GPS: null) */
  lat?: number | null
  lng?: number | null
  accuracyM?: number | null
  note: string
  approvedBy: ID | null
  deviceId: ID
  createdAt: number
  voidedAt: number | null
  voidReason: string
}

export interface ReturnItem {
  saleItemIndex: number
  variantId: ID
  productId: ID
  name: I18nText
  label: string
  qty: number
  unitNetIQD: number // refund value per unit (after discounts)
  restock: boolean
  reason: string
}

export interface SaleReturn {
  id: ID
  number: string
  saleId: ID
  saleNumber: string
  shiftId: ID | null
  userId: ID
  userName: string
  items: ReturnItem[]
  refundIQD: number
  refundMethod: 'cash_iqd' | 'card' | 'fib' | 'zain' | 'store_credit' | 'debt_reduction'
  note: string
  approvedBy: ID | null
  createdAt: number
}

/* ───────── shifts ───────── */

export interface CashMovement {
  id: ID
  type: 'in' | 'out'
  amountIQD: number
  reason: string
  userId: ID
  createdAt: number
}

export interface ShiftTotals {
  salesCount: number
  salesIQD: number
  byMethod: Record<string, number> // IQD-equivalent per payment method
  cashIQD: number
  cashUSD: number // USD notes that came in (in dollars)
  refundsIQD: number
  collectionsIQD: number
  cashInIQD: number
  cashOutIQD: number
  expectedIQD: number
  expectedUSD: number
}

export interface Shift {
  id: ID
  userId: ID
  userName: string
  deviceId: ID
  status: 'open' | 'closed'
  openedAt: number
  closedAt: number | null
  openingIQD: number
  openingUSD: number
  movements: CashMovement[]
  countedIQD: number | null
  countedUSD: number | null
  varianceIQD: number | null
  totals: ShiftTotals | null // frozen at close (Z report)
  note: string
}

/* ───────── misc ───────── */

export interface CartSnapshotLine {
  variantId: ID
  qty: number
  discountPct: number
}
export interface Hold {
  id: ID
  userId: ID
  customerId: ID | null
  lines: CartSnapshotLine[]
  orderDiscount: { type: 'pct' | 'fixed'; value: number } | null
  giftWrap: boolean
  note: string
  label: string
  createdAt: number
}

export interface AuditEntry {
  id: ID
  userId: ID
  userName: string
  action: string // e.g. user.create, sale.void, settings.update
  entity: string
  entityId: string
  meta: Record<string, unknown>
  createdAt: number
}

export interface OutboxItem {
  id: ID
  entity: 'sale' | 'return' | 'shift' | 'collection' | 'customer' | 'stock_movement'
  entityId: ID
  status: 'pending' | 'sent' | 'failed'
  attempts: number
  createdAt: number
  lastError: string
}

/**
 * Connected mode: what this till remembers about someone who signed in on it online, so the same person can PIN-in
 * again while the internet is down. The hashes are made here, on this device, from the PIN/password they typed —
 * the server never sends credential material.
 */
export interface CachedCredential {
  userId: ID
  actor: Actor
  token: string | null
  pinHash: string | null
  pinSalt: string | null
  passwordHash: string | null
  passwordSalt: string | null
  failedAttempts: number
  lockedUntil: number | null
  updatedAt: number
}

export interface Device {
  id: ID
  name: string
  code: string // short prefix used in document numbers, e.g. "ST1"
  registeredAt: number
  revoked: boolean
}

export interface Counter {
  key: string
  value: number
}

export interface AppSettings {
  key: 'app'
  setupDone: boolean
  store: { name: string; tagline: string; address: string; phone: string; city: string }
  receipt: {
    header: string
    footer: I18nText
    showLogo: boolean
    showQr: boolean
    qrUrl: string
    paperMm: 58 | 80
    autoPrint: boolean
    copies: number
  }
  currency: { rate: number; rounding: 0 | 250 | 500 | 1000; usdEnabled: boolean }
  tax: { pct: number }
  loyalty: { enabled: boolean; pointsPer1000IQD: number; pointValueIQD: number }
  sales: {
    requireShift: boolean
    allowNegativeStock: boolean
    giftWrapFeeIQD: number
    defaultCustomerCreditIQD: number
    returnWindowDays: number
  }
  security: { autoLockMinutes: number; maxFailedAttempts: number; lockoutSeconds: number }
  /** The customer menu (set in the admin panel; a till in local mode has none). */
  menu?: { showPrices: boolean; hideSoldOut: boolean; whatsapp: string }
  device: { id: ID; code: string; name: string; locationId: ID }
  /** `server` = connected to the Lattafa API on this domain; `lastPullAt` = server time of the last successful pull. */
  sync: { mode: 'local' | 'server'; serverUrl: string; lastPullAt: number }
}

export const STORE_LOCATION_ID = 'loc-store'
