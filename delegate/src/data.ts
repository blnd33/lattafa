/**
 * The delegate phone's own offline database. Everything the delegate does in the field is written here first, queued
 * in the outbox, and sent to the server when there is signal — exactly like the POS tills.
 */
import Dexie, { type Table } from 'dexie'
import { uuid } from '@/lib/id'
import type { Actor, AppSettings, CachedCredential, Collection, Counter, Customer, Product, Role, Sale, User, Variant } from '@/data/types'

/** Shop settings as the server sends them (no device/sync block — this phone keeps its own in `meta`). */
export type ShopSettings = Omit<AppSettings, 'key' | 'device' | 'sync'>

export interface Meta {
  key: 'app'
  deviceId: string
  deviceCode: string
  deviceName: string
  /** server time of the last successful pull, and whose van it carried */
  lastPullAt: number
  pulledFor: string | null
  settings: ShopSettings | null
}

/** One line of this delegate's van stock (no longer used: delegates sell the shop's stock — see `stock`). */
export interface VanRow { variantId: string; qty: number }

/** How many of a size the shop has, as of the last sync, less what this phone sold since. */
export interface StockRow { variantId: string; qty: number }

export type VisitOutcome = 'visit' | 'sale' | 'collection' | 'no_sale' | 'closed'
export interface Visit {
  id: string
  userId: string
  customerId: string | null
  customerName: string
  lat: number | null
  lng: number | null
  accuracyM: number | null
  outcome: VisitOutcome
  note: string
  createdAt: number
}

export interface StockRequest {
  id: string
  userId: string
  items: { variantId: string; qty: number }[]
  note: string
  status: 'open' | 'fulfilled' | 'cancelled'
  createdAt: number
}

export interface Closing {
  id: string
  userId: string
  day: string
  salesCount: number
  salesIQD: number
  cashSalesIQD: number
  creditSalesIQD: number
  collectionsIQD: number
  expensesIQD: number
  expectedCashIQD: number
  countedCashIQD: number
  varianceIQD: number
  /** dollar notes are counted on their own (older rows have none) */
  cashSalesUSD?: number
  collectionsUSD?: number
  expectedCashUSD?: number
  countedCashUSD?: number
  varianceUSD?: number
  vanUnits: number
  visits: number
  note: string
  /** `pending` = recorded on the phone, not on the server yet */
  status: 'pending' | 'submitted' | 'approved' | 'rejected'
  reviewNote: string
  createdAt: number
}

/** A live-location point waiting to be sent (see tracker.ts). Kept per person, so a shared phone never mixes them up. */
export interface TrailPoint { id?: number; userId: string; lat: number; lng: number; accuracyM: number | null; at: number }

/** One lot of stock a delegate put into their own van. Sent as a `stock_movement`; the server puts it in the van. */
export interface StockMovementRow {
  id: string
  variantId: string
  qty: number
  type: 'purchase'
  userId: string
  note: string
  createdAt: number
}

export type OutboxEntity = 'sale' | 'collection' | 'customer' | 'visit' | 'stock_request' | 'closing' | 'stock_movement'
export interface OutboxRow {
  id: string
  entity: OutboxEntity
  entityId: string
  status: 'pending' | 'failed'
  attempts: number
  createdAt: number
  lastError: string
}

export class DelegateDB extends Dexie {
  meta!: Table<Meta, string>
  roles!: Table<Role, string>
  users!: Table<User, string>
  products!: Table<Product, string>
  variants!: Table<Variant, string>
  van!: Table<VanRow, string>
  stock!: Table<StockRow, string>
  customers!: Table<Customer, string>
  sales!: Table<Sale, string>
  collections!: Table<Collection, string>
  visits!: Table<Visit, string>
  requests!: Table<StockRequest, string>
  closings!: Table<Closing, string>
  outbox!: Table<OutboxRow, string>
  creds!: Table<CachedCredential, string>
  counters!: Table<Counter, string>
  trail!: Table<TrailPoint, number>
  /** this delegate's own selling price per size, in whole US cents */
  prices!: Table<{ variantId: string; cents: number }, string>
  /** stock this delegate added to their own van, waiting to be sent (and kept afterwards as their own record) */
  movements!: Table<StockMovementRow, string>

  constructor(name = 'lattafa-delegate') {
    super(name)
    this.version(1).stores({
      meta: 'key',
      roles: 'id',
      users: 'id',
      products: 'id',
      variants: 'id, productId, barcode, sku',
      van: 'variantId',
      customers: 'id, name, phone',
      sales: 'id, &number, createdAt, customerId, userId',
      collections: 'id, customerId, createdAt, userId',
      visits: 'id, createdAt, customerId, userId',
      requests: 'id, createdAt, status',
      closings: 'id, day',
      outbox: 'id, status, entity, createdAt',
      creds: 'userId',
      counters: 'key',
    })
    // v2: live location — points waiting to be sent
    this.version(2).stores({ trail: '++id, userId, at' })
    // v3: delegates sell the shop's own stock — its numbers come with every product; the next sync fetches them all
    this.version(3).stores({ stock: 'variantId' }).upgrade((tx) => tx.table('meta').toCollection().modify({ lastPullAt: 0 }))
    // v4: a delegate carries their own van and their own prices; both arrive with the next full pull
    this.version(4).stores({ prices: 'variantId' }).upgrade((tx) => tx.table('meta').toCollection().modify({ lastPullAt: 0 }))
    // v5: a delegate can stock their own van, so the phone keeps the movements it queued
    this.version(5).stores({ movements: 'id, createdAt' })
  }
}

export const ddb = new DelegateDB()

export async function getMeta(): Promise<Meta> {
  const m = await ddb.meta.get('app')
  if (m) return m
  const fresh: Meta = { key: 'app', deviceId: uuid(), deviceCode: '', deviceName: '', lastPullAt: 0, pulledFor: null, settings: null }
  await ddb.meta.put(fresh)
  return fresh
}

export async function patchMeta(patch: Partial<Meta>): Promise<Meta> {
  const next = { ...(await getMeta()), ...patch, key: 'app' as const }
  await ddb.meta.put(next)
  return next
}

/** Gap-free per-phone counters (receipt numbers). */
export async function nextCounter(key: string): Promise<number> {
  const row = await ddb.counters.get(key)
  const value = (row?.value ?? 0) + 1
  await ddb.counters.put({ key, value })
  return value
}

export type { Actor }
