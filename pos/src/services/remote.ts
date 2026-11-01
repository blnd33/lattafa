/**
 * Connected mode: the server implementations behind the POS services.
 *
 * Each local service starts with `if (isServer()) return remote.xxx(...)`. Admin changes (accounts, roles, products,
 * prices, stock, settings, devices) go straight to the API — the server enforces the same permission rules — and the
 * local mirror is refreshed afterwards. Views that span all tills (sales history, returns, shifts, reports, audit) read
 * from the server when it is reachable and fall back to what this till holds when it is not.
 */
import { db } from '@/data/db'
import type {
  Actor, AppSettings, AuditEntry, CachedCredential, Customer, Device, Role, Sale, SaleReturn, Shift, StockCountLine, StockMovement,
} from '@/data/types'
import { makeCredential, verifySecret } from '@/lib/credentials'
import { hasPerm } from '@/lib/permissions'
import { api, isOfflineError, setApiToken } from './api'
import { AppError, getActor } from './context'
import { cacheServerSale, userFromServer, type ServerDevice, type ServerUser } from './mirror'
import { getSettings, saveSettingsRaw } from './settings'
import { isPending, pullNow, requestSync } from './sync'
import type { SetupInput } from './auth'
import type { PublicUser, UserInput } from './users'
import type { ProductInput, VariantInput } from './catalog'
import type { CustomerInput, StatementRow } from './customers'
import type { SaleFilter } from './sales'
import type { SalesReport } from './reports'
import type { CsvRow } from './csv'

const enc = encodeURIComponent

/* ───────────────────────── sign-in ───────────────────────── */

interface LoginResponse { token: string; user: Actor; device: ServerDevice | null }

/** Remember this device's identity as the server knows it (its code prefixes receipt numbers). */
async function adoptDevice(d: ServerDevice | null): Promise<void> {
  if (!d) return
  const s = await getSettings()
  if (s.device.id === d.id && s.device.code === d.code && s.device.name === d.name) return
  await saveSettingsRaw({ ...s, device: { ...s.device, id: d.id, code: d.code, name: d.name } })
  await db.devices.put({ id: d.id, name: d.name, code: d.code, registeredAt: d.registeredAt, revoked: d.revoked })
}

/** After an online sign-in: keep what is needed to let the same person PIN-in here while offline. */
async function remember(actor: Actor, token: string, secret: { pin?: string; password?: string }): Promise<void> {
  const cur = await db.creds.get(actor.id)
  const pin = secret.pin ? makeCredential(secret.pin) : null
  const pw = secret.password ? makeCredential(secret.password) : null
  const row: CachedCredential = {
    userId: actor.id, actor, token,
    pinHash: pin?.hash ?? cur?.pinHash ?? null, pinSalt: pin?.salt ?? cur?.pinSalt ?? null,
    passwordHash: pw?.hash ?? cur?.passwordHash ?? null, passwordSalt: pw?.salt ?? cur?.passwordSalt ?? null,
    failedAttempts: 0, lockedUntil: null, updatedAt: Date.now(),
  }
  await db.creds.put(row)
}

async function afterLogin(r: LoginResponse, secret: { pin?: string; password?: string }): Promise<Actor> {
  setApiToken(r.token)
  await adoptDevice(r.device)
  await remember(r.user, r.token, secret)
  const s = await getSettings()
  // first sign-in on this till: fetch everything before showing the app; later ones refresh in the background
  if (!s.sync.lastPullAt) await pullNow(true)
  else requestSync(300)
  return r.user
}

export async function setupStatus(): Promise<boolean | null> {
  try {
    return (await api<{ setupDone: boolean }>('GET', '/setup/status', undefined, { anonymous: true, timeoutMs: 5000 })).setupDone
  } catch (e) {
    if (isOfflineError(e)) return null
    throw e
  }
}

/** First run of the whole shop, done from this till: the server creates the Super Admin and registers this device. */
export async function completeSetup(input: SetupInput): Promise<void> {
  const s = await getSettings()
  const r = await api<{ token: string; user: Actor; device: ServerDevice | null }>('POST', '/setup', {
    store: { name: input.store.name, phone: input.store.phone, address: input.store.address, city: input.store.city },
    rate: input.rate, admin: input.admin, demoData: input.demoData, deviceId: s.device.id, deviceName: input.deviceName,
  }, { anonymous: true, timeoutMs: 60_000 })
  setApiToken(r.token)
  await adoptDevice(r.device)
  await remember(r.user, r.token, { pin: input.admin.pin, password: input.admin.password })
  await pullNow(true)
  setApiToken(null) // the owner still signs in with their PIN like everyone else
}

export async function loginWithPassword(username: string, password: string, app: 'pos' | 'admin' = 'pos'): Promise<Actor> {
  const s = await getSettings()
  const r = await api<LoginResponse>('POST', '/auth/login', { username, password, deviceName: s.device.name, app }, { anonymous: true })
  // the admin panel has no offline sign-in, so nothing derived from the password is kept on that computer
  return afterLogin(r, app === 'admin' ? {} : { password })
}

export async function loginWithPin(userId: string, pin: string): Promise<Actor> {
  try {
    const r = await api<LoginResponse>('POST', '/auth/pin-login', { userId, pin }, { anonymous: true })
    return await afterLogin(r, { pin })
  } catch (e) {
    if (!isOfflineError(e)) throw e
    return offlinePinLogin(userId, pin)
  }
}

/** No internet: someone who signed in on this till before may continue with the same PIN. */
async function offlinePinLogin(userId: string, pin: string): Promise<Actor> {
  const c = await db.creds.get(userId)
  if (!c?.pinHash || !c.pinSalt) throw new AppError('offline_first_login')
  if (c.lockedUntil && c.lockedUntil > Date.now()) throw new AppError('account_locked', { seconds: Math.ceil((c.lockedUntil - Date.now()) / 1000) })
  if (!verifySecret(pin, c.pinHash, c.pinSalt)) {
    const s = await getSettings()
    const failed = c.failedAttempts + 1
    const locked = failed >= s.security.maxFailedAttempts
    await db.creds.update(userId, { failedAttempts: locked ? 0 : failed, lockedUntil: locked ? Date.now() + s.security.lockoutSeconds * 1000 : null })
    if (locked) throw new AppError('account_locked', { seconds: s.security.lockoutSeconds })
    throw new AppError('invalid_credentials', { left: s.security.maxFailedAttempts - failed })
  }
  const user = await db.users.get(userId)
  if (user && !user.active) throw new AppError('account_disabled')
  await db.creds.update(userId, { failedAttempts: 0, lockedUntil: null })
  setApiToken(c.token)
  return c.actor
}

/** Fresh permissions for the signed-in person; `undefined` = can't tell right now (offline) — keep the session. */
export async function refreshActor(userId: string): Promise<Actor | null | undefined> {
  try {
    const r = await api<{ user: Actor }>('GET', '/auth/me')
    if (r.user.id !== userId) return null
    const c = await db.creds.get(userId)
    if (c) await db.creds.update(userId, { actor: r.user })
    return r.user
  } catch (e) {
    if (isOfflineError(e)) return undefined
    if (e instanceof AppError && e.code === 'not_signed_in') return null
    throw e
  }
}

export async function verifyApproval(pin: string, permission: string): Promise<{ id: string; name: string } | null> {
  try {
    return (await api<{ approver: { id: string; name: string } }>('POST', '/auth/approve', { pin, permission })).approver
  } catch (e) {
    if (e instanceof AppError && e.code === 'approval_invalid') return null
    if (!isOfflineError(e)) throw e
  }
  // offline: only supervisors who have signed in on this till can approve
  for (const c of await db.creds.toArray()) {
    if (c.pinHash && c.pinSalt && verifySecret(pin, c.pinHash, c.pinSalt) && hasPerm(c.actor.permissions, permission)) return { id: c.userId, name: c.actor.name }
  }
  return null
}

export async function changeOwnCredentials(input: { currentPin: string; newPin?: string; newPassword?: string }): Promise<void> {
  await api('POST', '/auth/change-credentials', input)
  const a = getActor()
  if (a) {
    const c = await db.creds.get(a.id)
    if (c) await remember(a, c.token ?? '', { pin: input.newPin, password: input.newPassword })
  }
}

export async function logout(): Promise<void> {
  try { await api('POST', '/auth/logout') } catch { /* signing out locally is what matters */ }
}

/* ───────────────────────── accounts & roles ───────────────────────── */

const toPublic = (u: ServerUser): PublicUser => {
  const { pinHash: _a, pinSalt: _b, passwordHash: _c, passwordSalt: _d, ...rest } = userFromServer(u)
  void _a; void _b; void _c; void _d
  return { ...rest, hasPassword: u.hasPassword }
}

export async function saveUser(input: UserInput): Promise<PublicUser> {
  const body = { name: input.name, username: input.username, roleId: input.roleId, active: input.active, color: input.color, pin: input.pin || undefined, password: input.password || undefined, grants: input.grants, denies: input.denies, limits: input.limits }
  const r = input.id ? await api<{ user: ServerUser }>('PUT', `/users/${input.id}`, body) : await api<{ user: ServerUser }>('POST', '/users', body)
  await pullNow()
  return toPublic(r.user)
}

export async function deleteUser(id: string): Promise<void> { await api('DELETE', `/users/${id}`); await db.creds.delete(id); await pullNow() }
export async function resetCredentials(id: string, input: { pin?: string; password?: string }): Promise<void> { await api('POST', `/users/${id}/reset-credentials`, input); await db.creds.delete(id); await pullNow() }
export async function unlockUser(id: string): Promise<void> { await api('POST', `/users/${id}/unlock`); await pullNow() }

export async function saveRole(input: { id?: string; name: string; description: string; permissions: string[]; apps: Role['apps'] }): Promise<Role> {
  const body = { name: input.name, description: input.description, permissions: input.permissions, apps: input.apps }
  const r = input.id ? await api<{ role: Role }>('PUT', `/roles/${input.id}`, body) : await api<{ role: Role }>('POST', '/roles', body)
  await pullNow()
  return r.role
}

export async function deleteRole(id: string): Promise<void> { await api('DELETE', `/roles/${id}`); await pullNow() }

/* ───────────────────────── settings, devices, audit ───────────────────────── */

export async function updateSettings(patch: Record<string, unknown>): Promise<AppSettings> {
  const { device: _d, sync: _s, key: _k, setupDone: _u, ...shop } = patch
  void _d; void _s; void _k; void _u
  await api('PUT', '/settings', shop)
  await pullNow()
  return getSettings()
}

export async function listDevices(): Promise<(Device & { isThis: boolean })[]> {
  const [r, s] = await Promise.all([api<{ devices: ServerDevice[] }>('GET', '/devices'), getSettings()])
  return r.devices.map((d) => ({ id: d.id, name: d.name, code: d.code, registeredAt: d.registeredAt, revoked: d.revoked, isThis: d.id === s.device.id }))
}
export async function updateDevice(id: string, patch: { name: string; code: string }): Promise<void> {
  const r = await api<{ device: ServerDevice }>('PUT', `/devices/${id}`, patch)
  const s = await getSettings()
  if (s.device.id === id) await adoptDevice(r.device)
}
export async function setDeviceRevoked(id: string, revoked: boolean): Promise<void> {
  const s = await getSettings()
  if (s.device.id === id && revoked) throw new AppError('cannot_modify_self')
  await api('POST', `/devices/${id}/${revoked ? 'revoke' : 'restore'}`)
}

export async function listAudit(opts: { limit?: number; action?: string; userId?: string }): Promise<AuditEntry[]> {
  const q = new URLSearchParams()
  if (opts.limit) q.set('limit', String(opts.limit))
  if (opts.action) q.set('action', opts.action)
  if (opts.userId) q.set('userId', opts.userId)
  return (await api<{ entries: AuditEntry[] }>('GET', `/audit?${q}`)).entries
}

/* ───────────────────────── catalogue & stock ───────────────────────── */

export async function saveProduct(input: { product: ProductInput; variants: VariantInput[] }): Promise<string> {
  const { id, ...product } = input.product
  const body = { product, variants: input.variants }
  const r = id ? await api<{ product: { id: string } }>('PUT', `/products/${id}`, body, { timeoutMs: 60_000 }) : await api<{ product: { id: string } }>('POST', '/products', body, { timeoutMs: 60_000 })
  await pullNow()
  return r.product.id
}
export async function setProductActive(id: string, active: boolean): Promise<void> { await api('PATCH', `/products/${id}/active`, { active }); await pullNow() }
export async function deleteProduct(id: string): Promise<'deleted' | 'deactivated'> {
  const r = await api<{ result: 'deleted' | 'deactivated' }>('DELETE', `/products/${id}`)
  await pullNow()
  return r.result
}
export async function bulkPriceUpdate(input: { mode: 'pct' | 'fixed'; value: number; target: 'retail' | 'wholesale' | 'both'; productIds?: string[] }): Promise<number> {
  const r = await api<{ updated: number }>('POST', '/products/bulk-price', { mode: input.mode, value: input.value, target: input.target, productIds: input.productIds })
  await pullNow()
  return r.updated
}
export async function nextBarcode(): Promise<string> { return (await api<{ barcode: string }>('GET', '/products/next-barcode')).barcode }
export async function importCatalog(rows: CsvRow[]): Promise<{ created: number; updated: number }> {
  const r = await api<{ created: number; updated: number }>('POST', '/products/import', { rows }, { timeoutMs: 120_000 })
  await pullNow()
  return { created: r.created, updated: r.updated }
}

export async function adjustStock(input: { variantId: string; newQty: number; reason: 'adjustment' | 'damage'; note: string }): Promise<void> { await api('POST', '/stock/adjust', input); await pullNow() }
export async function receiveStock(items: { variantId: string; qty: number; costIQD?: number }[], note: string): Promise<void> { await api('POST', '/stock/receive', { items, note }); await pullNow() }
export async function markTester(variantId: string, qty: number, note: string): Promise<void> { await api('POST', '/stock/tester', { variantId, qty, note }); await pullNow() }
export async function applyStockCount(lines: StockCountLine[], note: string): Promise<{ changed: number }> {
  const r = await api<{ changed: number }>('POST', '/stock/count', { lines: lines.map((l) => ({ variantId: l.variantId, counted: l.counted })), note })
  await pullNow()
  return r
}
export async function listMovements(opts: { variantId?: string; limit?: number }): Promise<StockMovement[]> {
  const q = new URLSearchParams()
  if (opts.variantId) q.set('variantId', opts.variantId)
  if (opts.limit) q.set('limit', String(opts.limit))
  return (await api<{ movements: StockMovement[] }>('GET', `/stock/movements?${q}`)).movements
}

/* ───────────────────────── customers ───────────────────────── */

/** Online: the server checks the rules (credit limits need `customers.credit`…). `null` = offline, record locally. */
export async function saveCustomer(input: CustomerInput, newId: string): Promise<Customer | null> {
  const body = { name: input.name, phone: input.phone, type: input.type, city: input.city, notes: input.notes, creditLimitIQD: Math.max(0, Math.round(input.creditLimitIQD || 0)) }
  try {
    const r = input.id ? await api<{ customer: Customer }>('PUT', `/customers/${input.id}`, body) : await api<{ customer: Customer }>('POST', '/customers', { ...body, clientId: newId })
    await db.customers.put(r.customer)
    return r.customer
  } catch (e) {
    if (isOfflineError(e)) return null
    throw e
  }
}
export async function deleteCustomer(id: string): Promise<void> { await api('DELETE', `/customers/${id}`); await pullNow() }
export async function customerStatement(id: string): Promise<{ rows: StatementRow[]; sales: Sale[] } | null> {
  try { return await api<{ rows: StatementRow[]; sales: Sale[] }>('GET', `/customers/${id}/statement`) } catch (e) { if (isOfflineError(e)) return null; throw e }
}

/* ───────────────────────── sales, returns, shifts, reports ───────────────────────── */

/** Server rows plus anything this till recorded that hasn't reached the server yet. `null` = offline. */
async function withPending<T extends { id: string }>(entity: 'sale' | 'return' | 'shift', serverRows: T[], local: T[], sortKey: (x: T) => number): Promise<T[]> {
  const seen = new Set(serverRows.map((r) => r.id))
  const pending: T[] = []
  for (const l of local) if (!seen.has(l.id) && (await isPending(entity, l.id))) pending.push(l)
  return [...pending, ...serverRows].sort((a, b) => sortKey(b) - sortKey(a))
}

export async function listSales(f: SaleFilter, local: () => Promise<Sale[]>): Promise<Sale[] | null> {
  const q = new URLSearchParams()
  if (f.from) q.set('from', String(f.from))
  if (f.to) q.set('to', String(f.to))
  if (f.userId) q.set('userId', f.userId)
  if (f.status) q.set('status', f.status)
  if (f.q?.trim()) q.set('q', f.q.trim())
  q.set('limit', String(f.limit ?? 500))
  try {
    const r = await api<{ sales: Sale[] }>('GET', `/sales?${q}`)
    return withPending('sale', r.sales, await local(), (s) => s.createdAt)
  } catch (e) { if (isOfflineError(e)) return null; throw e }
}

/** A sale by id or receipt number from the server, kept locally (returns need it). `undefined` = not found / offline. */
export async function fetchSale(idOrNumber: string): Promise<Sale | undefined> {
  try {
    const s = (await api<{ sale: Sale }>('GET', `/sales/${enc(idOrNumber.trim())}`)).sale
    if (!(await isPending('sale', s.id))) await cacheServerSale(s)
    return s
  } catch (e) {
    if (isOfflineError(e) || (e instanceof AppError && e.code === 'not_found')) return undefined
    throw e
  }
}

/** Void through the server (it re-checks the approval). Used once the sale has reached the server. */
export async function voidSale(saleId: string, reason: string, approvedById: string | null): Promise<Sale> {
  const s = (await api<{ sale: Sale }>('POST', `/sales/${saleId}/void`, { reason, approvedBy: approvedById ? { id: approvedById } : undefined })).sale
  await cacheServerSale(s)
  await pullNow() // stock and the customer's balance changed
  return s
}

export async function listReturns(limit: number, local: () => Promise<SaleReturn[]>): Promise<SaleReturn[] | null> {
  try {
    const r = await api<{ returns: SaleReturn[] }>('GET', '/returns')
    return (await withPending('return', r.returns, await local(), (x) => x.createdAt)).slice(0, limit)
  } catch (e) { if (isOfflineError(e)) return null; throw e }
}

export async function listShifts(local: () => Promise<Shift[]>): Promise<Shift[] | null> {
  try {
    const r = await api<{ shifts: Shift[] }>('GET', '/shifts')
    return withPending('shift', r.shifts, await local(), (s) => s.openedAt)
  } catch (e) { if (isOfflineError(e)) return null; throw e }
}

export async function getShift(id: string): Promise<Shift | undefined> {
  try { return (await api<{ shift: Shift }>('GET', `/shifts/${id}`)).shift } catch (e) { if (isOfflineError(e) || (e instanceof AppError && e.code === 'not_found')) return undefined; throw e }
}

export async function salesReport(from: number, to: number, userId?: string): Promise<SalesReport | null> {
  const q = new URLSearchParams({ from: String(from), to: String(to) })
  if (userId) q.set('userId', userId)
  try { return (await api<{ report: SalesReport }>('GET', `/reports/sales?${q}`)).report } catch (e) { if (isOfflineError(e)) return null; throw e }
}

