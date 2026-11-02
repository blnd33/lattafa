/**
 * Sync outbox.
 *
 * Every sale, return, shift, collection and new customer is written to IndexedDB first (so the POS never blocks on
 * the network) and a row is queued here. In connected mode `syncNow` sends the queue to `POST /api/v1/sync/push`
 * — oldest first, each record carrying its own UUID so a retry can never create a duplicate — and then pulls what
 * changed on the server (`GET /api/v1/sync/pull?since=`) into the local mirror. Push always happens before pull.
 */
import { db } from '@/data/db'
import type { OutboxItem } from '@/data/types'
import { uuid } from '@/lib/id'
import { api, getApiToken, isOfflineError } from './api'
import { applyPull, type PullPayload } from './mirror'
import { isServer } from './mode'
import { getSettings } from './settings'

// Rows are sent in the order they were queued (a shift before its sales, a sale before its return), so two rows queued
// in the same millisecond must still get distinct, increasing times.
let lastQueuedAt = 0

export async function queueOutbox(entity: OutboxItem['entity'], entityId: string): Promise<void> {
  lastQueuedAt = Math.max(Date.now(), lastQueuedAt + 1)
  await db.outbox.add({ id: uuid(), entity, entityId, status: 'pending', attempts: 0, createdAt: lastQueuedAt, lastError: '' })
  if (isServer()) requestSync()
}

export async function pendingCount(): Promise<number> {
  return db.outbox.where('status').anyOf('pending', 'failed').count()
}

/** Is this record still waiting to reach the server? */
export async function isPending(entity: OutboxItem['entity'], entityId: string): Promise<boolean> {
  return (await db.outbox.where('entity').equals(entity).toArray()).some((r) => r.entityId === entityId && r.status !== 'sent')
}

/** Outbox rows the server refused for good (shown to managers so nothing is silently lost). */
export async function failedItems(): Promise<OutboxItem[]> {
  return db.outbox.where('status').equals('failed').toArray()
}

export type SyncResult =
  | { ok: true; pushed: number; failed: number; pulled: boolean }
  | { ok: false; reason: 'local_mode' | 'offline' | 'not_signed_in' | 'server_error'; message?: string }

type PushStatus = 'ok' | 'duplicate' | 'retry' | 'rejected' | 'error'
interface PushResult { entity: string; id: string; status: PushStatus; code?: string; flags?: string[] }

const TABLE: Record<OutboxItem['entity'], string> = {
  sale: 'sales', return: 'returns', shift: 'shifts', collection: 'collections', customer: 'customers', stock_movement: 'stockMovements',
}
const BATCH = 100

/** Sends the outbox. Returns how many records the server accepted and how many it refused for good. */
export async function pushOutbox(): Promise<{ pushed: number; failed: number }> {
  // one entry per record, in the order they were first queued (a sale before its return, a shift before its sales)
  const rows = (await db.outbox.where('status').equals('pending').toArray()).sort((a, b) => a.createdAt - b.createdAt)
  const order: string[] = []
  const byKey = new Map<string, OutboxItem[]>()
  for (const r of rows) {
    const k = `${r.entity}:${r.entityId}`
    if (!byKey.has(k)) { byKey.set(k, []); order.push(k) }
    byKey.get(k)!.push(r)
  }
  let pushed = 0
  let failed = 0
  for (let i = 0; i < order.length; i += BATCH) {
    const keys = order.slice(i, i + BATCH)
    const items: { entity: string; id: string; data: unknown }[] = []
    for (const k of keys) {
      const first = byKey.get(k)![0]
      const data = await db.table(TABLE[first.entity]).get(first.entityId)
      if (data) items.push({ entity: first.entity, id: first.entityId, data })
      else await db.outbox.bulkDelete(byKey.get(k)!.map((r) => r.id)) // record vanished locally (e.g. restored backup)
    }
    if (!items.length) continue
    const res = await api<{ serverTime: number; results: PushResult[] }>('POST', '/sync/push', { items }, { timeoutMs: 60_000 })
    for (const r of res.results) {
      const queued = byKey.get(`${r.entity}:${r.id}`) ?? []
      if (r.status === 'ok' || r.status === 'duplicate') {
        await db.outbox.bulkDelete(queued.map((q) => q.id))
        pushed++
      } else if (r.status === 'rejected') {
        for (const q of queued) await db.outbox.update(q.id, { status: 'failed', attempts: q.attempts + 1, lastError: r.code ?? 'rejected' })
        failed++
      } else {
        for (const q of queued) await db.outbox.update(q.id, { attempts: q.attempts + 1, lastError: r.code ?? r.status })
      }
    }
  }
  return { pushed, failed }
}

/**
 * Pulls what changed since the last pull (or everything, the first time) into the local mirror.
 *
 * The mirror repairs itself with a full pull when the changes can't be written (e.g. a SKU that moved to another row
 * would break the unique index again on every later pull) or when it no longer holds what the server holds. The outbox
 * is left alone, so nothing waiting to be sent is lost.
 */
export async function pullNow(full = false): Promise<void> {
  const s = await getSettings()
  const since = full ? 0 : s.sync.lastPullAt || 0
  const payload = await api<PullPayload>('GET', `/sync/pull?since=${since}`, undefined, { timeoutMs: 60_000 })
  try {
    await applyPull(payload)
  } catch (e) {
    if (!since) throw e
    return pullNow(true)
  }
  if (since && payload.catalog && ((await db.products.count()) !== payload.catalog.products || (await db.variants.count()) !== payload.catalog.variants)) await pullNow(true)
}

let running: Promise<SyncResult> | null = null
const listeners = new Set<(r: SyncResult) => void>()
export const onSynced = (fn: (r: SyncResult) => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }

export function syncNow(): Promise<SyncResult> {
  if (!isServer()) return Promise.resolve({ ok: false, reason: 'local_mode' })
  if (!getApiToken()) return Promise.resolve({ ok: false, reason: 'not_signed_in' })
  if (running) return running
  running = (async (): Promise<SyncResult> => {
    try {
      const { pushed, failed } = await pushOutbox()
      await pullNow()
      return { ok: true, pushed, failed, pulled: true }
    } catch (e) {
      if (isOfflineError(e)) return { ok: false, reason: 'offline' }
      return { ok: false, reason: 'server_error', message: e instanceof Error ? e.message : String(e) }
    }
  })().then((r) => { running = null; listeners.forEach((fn) => fn(r)); return r })
  return running
}

let timer: ReturnType<typeof setTimeout> | null = null
/** Sync soon (coalesces bursts — e.g. a sale queues several rows at once). */
export function requestSync(delayMs = 1500): void {
  if (!isServer() || typeof window === 'undefined') return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { timer = null; void syncNow() }, delayMs)
}

/** Background sync while the app is open: every 30 s, when the network comes back, and when the tab is shown again. */
export function startAutoSync(): () => void {
  if (!isServer()) return () => {}
  const tick = () => { if (navigator.onLine) void syncNow() }
  const interval = setInterval(tick, 30_000)
  const onVisible = () => { if (document.visibilityState === 'visible') tick() }
  window.addEventListener('online', tick)
  document.addEventListener('visibilitychange', onVisible)
  tick()
  return () => { clearInterval(interval); window.removeEventListener('online', tick); document.removeEventListener('visibilitychange', onVisible) }
}
