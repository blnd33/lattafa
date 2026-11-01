import Dexie, { type Table } from 'dexie'
import { DB_NAME } from './app'
import type {
  AppSettings, AuditEntry, CachedCredential, Collection, Counter, Customer, Device, Hold, OutboxItem, Product, Role,
  Sale, SaleReturn, Shift, StockCount, StockMovement, StockRow, User, Variant,
} from './types'

/**
 * Offline-first store. The POS reads and writes this database directly, so every
 * screen keeps working with no internet. When the Laravel backend is connected,
 * the sync module pulls catalogue/users/prices into these tables and pushes the
 * `outbox` (sales, returns, shifts…) up.
 */
export class PosDB extends Dexie {
  users!: Table<User, string>
  roles!: Table<Role, string>
  products!: Table<Product, string>
  variants!: Table<Variant, string>
  stock!: Table<StockRow, [string, string]>
  stockMovements!: Table<StockMovement, string>
  stockCounts!: Table<StockCount, string>
  customers!: Table<Customer, string>
  collections!: Table<Collection, string>
  sales!: Table<Sale, string>
  returns!: Table<SaleReturn, string>
  shifts!: Table<Shift, string>
  holds!: Table<Hold, string>
  settings!: Table<AppSettings, string>
  audit!: Table<AuditEntry, string>
  outbox!: Table<OutboxItem, string>
  devices!: Table<Device, string>
  counters!: Table<Counter, string>
  creds!: Table<CachedCredential, string>

  constructor(name = 'lattafa-pos') {
    super(name)
    this.version(1).stores({
      users: 'id, &username, roleId, active',
      roles: 'id, &key',
      products: 'id, brand, gender, category, active, updatedAt',
      variants: 'id, productId, &sku, barcode, active',
      stock: '[variantId+locationId], variantId, locationId',
      stockMovements: 'id, variantId, type, refId, createdAt',
      stockCounts: 'id, createdAt',
      customers: 'id, phone, name, type, active',
      collections: 'id, customerId, shiftId, createdAt',
      sales: 'id, &number, shiftId, userId, customerId, status, createdAt',
      returns: 'id, &number, saleId, shiftId, createdAt',
      shifts: 'id, userId, status, openedAt',
      holds: 'id, userId, createdAt',
      settings: 'key',
      audit: 'id, userId, action, createdAt',
      outbox: 'id, status, entity, createdAt',
      devices: 'id',
      counters: 'key',
    })
    // v2: sizes can be measured in ml or oz. Existing bottles were all millilitres.
    this.version(2).stores({}).upgrade((tx) => backfillSizes(tx.table('variants')))
    // v3: connected mode — remembered sign-ins for offline PIN login on this till
    this.version(3).stores({ creds: 'userId' })
  }
}

/** Variants saved before units existed (or restored from an old backup) are millilitre sizes. */
export async function backfillSizes(variants: Table<Variant, string>): Promise<void> {
  await variants.toCollection().modify((v) => {
    if (v.unit !== 'ml' && v.unit !== 'oz') {
      v.unit = 'ml'
      v.size = v.ml ?? 0
    }
  })
}

export const db = new PosDB(DB_NAME)

/** Every table name — used by backup / restore / wipe. */
export const TABLE_NAMES = [
  'users', 'roles', 'products', 'variants', 'stock', 'stockMovements', 'stockCounts', 'customers',
  'collections', 'sales', 'returns', 'shifts', 'holds', 'settings', 'audit', 'outbox', 'devices', 'counters', 'creds',
] as const

/** Atomic, gap-free-per-device document counters (sale numbers, return numbers…). */
export async function nextCounter(key: string): Promise<number> {
  const row = await db.counters.get(key)
  const value = (row?.value ?? 0) + 1
  await db.counters.put({ key, value })
  return value
}
