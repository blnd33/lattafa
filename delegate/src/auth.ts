/**
 * Delegate sign-in.
 *
 *  1. Binding: the first time, the Super Admin signs in on the phone with username + password. The server registers it
 *     as a delegate device (code DL1, DL2… — it prefixes receipt numbers) and the phone downloads the catalogue.
 *  2. Every day: the delegate taps their name and types their PIN. Online the server checks it; a delegate who has
 *     signed in on this phone before can also sign in while offline (the PIN is checked against a hash made here).
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Actor, CachedCredential } from '@/data/types'
import { makeCredential, verifySecret } from '@/lib/credentials'
import { hasPerm } from '@/lib/permissions'
import { api, isOfflineError, setApiDevice, setApiToken, getApiToken } from '@/services/api'
import { AppError, setActor } from '@/services/context'
import { ddb, getMeta, patchMeta } from './data'
import { pull, requestSync, setSyncUser } from './sync'

interface Device { id: string; name: string; code: string }
interface LoginResponse { token: string; user: Actor; device: Device | null }

/* ───────── session ───────── */

interface SessionState {
  actor: Actor | null
  token: string | null
  lastUserId: string | null
  signIn: (a: Actor) => void
  signOut: () => void
}

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      actor: null,
      token: null,
      lastUserId: null,
      signIn: (actor) => { setActor(actor); setSyncUser(actor.id); set({ actor, token: getApiToken(), lastUserId: actor.id }) },
      signOut: () => { setActor(null); setSyncUser(null); setApiToken(null); set({ actor: null, token: null }) },
    }),
    {
      name: 'lattafa-delegate-session',
      partialize: (s) => ({ actor: s.actor, token: s.token, lastUserId: s.lastUserId }),
      onRehydrateStorage: () => (s) => {
        if (s?.actor) { setActor(s.actor); setSyncUser(s.actor.id) }
        if (s?.token) setApiToken(s.token)
      },
    },
  ),
)

/** Device id header on every request (the server binds tokens to this phone). */
export async function initDevice(): Promise<{ bound: boolean }> {
  const m = await getMeta()
  setApiDevice(m.deviceId)
  return { bound: !!m.deviceCode }
}

/* ───────── binding (Super Admin, once per phone) ───────── */

export async function bindPhone(username: string, password: string, deviceName: string): Promise<void> {
  const m = await getMeta()
  setApiDevice(m.deviceId)
  const r = await api<LoginResponse>('POST', '/auth/login', { username, password, app: 'delegate', deviceName: deviceName || 'Delegate phone' }, { anonymous: true })
  if (!r.user.isSuperAdmin && !hasPerm(r.user.permissions, 'devices.manage')) throw new AppError('forbidden', { permission: 'devices.manage' })
  setApiToken(r.token)
  try {
    await pull(true, null) // catalogue, customers and the list of delegates for the PIN screen
    await patchMeta({ deviceCode: r.device?.code ?? '', deviceName: r.device?.name ?? deviceName })
    await api('POST', '/auth/logout').catch(() => undefined) // the admin's token is not left on the delegate's phone
  } finally {
    setApiToken(null)
  }
}

/* ───────── PIN sign-in ───────── */

export interface Tile { id: string; name: string; color: string; locked: boolean }

/** Who can sign in here: asked from the server, or (offline) worked out from the phone's copy of accounts and roles. */
export async function loginTiles(): Promise<Tile[]> {
  try {
    const r = await api<{ users: (Tile & { roleName: string })[] }>('GET', '/auth/login-users?app=delegate', undefined, { anonymous: true, timeoutMs: 6000 })
    return r.users
  } catch (e) {
    if (!isOfflineError(e)) throw e
  }
  const [users, roles] = await Promise.all([ddb.users.toArray(), ddb.roles.toArray()])
  const byId = new Map(roles.map((r) => [r.id, r]))
  return users
    .filter((u) => { const r = byId.get(u.roleId); return u.active && !!r && r.key !== 'super_admin' && r.apps.includes('delegate') && hasPerm(r.permissions, 'delegate.sell') })
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((u) => ({ id: u.id, name: u.name, color: u.color, locked: !!u.lockedUntil && u.lockedUntil > Date.now() }))
}

async function remember(actor: Actor, token: string, pin: string): Promise<void> {
  const c = makeCredential(pin)
  const row: CachedCredential = { userId: actor.id, actor, token, pinHash: c.hash, pinSalt: c.salt, passwordHash: null, passwordSalt: null, failedAttempts: 0, lockedUntil: null, updatedAt: Date.now() }
  await ddb.creds.put(row)
}

export async function pinLogin(userId: string, pin: string): Promise<Actor> {
  let r: LoginResponse
  try {
    r = await api<LoginResponse>('POST', '/auth/pin-login', { userId, pin, app: 'delegate' }, { anonymous: true })
  } catch (e) {
    if (!isOfflineError(e)) throw e
    return offlineLogin(userId, pin)
  }
  setApiToken(r.token)
  await remember(r.user, r.token, pin)
  if (r.device) await patchMeta({ deviceCode: r.device.code, deviceName: r.device.name })
  const m = await getMeta()
  // a different delegate than last time (or the first sign-in): their van must be on the phone before selling
  if (m.pulledFor !== r.user.id) await pull(true, r.user.id)
  else requestSync(300)
  return r.user
}

async function offlineLogin(userId: string, pin: string): Promise<Actor> {
  const c = await ddb.creds.get(userId)
  if (!c?.pinHash || !c.pinSalt) throw new AppError('offline_first_login')
  if (c.lockedUntil && c.lockedUntil > Date.now()) throw new AppError('account_locked', { seconds: Math.ceil((c.lockedUntil - Date.now()) / 1000) })
  if (!verifySecret(pin, c.pinHash, c.pinSalt)) {
    const failed = c.failedAttempts + 1
    const locked = failed >= 5
    await ddb.creds.update(userId, { failedAttempts: locked ? 0 : failed, lockedUntil: locked ? Date.now() + 60_000 : null })
    if (locked) throw new AppError('account_locked', { seconds: 60 })
    throw new AppError('invalid_credentials', { left: 5 - failed })
  }
  const m = await getMeta()
  if (m.pulledFor !== userId) throw new AppError('offline_first_login') // this phone holds someone else's van
  await ddb.creds.update(userId, { failedAttempts: 0, lockedUntil: null })
  setApiToken(c.token)
  return c.actor
}
