/**
 * Connected mode: this till's local copy of the server's data.
 *
 * `applyPull` writes what `GET /sync/pull` returned into IndexedDB. Selling, the PIN screen, the catalogue and the
 * customer list all read this mirror, so they keep working when the internet drops. Anything this till recorded but
 * has not pushed yet (still in the outbox) is re-applied on top of the server's numbers, so stock and balances never
 * jump back while a sale is waiting to be sent.
 */
import { db } from '@/data/db'
import {
  STORE_LOCATION_ID, type AppSettings, type Device, type Role, type Sale, type SaleReturn,
} from '@/data/types'
import { uuid } from '@/lib/id'
import { DEFAULT_SETTINGS, getSettings } from './settings'

export { splitProduct, userFromServer } from './serverShapes'
export type { PullPayload, ServerDevice, ServerProduct, ServerSettings, ServerUser, ServerVariant } from './serverShapes'
import type { PullPayload, ServerDevice, ServerSettings } from './serverShapes'
import { splitProduct, userFromServer } from './serverShapes'

/** Local settings = the server's shop settings + this till's own device/sync block. */
function mergeSettings(cur: AppSettings, server: ServerSettings, device: ServerDevice | null, serverTime: number): AppSettings {
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    ...cur,
    ...server,
    key: 'app',
    setupDone: true,
    device: device ? { ...cur.device, id: device.id, code: device.code, name: device.name } : cur.device,
    sync: { ...cur.sync, mode: 'server', lastPullAt: serverTime },
  }
}

/** What this till recorded that the server hasn't confirmed yet (re-applied over pulled stock and balances). */
async function pendingEffects(): Promise<{ stock: Map<string, number>; balance: Map<string, number> }> {
  const stock = new Map<string, number>()
  const balance = new Map<string, number>()
  const add = (m: Map<string, number>, k: string, d: number) => m.set(k, (m.get(k) ?? 0) + d)
  const rows = await db.outbox.where('status').anyOf('pending', 'failed').toArray()
  const ids = (entity: string) => [...new Set(rows.filter((r) => r.entity === entity).map((r) => r.entityId))]

  const sales = (await db.sales.bulkGet(ids('sale'))).filter((s): s is Sale => !!s && s.status !== 'voided')
  for (const s of sales) {
    for (const it of s.items) add(stock, it.variantId, -it.qty)
    if (s.customerId && s.dueIQD) add(balance, s.customerId, s.dueIQD)
  }
  const returns = (await db.returns.bulkGet(ids('return'))).filter((r): r is SaleReturn => !!r)
  for (const r of returns) for (const it of r.items) if (it.restock) add(stock, it.variantId, it.qty)
  const collections = (await db.collections.bulkGet(ids('collection'))).filter((c) => !!c)
  for (const c of collections) add(balance, c!.customerId, -c!.amountIQD)
  return { stock, balance }
}

/** Customers created on this till offline and not on the server yet — a full pull must not delete them. */
async function pendingCustomerIds(): Promise<Set<string>> {
  const rows = await db.outbox.where('entity').equals('customer').toArray()
  return new Set(rows.filter((r) => r.status !== 'sent').map((r) => r.entityId))
}

export async function applyPull(p: PullPayload): Promise<void> {
  const full = !p.since
  const effects = await pendingEffects()
  const keepCustomers = full ? await pendingCustomerIds() : new Set<string>()

  await db.transaction('rw', [db.settings, db.roles, db.users, db.products, db.variants, db.stock, db.customers, db.devices, db.counters, db.creds], async () => {
    const cur = await getSettings()
    const settings = mergeSettings(cur, p.settings, p.device, p.serverTime)
    await db.settings.put(settings)

    // roles & accounts (always a complete list)
    await db.roles.clear()
    await db.roles.bulkPut(p.roles.map((r) => { const { userCount: _c, ...role } = r as Role & { userCount?: number }; void _c; return role }))
    await db.users.clear()
    await db.users.bulkPut(p.users.map(userFromServer))
    // people deleted on the server can't PIN-in offline any more either
    const gone = new Set(p.deleted.users)
    for (const u of p.users) if (!u.active) gone.add(u.id)
    if (gone.size) await db.creds.bulkDelete([...gone])

    // catalogue + stock
    if (full) { await db.products.clear(); await db.variants.clear(); await db.stock.where('locationId').equals(STORE_LOCATION_ID).delete() }
    // deleted first: a product added again with the same SKU must not collide with the row it replaces
    for (const id of p.deleted.products) {
      const vids = (await db.variants.where('productId').equals(id).toArray()).map((v) => v.id)
      await db.stock.where('variantId').anyOf(vids).delete()
      await db.variants.bulkDelete(vids)
      await db.products.delete(id)
    }
    for (const sp of p.products) {
      const { product, variants, stock } = splitProduct(sp)
      await db.products.put(product)
      await db.variants.bulkPut(variants)
      await db.stock.bulkPut(variants.map((v) => ({ variantId: v.id, locationId: STORE_LOCATION_ID, qty: (stock[v.id] ?? 0) + (effects.stock.get(v.id) ?? 0) })))
    }

    // customers (balances are the server's, plus whatever is still waiting to be pushed)
    if (full) {
      const stale = (await db.customers.toArray()).filter((c) => !keepCustomers.has(c.id)).map((c) => c.id)
      await db.customers.bulkDelete(stale)
    }
    await db.customers.bulkPut(p.customers.map((c) => ({ ...c, balanceIQD: Math.max(0, c.balanceIQD + (effects.balance.get(c.id) ?? 0)) })))

    // this till: code + never reuse a receipt number the server already has
    if (p.device) {
      const d: Device = { id: p.device.id, name: p.device.name, code: p.device.code, registeredAt: p.device.registeredAt, revoked: p.device.revoked }
      await db.devices.put(d)
    }
    if (p.device && p.counters) {
      for (const [kind, used] of [['sale', p.counters.sale], ['return', p.counters.return]] as const) {
        const key = `${kind}:${p.device.code}`
        const row = await db.counters.get(key)
        if ((row?.value ?? 0) < used) await db.counters.put({ key, value: used })
      }
    }
  })
}

/**
 * First connection of a till that used to run on its own: its local test data has no place on the server, so the
 * mirror starts empty. (The person is warned and offered a backup before this runs.)
 */
export async function resetForServer(): Promise<void> {
  const keep = await getSettings()
  await db.transaction('rw', db.tables, async () => {
    for (const t of db.tables) await t.clear()
    await db.settings.put({
      ...structuredClone(DEFAULT_SETTINGS),
      setupDone: false,
      device: { ...DEFAULT_SETTINGS.device, id: keep.device.id || uuid(), name: keep.device.name || DEFAULT_SETTINGS.device.name },
      sync: { mode: 'server', serverUrl: '', lastPullAt: 0 },
    })
  })
}

/** A sale fetched from the server (another till's, or older than this mirror) kept locally — e.g. so it can be returned. */
export async function cacheServerSale(s: Sale): Promise<void> {
  await db.sales.put(s)
}
