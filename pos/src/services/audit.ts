import { db } from '@/data/db'
import type { AuditEntry } from '@/data/types'
import { uuid } from '@/lib/id'
import { assertCan, getActor } from './context'
import { isServer } from './mode'
import * as remote from './remote'

/** Append-only activity log. Never throws — logging must not break a sale. */
export async function audit(action: string, entity: string, entityId: string, meta: Record<string, unknown> = {}, userOverride?: { id: string; name: string }): Promise<void> {
  try {
    const a = getActor()
    const entry: AuditEntry = {
      id: uuid(),
      userId: userOverride?.id ?? a?.id ?? 'system',
      userName: userOverride?.name ?? a?.name ?? 'System',
      action,
      entity,
      entityId,
      meta,
      createdAt: Date.now(),
    }
    await db.audit.add(entry)
  } catch (e) {
    console.warn('audit failed', e)
  }
}

export async function listAudit(opts: { limit?: number; action?: string; userId?: string } = {}): Promise<AuditEntry[]> {
  assertCan('audit.view')
  if (isServer()) return remote.listAudit(opts)
  let rows = await db.audit.orderBy('createdAt').reverse().toArray()
  if (opts.action) rows = rows.filter((r) => r.action.startsWith(opts.action!))
  if (opts.userId) rows = rows.filter((r) => r.userId === opts.userId)
  return rows.slice(0, opts.limit ?? 300)
}
