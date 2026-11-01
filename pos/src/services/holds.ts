import { db } from '@/data/db'
import type { CartSnapshotLine, Hold } from '@/data/types'
import { uuid } from '@/lib/id'
import type { OrderDiscount } from '@/lib/pricing'
import { AppError, assertCan, can, requireActor } from './context'

export async function holdCart(input: {
  lines: CartSnapshotLine[]
  customerId: string | null
  orderDiscount: OrderDiscount | null
  giftWrap: boolean
  note: string
  label: string
}): Promise<Hold> {
  const a = assertCan('pos.hold')
  if (!input.lines.length) throw new AppError('cart_empty')
  const h: Hold = { id: uuid(), userId: a.id, ...input, createdAt: Date.now() }
  await db.holds.add(h)
  return h
}

export async function listHolds(): Promise<Hold[]> {
  const a = assertCan('pos.hold')
  const all = await db.holds.orderBy('createdAt').reverse().toArray()
  return can('sales.view_all') ? all : all.filter((h) => h.userId === a.id)
}

export async function deleteHold(id: string): Promise<void> {
  requireActor()
  await db.holds.delete(id)
}
