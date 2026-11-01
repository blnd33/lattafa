import { db } from '@/data/db'
import { hasPerm, makeActor } from '@/lib/permissions'
import { AppError } from './context'

/**
 * Re-checks (at save time) that the supervisor who approved something really is an
 * active user holding the permission — the UI's word alone is never enough.
 */
export async function verifyApprovedBy(userId: string, permission: string): Promise<{ id: string; name: string }> {
  const u = await db.users.get(userId)
  const role = u ? await db.roles.get(u.roleId) : undefined
  if (!u || !u.active || !role) throw new AppError('approval_invalid')
  if (!hasPerm(makeActor(u, role).permissions, permission)) throw new AppError('approval_invalid')
  return { id: u.id, name: u.name }
}
