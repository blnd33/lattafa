/**
 * Accounts & roles — the Super Admin's toolbox.
 *
 *  - create/edit/disable/delete accounts
 *  - hand out a role plus per-user extra grants / explicit denies
 *  - create custom roles with any mix of permissions
 *
 * Safety rules enforced here (not only in the UI):
 *  - only a Super Admin can create/edit Super Admins or change roles/permissions
 *  - the last active Super Admin can't be disabled, demoted or deleted
 *  - you can't delete or disable yourself
 *  - PINs are unique (so a supervisor PIN identifies exactly one person)
 */
import { db } from '@/data/db'
import type { Role, User, UserLimits } from '@/data/types'
import { makeCredential, passwordProblem, PIN_RE, verifySecret } from '@/lib/credentials'
import { uuid } from '@/lib/id'
import { ALL_PERMISSIONS, AVATAR_COLORS } from '@/lib/permissions'
import { AppError, assertCan, requireActor } from './context'
import { audit } from './audit'
import { isServer } from './mode'
import * as remote from './remote'

export type PublicUser = Omit<User, 'pinHash' | 'pinSalt' | 'passwordHash' | 'passwordSalt'> & { hasPassword: boolean }

const strip = (u: User): PublicUser => {
  const { pinHash: _p, pinSalt: _ps, passwordHash, passwordSalt: _pws, ...rest } = u
  void _p; void _ps; void _pws
  return { ...rest, hasPassword: !!passwordHash }
}

/* ───────── roles ───────── */

export async function listRoles(): Promise<Role[]> {
  assertCan('users.view')
  return (await db.roles.toArray()).sort((a, b) => Number(b.isSystem) - Number(a.isSystem) || a.name.localeCompare(b.name))
}

function cleanPerms(perms: string[]): string[] {
  const set = new Set(perms.filter((p) => p === '*' || ALL_PERMISSIONS.includes(p)))
  return [...set]
}

export async function saveRole(input: { id?: string; name: string; description: string; permissions: string[]; apps: Role['apps'] }): Promise<Role> {
  if (isServer()) { assertCan('roles.manage'); return remote.saveRole(input) }
  const actor = assertCan('roles.manage')
  const name = input.name.trim()
  if (!name) throw new AppError('required_fields')
  const now = Date.now()
  if (input.id) {
    const cur = await db.roles.get(input.id)
    if (!cur) throw new AppError('not_found')
    if (cur.key === 'super_admin') throw new AppError('role_locked')
    const next: Role = { ...cur, name, description: input.description.trim(), permissions: cleanPerms(input.permissions), apps: input.apps, updatedAt: now }
    await db.roles.put(next)
    await audit('role.update', 'role', cur.id, { name, permissions: next.permissions.length })
    return next
  }
  const key = `custom_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'role'}_${uuid().slice(0, 4)}`
  const role: Role = { id: uuid(), key, name, description: input.description.trim(), permissions: cleanPerms(input.permissions), apps: input.apps, isSystem: false, createdAt: now, updatedAt: now }
  await db.roles.add(role)
  await audit('role.create', 'role', role.id, { name, by: actor.name })
  return role
}

export async function deleteRole(id: string): Promise<void> {
  if (isServer()) { assertCan('roles.manage'); return remote.deleteRole(id) }
  assertCan('roles.manage')
  const role = await db.roles.get(id)
  if (!role) throw new AppError('not_found')
  if (role.isSystem) throw new AppError('role_locked')
  const inUse = await db.users.where('roleId').equals(id).count()
  if (inUse) throw new AppError('role_in_use', { count: inUse })
  await db.roles.delete(id)
  await audit('role.delete', 'role', id, { name: role.name })
}

/* ───────── users ───────── */

export async function listUsers(): Promise<PublicUser[]> {
  assertCan('users.view')
  return (await db.users.toArray()).sort((a, b) => a.name.localeCompare(b.name)).map(strip)
}

async function activeSuperAdmins(excludeId?: string): Promise<User[]> {
  const sa = await db.roles.where('key').equals('super_admin').first()
  if (!sa) return []
  return (await db.users.where('roleId').equals(sa.id).toArray()).filter((u) => u.active && u.id !== excludeId)
}

async function pinTaken(pin: string, exceptUserId?: string): Promise<boolean> {
  const users = await db.users.toArray()
  return users.some((u) => u.id !== exceptUserId && verifySecret(pin, u.pinHash, u.pinSalt))
}

export interface UserInput {
  id?: string
  name: string
  username: string
  roleId: string
  active: boolean
  pin?: string
  password?: string
  grants: string[]
  denies: string[]
  limits: UserLimits
  color?: string
}

export async function saveUser(input: UserInput): Promise<PublicUser> {
  if (isServer()) { assertCan(input.id ? 'users.edit' : 'users.create'); return remote.saveUser(input) }
  const actor = requireActor()
  assertCan(input.id ? 'users.edit' : 'users.create')
  const name = input.name.trim()
  const username = input.username.trim().toLowerCase()
  if (!name || !username) throw new AppError('required_fields')
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new AppError('username_invalid')
  const role = await db.roles.get(input.roleId)
  if (!role) throw new AppError('role_missing')
  // Only a Super Admin may hand out the Super Admin role — or change anything about one.
  if (role.key === 'super_admin' && !actor.isSuperAdmin) throw new AppError('forbidden', { permission: 'roles.manage' })
  if ((input.grants.length || input.denies.length) && !actor.isSuperAdmin) throw new AppError('forbidden', { permission: 'roles.manage' })
  if (input.password) {
    const p = passwordProblem(input.password)
    if (p) throw new AppError(`password_${p}`)
  }
  if (input.pin && !PIN_RE.test(input.pin)) throw new AppError('pin_invalid')
  if (input.pin && (await pinTaken(input.pin, input.id))) throw new AppError('pin_taken')

  const now = Date.now()
  const dup = await db.users.where('username').equals(username).first()
  if (dup && dup.id !== input.id) throw new AppError('username_taken')

  const clean = { grants: input.grants.filter((p) => ALL_PERMISSIONS.includes(p)), denies: input.denies.filter((p) => ALL_PERMISSIONS.includes(p)) }
  const limits: UserLimits = {
    maxDiscountPct: Math.min(100, Math.max(0, Math.round(input.limits.maxDiscountPct))),
    maxRefundIQD: Math.max(0, Math.round(input.limits.maxRefundIQD)),
  }

  if (input.id) {
    const cur = await db.users.get(input.id)
    if (!cur) throw new AppError('not_found')
    const curRole = await db.roles.get(cur.roleId)
    if (curRole?.key === 'super_admin' && !actor.isSuperAdmin) throw new AppError('forbidden', { permission: 'roles.manage' })
    const demoting = curRole?.key === 'super_admin' && role.key !== 'super_admin'
    const disabling = cur.active && !input.active
    if ((demoting || disabling) && (await activeSuperAdmins(cur.id)).length === 0) throw new AppError('last_super_admin')
    if (cur.id === actor.id && (!input.active || demoting)) throw new AppError('cannot_modify_self')
    const next: User = { ...cur, name, username, roleId: role.id, active: input.active, color: input.color ?? cur.color, ...clean, limits, updatedAt: now }
    if (input.pin) { const c = makeCredential(input.pin); next.pinHash = c.hash; next.pinSalt = c.salt; next.failedAttempts = 0; next.lockedUntil = null }
    if (input.password) { const c = makeCredential(input.password); next.passwordHash = c.hash; next.passwordSalt = c.salt }
    await db.users.put(next)
    await audit('user.update', 'user', cur.id, { name, role: role.name, active: input.active, grants: clean.grants.length, denies: clean.denies.length, pinChanged: !!input.pin, passwordChanged: !!input.password })
    return strip(next)
  }

  if (!input.pin) throw new AppError('pin_invalid')
  const pin = makeCredential(input.pin)
  const pass = input.password ? makeCredential(input.password) : null
  const count = await db.users.count()
  const user: User = {
    id: uuid(), name, username, roleId: role.id, active: input.active,
    color: input.color ?? AVATAR_COLORS[count % AVATAR_COLORS.length],
    pinHash: pin.hash, pinSalt: pin.salt, passwordHash: pass?.hash ?? null, passwordSalt: pass?.salt ?? null,
    ...clean, limits, failedAttempts: 0, lockedUntil: null, lastLoginAt: null, createdAt: now, updatedAt: now, createdBy: actor.id,
  }
  await db.users.add(user)
  await audit('user.create', 'user', user.id, { name, username, role: role.name })
  return strip(user)
}

export async function resetCredentials(userId: string, input: { pin?: string; password?: string }): Promise<void> {
  if (isServer()) { assertCan('users.reset_credentials'); return remote.resetCredentials(userId, input) }
  const actor = assertCan('users.reset_credentials')
  const u = await db.users.get(userId)
  if (!u) throw new AppError('not_found')
  const role = await db.roles.get(u.roleId)
  if (role?.key === 'super_admin' && !actor.isSuperAdmin) throw new AppError('forbidden', { permission: 'roles.manage' })
  const patch: Partial<User> = { failedAttempts: 0, lockedUntil: null, updatedAt: Date.now() }
  if (input.pin) {
    if (!PIN_RE.test(input.pin)) throw new AppError('pin_invalid')
    if (await pinTaken(input.pin, userId)) throw new AppError('pin_taken')
    const c = makeCredential(input.pin); patch.pinHash = c.hash; patch.pinSalt = c.salt
  }
  if (input.password) {
    const p = passwordProblem(input.password)
    if (p) throw new AppError(`password_${p}`)
    const c = makeCredential(input.password); patch.passwordHash = c.hash; patch.passwordSalt = c.salt
  }
  await db.users.update(userId, patch)
  await audit('user.reset_credentials', 'user', userId, { pin: !!input.pin, password: !!input.password })
}

export async function unlockUser(userId: string): Promise<void> {
  if (isServer()) { assertCan('users.edit'); return remote.unlockUser(userId) }
  assertCan('users.edit')
  await db.users.update(userId, { failedAttempts: 0, lockedUntil: null })
  await audit('user.unlock', 'user', userId)
}

export async function deleteUser(id: string): Promise<void> {
  if (isServer()) { assertCan('users.delete'); return remote.deleteUser(id) }
  const actor = assertCan('users.delete')
  if (id === actor.id) throw new AppError('cannot_modify_self')
  const u = await db.users.get(id)
  if (!u) throw new AppError('not_found')
  const role = await db.roles.get(u.roleId)
  if (role?.key === 'super_admin' && (await activeSuperAdmins(id)).length === 0) throw new AppError('last_super_admin')
  // Accounts with a sales/shift history are kept (disabled) so reports stay truthful.
  const [sales, shifts] = await Promise.all([db.sales.where('userId').equals(id).count(), db.shifts.where('userId').equals(id).count()])
  if (sales || shifts) throw new AppError('user_has_history')
  await db.users.delete(id)
  await audit('user.delete', 'user', id, { name: u.name })
}

/** Change your own PIN/password (needs the current PIN). */
export async function changeOwnCredentials(input: { currentPin: string; newPin?: string; newPassword?: string }): Promise<void> {
  const actor = requireActor()
  if (isServer()) return remote.changeOwnCredentials(input)
  const u = await db.users.get(actor.id)
  if (!u) throw new AppError('not_found')
  if (!verifySecret(input.currentPin, u.pinHash, u.pinSalt)) throw new AppError('invalid_credentials', { left: 0 })
  const patch: Partial<User> = { updatedAt: Date.now() }
  if (input.newPin) {
    if (!PIN_RE.test(input.newPin)) throw new AppError('pin_invalid')
    if (await pinTaken(input.newPin, u.id)) throw new AppError('pin_taken')
    const c = makeCredential(input.newPin); patch.pinHash = c.hash; patch.pinSalt = c.salt
  }
  if (input.newPassword) {
    const p = passwordProblem(input.newPassword)
    if (p) throw new AppError(`password_${p}`)
    const c = makeCredential(input.newPassword); patch.passwordHash = c.hash; patch.passwordSalt = c.salt
  }
  await db.users.update(u.id, patch)
  await audit('user.change_own_credentials', 'user', u.id)
}
