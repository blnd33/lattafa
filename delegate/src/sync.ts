/**
 * Delegate phone ⇄ server. Same protocol as the POS tills: push the outbox (oldest first, every record with its own
 * UUID, so retries never duplicate), then pull what changed. The pull also carries this delegate's van, stock
 * requests and recent closings. Anything not yet pushed is re-applied on top, so the van never "refills" by itself.
 */
import type { Customer, Sale } from '@/data/types'
import { uuid } from '@/lib/id'
import { api, getApiToken, isOfflineError } from '@/services/api'
import { splitProduct, userFromServer, type PullPayload } from '@/services/serverShapes'
import { ddb, getMeta, patchMeta, type Closing, type OutboxEntity, type OutboxRow, type StockRequest } from './data'

const TABLE: Record<OutboxEntity, 'sales' | 'collections' | 'customers' | 'visits' | 'requests' | 'closings'> = {
  sale: 'sales', collection: 'collections', customer: 'customers', visit: 'visits', stock_request: 'requests', closing: 'closings',
}

let lastQueuedAt = 0
export async function queue(entity: OutboxEntity, entityId: string): Promise<void> {
  lastQueuedAt = Math.max(Date.now(), lastQueuedAt + 1) // strictly increasing: rows go out in the order they happened
  await ddb.outbox.add({ id: uuid(), entity, entityId, status: 'pending', attempts: 0, createdAt: lastQueuedAt, lastError: '' })
  requestSync()
}

export const pendingCount = () => ddb.outbox.count()
export const failedRows = () => ddb.outbox.where('status').equals('failed').toArray()
export async function isPending(entity: OutboxEntity, id: string): Promise<boolean> {
  return (await ddb.outbox.where('entity').equals(entity).toArray()).some((r) => r.entityId === id)
}

interface PushResult { entity: string; id: string; status: 'ok' | 'duplicate' | 'retry' | 'rejected' | 'error'; code?: string }

export async function push(): Promise<{ pushed: number; failed: number }> {
  const rows = (await ddb.outbox.where('status').equals('pending').toArray()).sort((a, b) => a.createdAt - b.createdAt)
  const order: string[] = []
  const byKey = new Map<string, OutboxRow[]>()
  for (const r of rows) {
    const k = `${r.entity}:${r.entityId}`
    if (!byKey.has(k)) { byKey.set(k, []); order.push(k) }
    byKey.get(k)!.push(r)
  }
  let pushed = 0, failed = 0
  for (let i = 0; i < order.length; i += 100) {
    const items: { entity: string; id: string; data: unknown }[] = []
    for (const k of order.slice(i, i + 100)) {
      const first = byKey.get(k)![0]
      const data = await ddb.table(TABLE[first.entity]).get(first.entityId)
      if (data) items.push({ entity: first.entity, id: first.entityId, data })
      else await ddb.outbox.bulkDelete(byKey.get(k)!.map((r) => r.id))
    }
    if (!items.length) continue
    const res = await api<{ results: PushResult[] }>('POST', '/sync/push', { items }, { timeoutMs: 60_000 })
    for (const r of res.results) {
      const queued = byKey.get(`${r.entity}:${r.id}`) ?? []
      if (r.status === 'ok' || r.status === 'duplicate') { await ddb.outbox.bulkDelete(queued.map((q) => q.id)); pushed++ }
      else if (r.status === 'rejected') { for (const q of queued) await ddb.outbox.update(q.id, { status: 'failed', attempts: q.attempts + 1, lastError: r.code ?? 'rejected' }); failed++ }
      else for (const q of queued) await ddb.outbox.update(q.id, { attempts: q.attempts + 1, lastError: r.code ?? r.status })
    }
  }
  return { pushed, failed }
}

type VanPayload = { locationId: string; stock: Record<string, number>; requests: StockRequest[]; closings: Closing[] } | null
type DelegatePull = PullPayload & { van: VanPayload }

/** Not-yet-pushed sales and collections, re-applied over the server's numbers. */
async function pendingEffects() {
  const rows = await ddb.outbox.toArray()
  const ids = (e: OutboxEntity) => [...new Set(rows.filter((r) => r.entity === e).map((r) => r.entityId))]
  const sold = new Map<string, number>()
  const balance = new Map<string, number>()
  for (const s of (await ddb.sales.bulkGet(ids('sale'))).filter((x): x is Sale => !!x && x.status !== 'voided')) {
    for (const it of s.items) sold.set(it.variantId, (sold.get(it.variantId) ?? 0) - it.qty)
    if (s.customerId && s.dueIQD) balance.set(s.customerId, (balance.get(s.customerId) ?? 0) + s.dueIQD)
  }
  for (const c of (await ddb.collections.bulkGet(ids('collection'))).filter((x) => !!x)) balance.set(c!.customerId, (balance.get(c!.customerId) ?? 0) - c!.amountIQD)
  return { sold, balance, customers: new Set(ids('customer')), requests: new Set(ids('stock_request')), closings: new Set(ids('closing')) }
}

export async function applyPull(p: DelegatePull, forUserId: string | null): Promise<void> {
  const full = !p.since
  const fx = await pendingEffects()
  await ddb.transaction('rw', [ddb.meta, ddb.roles, ddb.users, ddb.products, ddb.variants, ddb.stock, ddb.van, ddb.customers, ddb.requests, ddb.closings, ddb.counters, ddb.creds], async () => {
    const meta = await getMeta()
    await ddb.meta.put({
      ...meta, settings: p.settings, lastPullAt: p.serverTime, pulledFor: forUserId,
      deviceCode: p.device?.code ?? meta.deviceCode, deviceName: p.device?.name ?? meta.deviceName,
    })
    await ddb.roles.clear(); await ddb.roles.bulkPut(p.roles)
    await ddb.users.clear(); await ddb.users.bulkPut(p.users.map(userFromServer))
    const gone = [...p.deleted.users, ...p.users.filter((u) => !u.active).map((u) => u.id)]
    if (gone.length) await ddb.creds.bulkDelete(gone)

    // the shop's stock comes with each product; sales still waiting to be sent are taken off again
    if (full) { await ddb.products.clear(); await ddb.variants.clear(); await ddb.stock.clear() }
    for (const sp of p.products) {
      const { product, variants, stock } = splitProduct(sp)
      await ddb.products.put(product)
      await ddb.variants.bulkPut(variants)
      await ddb.stock.bulkPut(variants.map((v) => ({ variantId: v.id, qty: (stock[v.id] ?? 0) + (fx.sold.get(v.id) ?? 0) })))
    }
    for (const id of p.deleted.products) {
      const vids = (await ddb.variants.where('productId').equals(id).toArray()).map((v) => v.id)
      await ddb.stock.bulkDelete(vids)
      await ddb.variants.bulkDelete(vids)
      await ddb.products.delete(id)
    }

    if (full) {
      const stale = (await ddb.customers.toArray()).filter((c) => !fx.customers.has(c.id)).map((c) => c.id)
      await ddb.customers.bulkDelete(stale)
    }
    await ddb.customers.bulkPut(p.customers.map((c: Customer) => ({ ...c, balanceIQD: Math.max(0, c.balanceIQD + (fx.balance.get(c.id) ?? 0)) })))

    // requests and closings belong to whoever signed in — replace them wholesale (vans are no longer used)
    await ddb.van.clear()
    if (p.van) {
      const localReq = (await ddb.requests.toArray()).filter((r) => fx.requests.has(r.id))
      await ddb.requests.clear(); await ddb.requests.bulkPut([...p.van.requests, ...localReq])
      const localCl = (await ddb.closings.toArray()).filter((c) => fx.closings.has(c.id))
      await ddb.closings.clear(); await ddb.closings.bulkPut([...p.van.closings.map((c) => ({ ...c, reviewNote: c.reviewNote ?? '' })), ...localCl])
    }
    if (p.device && p.counters) {
      const key = `sale:${p.device.code}`
      if (((await ddb.counters.get(key))?.value ?? 0) < p.counters.sale) await ddb.counters.put({ key, value: p.counters.sale })
    }
  })
}

export async function pull(full = false, forUserId: string | null = null): Promise<void> {
  const meta = await getMeta()
  const since = full || meta.pulledFor !== forUserId ? 0 : meta.lastPullAt
  const p = await api<DelegatePull>('GET', `/sync/pull?since=${since}`, undefined, { timeoutMs: 60_000 })
  // same self-repair as the POS mirror: changes that can't be written, or a copy out of step with the server → fetch it all
  try {
    await applyPull(p, forUserId)
  } catch (e) {
    if (!since) throw e
    return pull(true, forUserId)
  }
  if (since && p.catalog && ((await ddb.products.count()) !== p.catalog.products || (await ddb.variants.count()) !== p.catalog.variants)) await pull(true, forUserId)
}

export type SyncResult = { ok: true; pushed: number; failed: number } | { ok: false; reason: 'offline' | 'not_signed_in' | 'error' }
let running: Promise<SyncResult> | null = null
const listeners = new Set<(r: SyncResult) => void>()
export const onSynced = (fn: (r: SyncResult) => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }
let currentUser: string | null = null
export const setSyncUser = (id: string | null) => { currentUser = id }

export function syncNow(): Promise<SyncResult> {
  if (!getApiToken() || !currentUser) return Promise.resolve({ ok: false, reason: 'not_signed_in' })
  if (running) return running
  running = (async (): Promise<SyncResult> => {
    try {
      const r = await push()
      await pull(false, currentUser)
      return { ok: true, ...r }
    } catch (e) {
      return { ok: false, reason: isOfflineError(e) ? 'offline' : 'error' }
    }
  })().then((r) => { running = null; listeners.forEach((fn) => fn(r)); return r })
  return running
}

let timer: ReturnType<typeof setTimeout> | null = null
export function requestSync(delayMs = 1500): void {
  if (typeof window === 'undefined') return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { timer = null; void syncNow() }, delayMs)
}

export function startAutoSync(): () => void {
  const tick = () => { if (navigator.onLine) void syncNow() }
  const interval = setInterval(tick, 30_000)
  const vis = () => { if (document.visibilityState === 'visible') tick() }
  window.addEventListener('online', tick)
  document.addEventListener('visibilitychange', vis)
  tick()
  return () => { clearInterval(interval); window.removeEventListener('online', tick); document.removeEventListener('visibilitychange', vis) }
}

export const touchMeta = patchMeta
