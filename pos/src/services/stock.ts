/**
 * StockService — the ONLY code allowed to change stock quantities (brief §10).
 * Every change writes a `stock_movements` row, so the balance can always be
 * explained and audited. `applyMovement` must run inside a Dexie transaction that
 * includes the `stock` and `stockMovements` tables (sales/returns do that).
 */
import { db } from '@/data/db'
import { STORE_LOCATION_ID, type MovementType, type StockCountLine, type StockMovement } from '@/data/types'
import { uuid } from '@/lib/id'
import { AppError, assertCan, can, requireActor } from './context'
import { audit } from './audit'
import { isServer } from './mode'
import * as remote from './remote'

export interface MovementInput {
  variantId: string
  delta: number
  type: MovementType
  refType?: string
  refId?: string
  note?: string
  userId: string
  locationId?: string
  allowNegative?: boolean
}

export async function applyMovement(input: MovementInput): Promise<StockMovement> {
  const locationId = input.locationId ?? STORE_LOCATION_ID
  const key: [string, string] = [input.variantId, locationId]
  const row = await db.stock.get(key)
  const before = row?.qty ?? 0
  const after = before + input.delta
  if (after < 0 && !input.allowNegative) {
    const v = await db.variants.get(input.variantId)
    throw new AppError('insufficient_stock', { sku: v?.sku ?? input.variantId, available: before })
  }
  await db.stock.put({ variantId: input.variantId, locationId, qty: after })
  const mv: StockMovement = {
    id: uuid(),
    variantId: input.variantId,
    locationId,
    type: input.type,
    qty: input.delta,
    balanceAfter: after,
    refType: input.refType ?? null,
    refId: input.refId ?? null,
    note: input.note ?? '',
    userId: input.userId,
    createdAt: Date.now(),
  }
  await db.stockMovements.add(mv)
  return mv
}

/** variantId → quantity at this shop location. */
export async function stockMap(locationId = STORE_LOCATION_ID): Promise<Record<string, number>> {
  const rows = await db.stock.where('locationId').equals(locationId).toArray()
  return Object.fromEntries(rows.map((r) => [r.variantId, r.qty]))
}

/** Set an absolute quantity (damage/correction) — recorded as a signed movement. */
export async function adjustStock(input: { variantId: string; newQty: number; reason: 'adjustment' | 'damage'; note: string }): Promise<void> {
  const a = assertCan('inventory.adjust')
  if (!Number.isInteger(input.newQty) || input.newQty < 0) throw new AppError('invalid_quantity')
  if (isServer()) return remote.adjustStock(input)
  await db.transaction('rw', db.stock, db.stockMovements, db.audit, async () => {
    const cur = (await db.stock.get([input.variantId, STORE_LOCATION_ID]))?.qty ?? 0
    const delta = input.newQty - cur
    if (delta === 0) return
    await applyMovement({ variantId: input.variantId, delta, type: input.reason, note: input.note, userId: a.id, allowNegative: false })
    await audit('stock.adjust', 'variant', input.variantId, { from: cur, to: input.newQty, reason: input.reason })
  })
}

export async function receiveStock(items: { variantId: string; qty: number; costIQD?: number }[], note: string): Promise<void> {
  const a = assertCan('inventory.receive')
  if (!items.length || items.some((i) => !Number.isInteger(i.qty) || i.qty <= 0)) throw new AppError('invalid_quantity')
  if (isServer()) return remote.receiveStock(items, note)
  const ref = uuid()
  await db.transaction('rw', [db.stock, db.stockMovements, db.variants, db.audit], async () => {
    for (const it of items) {
      await applyMovement({ variantId: it.variantId, delta: it.qty, type: 'purchase', refType: 'receipt', refId: ref, note, userId: a.id })
      if (it.costIQD && it.costIQD > 0 && can('prices.edit')) await db.variants.update(it.variantId, { costIQD: Math.round(it.costIQD) })
    }
    await audit('stock.receive', 'receipt', ref, { lines: items.length, units: items.reduce((s, i) => s + i.qty, 0) })
  })
}

/** Open a bottle as a tester: it leaves sellable stock. */
export async function markTester(variantId: string, qty: number, note = ''): Promise<void> {
  const a = requireActor()
  if (!can('pos.tester') && !can('inventory.adjust')) throw new AppError('forbidden', { permission: 'pos.tester' })
  if (!Number.isInteger(qty) || qty <= 0) throw new AppError('invalid_quantity')
  if (isServer()) return remote.markTester(variantId, qty, note)
  await db.transaction('rw', db.stock, db.stockMovements, db.audit, async () => {
    await applyMovement({ variantId, delta: -qty, type: 'tester', note, userId: a.id })
    await audit('stock.tester', 'variant', variantId, { qty })
  })
}

/** Apply a physical stock count: stock is corrected to what was counted. */
export async function applyStockCount(lines: StockCountLine[], note: string): Promise<{ changed: number }> {
  const a = assertCan('inventory.count')
  if (isServer()) return remote.applyStockCount(lines, note)
  const id = uuid()
  let changed = 0
  await db.transaction('rw', [db.stock, db.stockMovements, db.stockCounts, db.audit], async () => {
    const stored: StockCountLine[] = []
    for (const l of lines) {
      if (!Number.isInteger(l.counted) || l.counted < 0) throw new AppError('invalid_quantity')
      const cur = (await db.stock.get([l.variantId, STORE_LOCATION_ID]))?.qty ?? 0
      stored.push({ variantId: l.variantId, expected: cur, counted: l.counted })
      if (cur !== l.counted) {
        await applyMovement({ variantId: l.variantId, delta: l.counted - cur, type: 'count', refType: 'count', refId: id, note, userId: a.id })
        changed++
      }
    }
    await db.stockCounts.add({ id, locationId: STORE_LOCATION_ID, lines: stored, note, userId: a.id, createdAt: Date.now() })
    await audit('stock.count', 'count', id, { lines: lines.length, changed })
  })
  return { changed }
}

export async function listMovements(opts: { variantId?: string; limit?: number } = {}): Promise<StockMovement[]> {
  assertCan('inventory.movements')
  if (isServer()) return remote.listMovements(opts)
  const rows = opts.variantId
    ? await db.stockMovements.where('variantId').equals(opts.variantId).toArray()
    : await db.stockMovements.toArray()
  return rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, opts.limit ?? 200)
}
