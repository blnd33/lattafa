/**
 * Authentication. Local mode checks credentials against this device's database; connected mode asks the server
 * (and lets someone who signed in on this till before PIN-in offline — see remote.ts).
 *
 * First run has NO default account: the setup wizard creates the Super Admin.
 * Cashiers sign in with a PIN on their tile; admins may also use username +
 * password. Repeated wrong PINs lock the account for a short time.
 */
import { db } from '@/data/db'
import { buildDemoData } from '@/data/seed'
import { STORE_LOCATION_ID, type Actor, type AppSettings, type Role, type User } from '@/data/types'
import { makeCredential, passwordProblem, PIN_RE, verifySecret } from '@/lib/credentials'
import { uuid } from '@/lib/id'
import { AVATAR_COLORS, hasPerm, makeActor, SYSTEM_ROLES } from '@/lib/permissions'
import { OFFLINE } from './api'
import { AppError } from './context'
import { isServer } from './mode'
import * as remote from './remote'
import { audit } from './audit'
import { DEFAULT_SETTINGS, getSettings, saveSettingsRaw } from './settings'

export async function isSetupDone(): Promise<boolean> {
  const s = await db.settings.get('app')
  if (s?.setupDone || !isServer()) return !!s?.setupDone
  // connected but nothing pulled yet: is the shop set up on the server? (offline → go to sign-in, which explains)
  return (await remote.setupStatus()) ?? true
}

export interface SetupInput {
  store: { name: string; phone: string; address: string; city: string }
  rate: number
  admin: { name: string; username: string; password: string; pin: string }
  demoData: boolean
  deviceName: string
}

/** Seeds the system roles (idempotent: only inserts the ones that are missing). */
export async function ensureSystemRoles(): Promise<Role[]> {
  const now = Date.now()
  const existing = await db.roles.toArray()
  const have = new Set(existing.map((r) => r.key))
  const fresh: Role[] = SYSTEM_ROLES.filter((r) => !have.has(r.key)).map((r) => ({
    id: uuid(), key: r.key, name: r.name, description: r.description,
    permissions: r.permissions, apps: r.apps, isSystem: true, createdAt: now, updatedAt: now,
  }))
  if (fresh.length) await db.roles.bulkAdd(fresh)
  return [...existing, ...fresh]
}

export async function completeSetup(input: SetupInput): Promise<void> {
  if (await isSetupDone()) throw new AppError('setup_already_done')
  const pw = passwordProblem(input.admin.password)
  if (pw) throw new AppError(`password_${pw}`)
  if (!PIN_RE.test(input.admin.pin)) throw new AppError('pin_invalid')
  if (!input.admin.name.trim() || !input.admin.username.trim()) throw new AppError('required_fields')
  if (!(input.rate > 0)) throw new AppError('invalid_rate')
  if (isServer()) return remote.completeSetup(input)

  const now = Date.now()
  await db.transaction('rw', [db.users, db.roles, db.settings, db.devices, db.products, db.variants, db.stock, db.stockMovements, db.customers, db.audit], async () => {
    const roles = await ensureSystemRoles()
    const superRole = roles.find((r) => r.key === 'super_admin')!
    const pin = makeCredential(input.admin.pin)
    const pass = makeCredential(input.admin.password)
    const user: User = {
      id: uuid(), name: input.admin.name.trim(), username: input.admin.username.trim().toLowerCase(),
      roleId: superRole.id, active: true, color: AVATAR_COLORS[0],
      pinHash: pin.hash, pinSalt: pin.salt, passwordHash: pass.hash, passwordSalt: pass.salt,
      grants: [], denies: [], limits: { maxDiscountPct: 100, maxRefundIQD: Number.MAX_SAFE_INTEGER },
      failedAttempts: 0, lockedUntil: null, lastLoginAt: null, createdAt: now, updatedAt: now, createdBy: null,
    }
    await db.users.add(user)

    const settings: AppSettings = {
      ...structuredClone(DEFAULT_SETTINGS),
      setupDone: true,
      store: { ...DEFAULT_SETTINGS.store, name: input.store.name.trim() || DEFAULT_SETTINGS.store.name, phone: input.store.phone, address: input.store.address, city: input.store.city },
      currency: { ...DEFAULT_SETTINGS.currency, rate: input.rate },
      device: { id: uuid(), code: 'ST1', name: input.deviceName.trim() || 'Counter 1', locationId: STORE_LOCATION_ID },
    }
    await saveSettingsRaw(settings)
    await db.devices.put({ id: settings.device.id, name: settings.device.name, code: settings.device.code, registeredAt: now, revoked: false })

    if (input.demoData) {
      const d = buildDemoData()
      await db.products.bulkAdd(d.products)
      await db.variants.bulkAdd(d.variants)
      await db.stock.bulkAdd(d.stock)
      // The ledger must explain every balance, so demo stock is booked as an opening movement.
      await db.stockMovements.bulkAdd(d.stock.map((r) => ({
        id: uuid(), variantId: r.variantId, locationId: r.locationId, type: 'opening' as const, qty: r.qty, balanceAfter: r.qty,
        refType: null, refId: null, note: 'Demo opening stock', userId: user.id, createdAt: now,
      })))
      await db.customers.bulkAdd(d.customers)
    }
    await audit('setup.complete', 'settings', 'app', { demoData: input.demoData }, { id: user.id, name: user.name })
  })
}

async function loadActor(user: User): Promise<Actor> {
  const role = await db.roles.get(user.roleId)
  if (!role) throw new AppError('role_missing')
  return makeActor(user, role)
}

async function registerFailure(user: User): Promise<never> {
  const s = await getSettings()
  const failed = user.failedAttempts + 1
  const locked = failed >= s.security.maxFailedAttempts
  await db.users.update(user.id, {
    failedAttempts: locked ? 0 : failed,
    lockedUntil: locked ? Date.now() + s.security.lockoutSeconds * 1000 : user.lockedUntil,
  })
  await audit('auth.failed', 'user', user.id, { locked }, { id: user.id, name: user.name })
  if (locked) throw new AppError('account_locked', { seconds: s.security.lockoutSeconds })
  throw new AppError('invalid_credentials', { left: s.security.maxFailedAttempts - failed })
}

function checkUsable(user: User | undefined): asserts user is User {
  if (!user) throw new AppError('invalid_credentials', { left: 0 })
  if (!user.active) throw new AppError('account_disabled')
  if (user.lockedUntil && user.lockedUntil > Date.now()) {
    throw new AppError('account_locked', { seconds: Math.ceil((user.lockedUntil - Date.now()) / 1000) })
  }
}

async function finishLogin(user: User, app: 'pos' | 'admin'): Promise<Actor> {
  const role = await db.roles.get(user.roleId)
  if (!role) throw new AppError('role_missing')
  if (!role.apps.includes(app)) throw new AppError('app_not_allowed')
  await db.users.update(user.id, { failedAttempts: 0, lockedUntil: null, lastLoginAt: Date.now() })
  await audit('auth.login', 'user', user.id, {}, { id: user.id, name: user.name })
  return makeActor(user, role)
}

export async function loginWithPin(userId: string, pin: string): Promise<Actor> {
  if (isServer()) return remote.loginWithPin(userId, pin)
  const user = await db.users.get(userId)
  checkUsable(user)
  if (!verifySecret(pin, user.pinHash, user.pinSalt)) await registerFailure(user)
  return finishLogin(user, 'pos')
}

/** `app: 'admin'` — the admin panel: online only, and the computer is never registered as a till. */
export async function loginWithPassword(username: string, password: string, app: 'pos' | 'admin' = 'pos'): Promise<Actor> {
  if (isServer()) return remote.loginWithPassword(username, password, app)
  if (app === 'admin') throw new AppError(OFFLINE)
  const user = await db.users.where('username').equals(username.trim().toLowerCase()).first()
  checkUsable(user)
  if (!verifySecret(password, user.passwordHash, user.passwordSalt)) await registerFailure(user)
  return finishLogin(user, 'pos')
}

/** Re-load the signed-in user's permissions (after an admin edited their role). `undefined` = can't tell right now (offline). */
export async function refreshActor(userId: string): Promise<Actor | null | undefined> {
  if (isServer()) return remote.refreshActor(userId)
  const user = await db.users.get(userId)
  if (!user || !user.active) return null
  return loadActor(user)
}

/** People shown as tiles on the PIN login screen. */
export async function listLoginUsers(): Promise<{ id: string; name: string; color: string; roleName: string; locked: boolean }[]> {
  const [users, roles] = await Promise.all([db.users.toArray(), db.roles.toArray()])
  const byId = new Map(roles.map((r) => [r.id, r]))
  return users
    .filter((u) => u.active && byId.get(u.roleId)?.apps.includes('pos'))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((u) => ({ id: u.id, name: u.name, color: u.color, roleName: byId.get(u.roleId)!.name, locked: !!u.lockedUntil && u.lockedUntil > Date.now() }))
}

/**
 * Supervisor approval: does this PIN belong to an active user who holds `permission`?
 * Used for over-limit discounts, big refunds, voids… (PINs are unique per user.)
 */
export async function verifyApproval(pin: string, permission: string): Promise<{ id: string; name: string } | null> {
  if (isServer()) return remote.verifyApproval(pin, permission)
  const [users, roles] = await Promise.all([db.users.toArray(), db.roles.toArray()])
  const byId = new Map(roles.map((r) => [r.id, r]))
  for (const u of users) {
    if (!u.active) continue
    if (!verifySecret(pin, u.pinHash, u.pinSalt)) continue
    const role = byId.get(u.roleId)
    if (!role) continue
    const actor = makeActor(u, role)
    if (hasPerm(actor.permissions, permission)) return { id: u.id, name: u.name }
  }
  return null
}
