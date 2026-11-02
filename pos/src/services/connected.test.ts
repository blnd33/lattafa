/**
 * Connected mode against a fake server (fetch is stubbed): pulling into the mirror, pushing the outbox,
 * offline PIN sign-in, and merging server lists with what this till hasn't sent yet.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/data/db'
import type { Actor, Role, Sale } from '@/data/types'
import { makeCredential } from '@/lib/credentials'
import { setApiDevice, setApiToken, getApiToken } from './api'
import { setActor, isAppError } from './context'
import { applyPull, type PullPayload, type ServerProduct, type ServerUser } from './mirror'
import { setServerMode } from './mode'
import { pullNow, pushOutbox, queueOutbox, pendingCount } from './sync'
import { loginWithPin } from './auth'
import { listSales } from './sales'
import { DEFAULT_SETTINGS } from './settings'

const DEVICE = '11111111-1111-4111-8111-111111111111'
const now = Date.now()

const role = (key: string, permissions: string[]): Role => ({ id: `role-${key}`, key, name: key, description: '', permissions, apps: ['pos'], isSystem: true, createdAt: now, updatedAt: now })
const user = (id: string, name: string, roleId: string): ServerUser => ({
  id, name, username: name.toLowerCase(), roleId, active: true, color: '#D4A548', hasPassword: true, grants: [], denies: [],
  limits: { maxDiscountPct: 10, maxRefundIQD: 50000 }, failedAttempts: 0, lockedUntil: null, lastLoginAt: null, createdAt: now, updatedAt: now, createdBy: null,
})
const product = (id: string, en: string, variants: { id: string; stock: number; retail: number }[]): ServerProduct => ({
  id, name: { en, ar: en, ku: en }, description: { en: '', ar: '', ku: '' }, brand: 'Lattafa', category: 'perfume', gender: 'unisex', concentration: 'EDP',
  scentFamilies: [], notes: { top: [], heart: [], base: [] }, season: 'all', longevity: 3, sillage: 3, image: null, art: { c1: '#000', c2: '#111', shape: 'rect' },
  showOnMenu: true, featured: false, isNew: false, active: true, createdAt: now, updatedAt: now,
  variants: variants.map((v) => ({ id: v.id, productId: id, label: '100 ml', size: 100, unit: 'ml' as const, ml: 100, sku: `SKU-${v.id}`, barcode: `200${v.id}`, costIQD: 0, retailIQD: v.retail, wholesaleIQD: v.retail, minStock: 2, isTester: false, active: true, stock: v.stock })),
})

function payload(over: Partial<PullPayload> = {}): PullPayload {
  const { key: _k, device: _d, sync: _s, ...settings } = DEFAULT_SETTINGS
  void _k; void _d; void _s
  return {
    serverTime: now, since: 0,
    settings: { ...settings, setupDone: true, store: { ...settings.store, name: 'Server Shop' } },
    roles: [role('super_admin', ['*']), role('cashier', ['pos.sell', 'sales.view_own'])],
    users: [user('u-owner', 'Owner', 'role-super_admin'), user('u-ali', 'Ali', 'role-cashier')],
    products: [product('p-kh', 'Khamrah', [{ id: 'v-kh', stock: 10, retail: 45000 }])],
    customers: [{ id: 'c-noor', name: 'Noor', phone: '', type: 'shop', city: '', notes: '', balanceIQD: 100000, creditLimitIQD: 500000, points: 0, active: true, createdAt: now, updatedAt: now }],
    deleted: { products: [], users: [], roles: [] },
    device: { id: DEVICE, name: 'Counter 1', code: 'ST7', registeredAt: now, revoked: false },
    counters: { sale: 41, return: 3 },
    ...over,
  }
}

type Handler = (method: string, path: string, body: unknown) => { status: number; body: unknown } | 'offline'
let handler: Handler
let calls: { method: string; path: string; body: unknown }[] = []

beforeEach(async () => {
  await db.delete()
  await db.open()
  calls = []
  handler = () => ({ status: 404, body: { error: { code: 'not_found', params: {} } } })
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = url.replace('/api/v1', '')
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method: init.method ?? 'GET', path, body })
    const r = handler(init.method ?? 'GET', path, body)
    if (r === 'offline') throw new TypeError('Failed to fetch')
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } })
  })
  await db.settings.put({ ...structuredClone(DEFAULT_SETTINGS), device: { ...DEFAULT_SETTINGS.device, id: DEVICE }, sync: { mode: 'server', serverUrl: '', lastPullAt: 0 } })
  setServerMode(true)
  setApiDevice(DEVICE)
  setApiToken('tok-owner')
})

afterEach(() => {
  vi.unstubAllGlobals()
  setServerMode(false)
  setApiToken(null)
  setActor(null)
})

async function expectCode(p: Promise<unknown>, code: string) {
  try { await p } catch (e) { expect(isAppError(e) ? e.code : String(e)).toBe(code); return }
  throw new Error(`expected AppError(${code})`)
}

describe('mirror (pull)', () => {
  it('a full pull fills the local database — without any credential material', async () => {
    await applyPull(payload())
    expect(await db.products.count()).toBe(1)
    expect((await db.stock.get(['v-kh', 'loc-store']))?.qty).toBe(10)
    const owner = await db.users.get('u-owner')
    expect(owner).toMatchObject({ name: 'Owner', pinHash: '', pinSalt: '', passwordSalt: null })
    const s = await db.settings.get('app')
    expect(s).toMatchObject({ setupDone: true, store: { name: 'Server Shop' }, device: { id: DEVICE, code: 'ST7' }, sync: { mode: 'server', lastPullAt: now } })
    // receipt numbers continue after what the server already has for this till
    expect((await db.counters.get('sale:ST7'))?.value).toBe(41)
    expect((await db.counters.get('return:ST7'))?.value).toBe(3)
  })

  it('stock and balances keep what this till has not sent yet', async () => {
    await applyPull(payload())
    const sale = { id: 's-pending', number: 'ST7-000042', items: [{ variantId: 'v-kh', qty: 3 }], customerId: 'c-noor', dueIQD: 20000, status: 'completed' } as unknown as Sale
    await db.sales.put(sale)
    await queueOutbox('sale', sale.id)
    await db.collections.put({ id: 'col-1', customerId: 'c-noor', amountIQD: 5000, method: 'cash_iqd', shiftId: null, userId: 'u-ali', note: '', createdAt: now })
    await queueOutbox('collection', 'col-1')

    await applyPull(payload({ since: now - 1000, serverTime: now + 1000 })) // server still says 10 and 100,000
    expect((await db.stock.get(['v-kh', 'loc-store']))?.qty).toBe(7)
    expect((await db.customers.get('c-noor'))?.balanceIQD).toBe(100000 + 20000 - 5000)
  })

  it('a full pull removes data the server no longer has, but keeps customers created offline', async () => {
    await applyPull(payload())
    await db.customers.put({ id: 'c-offline', name: 'New', phone: '', type: 'retail', city: '', notes: '', balanceIQD: 0, creditLimitIQD: 0, points: 0, active: true, createdAt: now, updatedAt: now })
    await queueOutbox('customer', 'c-offline')
    await applyPull(payload({ products: [], customers: [] }))
    expect(await db.products.count()).toBe(0)
    expect(await db.customers.get('c-offline')).toBeTruthy()
    expect(await db.customers.get('c-noor')).toBeUndefined()
  })

  it('deleted and disabled accounts lose their offline sign-in on this till', async () => {
    await applyPull(payload())
    const pin = makeCredential('2222')
    await db.creds.put({ userId: 'u-ali', actor: {} as Actor, token: 't', pinHash: pin.hash, pinSalt: pin.salt, passwordHash: null, passwordSalt: null, failedAttempts: 0, lockedUntil: null, updatedAt: now })
    await applyPull(payload({ since: now, users: [user('u-owner', 'Owner', 'role-super_admin'), { ...user('u-ali', 'Ali', 'role-cashier'), active: false }] }))
    expect(await db.creds.get('u-ali')).toBeUndefined()
  })
})

describe('mirror repairs itself', () => {
  const sku = (p: ServerProduct, s: string): ServerProduct => ({ ...p, variants: p.variants.map((v) => ({ ...v, sku: s })) })
  const khamrah = product('p-kh', 'Khamrah', [{ id: 'v-kh', stock: 10, retail: 45000 }])
  const asad = product('p-as', 'Asad', [{ id: 'v-as', stock: 7, retail: 42000 }])
  const pulls = () => calls.filter((c) => c.path.startsWith('/sync/pull')).map((c) => c.path)
  /** The server answers a full pull with `all`, and anything else with `changes`. */
  const serve = (all: Partial<PullPayload>, changes: Partial<PullPayload>) => {
    handler = (_m, path) => ({ status: 200, body: payload({ serverTime: now + 5000, ...(path.endsWith('since=0') ? all : { since: now, ...changes }) }) })
  }
  beforeEach(async () => { await applyPull(payload({ products: [khamrah, asad] })) })

  it('a product deleted and added again with the same SKU comes through in one pull', async () => {
    const again = sku(product('p-new', 'Khamrah', [{ id: 'v-new', stock: 6, retail: 45000 }]), 'SKU-v-kh')
    serve({}, { products: [again], deleted: { products: ['p-kh'], users: [], roles: [] } })
    await pullNow()
    expect(pulls()).toHaveLength(1)
    expect((await db.variants.where('sku').equals('SKU-v-kh').first())?.id).toBe('v-new')
    expect((await db.stock.get(['v-new', 'loc-store']))?.qty).toBe(6)
    expect(await db.stock.get(['v-kh', 'loc-store'])).toBeUndefined()
  })

  it('changes that break the SKU index fetch everything, once, and later pulls work again', async () => {
    const swapped = [sku(khamrah, 'SKU-v-as'), sku(asad, 'SKU-v-kh')]
    serve({ products: swapped }, { products: swapped })
    await pullNow()
    expect(pulls()).toEqual([`/sync/pull?since=${now}`, '/sync/pull?since=0'])
    expect((await db.variants.get('v-kh'))?.sku).toBe('SKU-v-as')
    expect((await db.stock.get(['v-as', 'loc-store']))?.qty).toBe(7)
    expect((await db.settings.get('app'))?.sync.lastPullAt).toBe(now + 5000)
    await pullNow()
    expect(pulls()[2]).toBe(`/sync/pull?since=${now + 5000}`)
  })

  it('a copy that lost its catalogue gets it back without clearing anything by hand', async () => {
    await db.products.clear(); await db.variants.clear(); await db.stock.clear()
    const catalog = { products: 2, variants: 2 }
    serve({ products: [khamrah, asad], catalog }, { products: [], catalog })
    await pullNow()
    expect(await db.products.count()).toBe(2)
    expect((await db.stock.get(['v-kh', 'loc-store']))?.qty).toBe(10)
  })

  it('a copy in step with the server is not downloaded again', async () => {
    serve({}, { products: [], catalog: { products: 2, variants: 2 } })
    await pullNow()
    expect(pulls()).toHaveLength(1)
  })

  it('a repair keeps sales still waiting to be sent', async () => {
    const sale = { id: 's-pending', number: 'ST7-000042', items: [{ variantId: 'v-kh', qty: 3 }], customerId: null, dueIQD: 0, status: 'completed' } as unknown as Sale
    await db.sales.put(sale)
    await queueOutbox('sale', sale.id)
    const swapped = [sku(khamrah, 'SKU-v-as'), sku(asad, 'SKU-v-kh')]
    serve({ products: swapped }, { products: swapped })
    await pullNow()
    expect(await pendingCount()).toBe(1)
    expect((await db.stock.get(['v-kh', 'loc-store']))?.qty).toBe(7)
  })

  it('no connection: the copy stays as it is, with no full download', async () => {
    handler = () => 'offline'
    await expectCode(pullNow(), 'offline')
    expect(pulls()).toHaveLength(1)
    expect(await db.products.count()).toBe(2)
  })
})

describe('outbox (push)', () => {
  it('sends each record once, oldest first, and handles every result', async () => {
    await db.sales.put({ id: 's1', number: 'ST7-000001' } as unknown as Sale)
    await db.returns.put({ id: 'r1' } as never)
    await db.shifts.put({ id: 'sh1' } as never)
    await queueOutbox('shift', 'sh1')
    await queueOutbox('sale', 's1')
    await queueOutbox('sale', 's1') // e.g. sold, then voided — still one record to send
    await queueOutbox('return', 'r1')
    handler = (_m, path, body) => {
      if (path !== '/sync/push') return { status: 404, body: {} }
      const items = (body as { items: { entity: string; id: string }[] }).items
      return {
        status: 200,
        body: {
          serverTime: now,
          results: items.map((i) => ({ entity: i.entity, id: i.id, status: i.entity === 'sale' ? 'ok' : i.entity === 'return' ? 'rejected' : 'retry', code: i.entity === 'return' ? 'number_taken' : 'sale_not_synced' })),
        },
      }
    }
    const r = await pushOutbox()
    expect(r).toEqual({ pushed: 1, failed: 1 })
    const sent = calls[0].body as { items: { entity: string; id: string }[] }
    expect(sent.items.map((i) => `${i.entity}:${i.id}`)).toEqual(['shift:sh1', 'sale:s1', 'return:r1'])
    const rows = await db.outbox.toArray()
    expect(rows.find((x) => x.entity === 'sale')).toBeUndefined()
    expect(rows.find((x) => x.entity === 'return')).toMatchObject({ status: 'failed', lastError: 'number_taken' })
    expect(rows.find((x) => x.entity === 'shift')).toMatchObject({ status: 'pending', attempts: 1 })
    expect(await pendingCount()).toBe(2) // failed items stay visible until a manager looks at them
  })
})

describe('sign-in', () => {
  const actor: Actor = { id: 'u-ali', name: 'Ali', username: 'ali', roleId: 'role-cashier', roleKey: 'cashier', roleName: 'Cashier', color: '#000', permissions: ['pos.sell'], limits: { maxDiscountPct: 10, maxRefundIQD: 0 }, isSuperAdmin: false }

  it('online: the server checks the PIN; the till remembers the person for offline use', async () => {
    await applyPull(payload())
    handler = (_m, path) => path === '/auth/pin-login'
      ? { status: 200, body: { token: 'tok-ali', user: actor, device: payload().device } }
      : path.startsWith('/sync/pull') ? { status: 200, body: payload({ since: 1 }) } : { status: 404, body: {} }
    const a = await loginWithPin('u-ali', '2222')
    expect(a.name).toBe('Ali')
    expect(getApiToken()).toBe('tok-ali')
    const c = await db.creds.get('u-ali')
    expect(c?.token).toBe('tok-ali')
    expect(c?.pinHash).toBeTruthy()
    expect(c?.pinHash).not.toContain('2222')
  })

  it('offline: someone who signed in here before can continue with the same PIN — nobody else', async () => {
    await applyPull(payload())
    const pin = makeCredential('2222')
    await db.creds.put({ userId: 'u-ali', actor, token: 'tok-ali', pinHash: pin.hash, pinSalt: pin.salt, passwordHash: null, passwordSalt: null, failedAttempts: 0, lockedUntil: null, updatedAt: now })
    handler = () => 'offline'
    setApiToken(null)
    expect((await loginWithPin('u-ali', '2222')).id).toBe('u-ali')
    expect(getApiToken()).toBe('tok-ali')
    await expectCode(loginWithPin('u-ali', '9999'), 'invalid_credentials')
    await expectCode(loginWithPin('u-owner', '1111'), 'offline_first_login')
  })

  it('a wrong PIN online is the server’s answer, not a reason to try offline', async () => {
    await applyPull(payload())
    const pin = makeCredential('2222')
    await db.creds.put({ userId: 'u-ali', actor, token: 'tok-ali', pinHash: pin.hash, pinSalt: pin.salt, passwordHash: null, passwordSalt: null, failedAttempts: 0, lockedUntil: null, updatedAt: now })
    handler = () => ({ status: 403, body: { error: { code: 'account_disabled', params: {} } } })
    await expectCode(loginWithPin('u-ali', '2222'), 'account_disabled') // the cached PIN must not override the server
  })
})

describe('lists across tills', () => {
  it('sales history = the server’s list + this till’s unsent sales; offline = this till only', async () => {
    await applyPull(payload())
    setActor({ id: 'u-owner', name: 'Owner', username: 'owner', roleId: 'role-super_admin', roleKey: 'super_admin', roleName: 'Super Admin', color: '#000', permissions: ['*'], limits: { maxDiscountPct: 100, maxRefundIQD: 1e9 }, isSuperAdmin: true })
    const mk = (id: string, number: string, createdAt: number) => ({ id, number, createdAt, userId: 'u-owner', status: 'completed', customerName: '', items: [] }) as unknown as Sale
    await db.sales.put(mk('local-sent', 'ST7-000001', now - 3000)) // already on the server
    await db.sales.put(mk('local-unsent', 'ST7-000002', now))
    await queueOutbox('sale', 'local-unsent')
    handler = (_m, path) => path.startsWith('/sales') ? { status: 200, body: { sales: [mk('local-sent', 'ST7-000001', now - 3000), mk('other-till', 'ST2-000009', now - 1000)] } } : { status: 404, body: {} }
    expect((await listSales()).map((s) => s.number)).toEqual(['ST7-000002', 'ST2-000009', 'ST7-000001'])
    handler = () => 'offline'
    expect((await listSales()).map((s) => s.number)).toEqual(['ST7-000002', 'ST7-000001'])
  })
})
