// @vitest-environment jsdom
/**
 * The admin panel against a fake shop server (fetch is stubbed): sign in as the owner without the computer becoming a
 * till, see the dashboard, switch the period, sign out.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { db } from '@/data/db'
import type { Actor, Role } from '@/data/types'
import { setApiToken } from '@/services/api'
import { setActor } from '@/services/context'
import type { PullPayload } from '@/services/mirror'
import { setServerMode } from '@/services/mode'
import { DEFAULT_SETTINGS } from '@/services/settings'
import { useSession } from '@/store/session'
import { useUI } from '@/store/ui'
import { AdminApp } from './App'
import type { Dashboard } from './dashboard/api'

// jsdom's page is "/", not "/admin/": tell the shared code it runs as the admin panel (the path check itself is in lib.test.ts)
vi.mock('@/data/app', () => ({ APP: 'admin', DB_NAME: 'lattafa-admin-test', SESSION_KEY: 'lattafa-admin-session' }))

const user = userEvent.setup({ delay: null })
const wait = { timeout: 15000 }
const now = Date.now()

const owner: Actor = {
  id: 'u-owner', name: 'Rand Owner', username: 'owner', roleId: 'role-sa', roleKey: 'super_admin', roleName: 'Super Admin', color: '#D4A548',
  permissions: ['*'], limits: { maxDiscountPct: 100, maxRefundIQD: 10_000_000 }, isSuperAdmin: true,
}
const watcher: Actor = {
  id: 'u-watch', name: 'Quiet Watcher', username: 'watch', roleId: 'role-watch', roleKey: 'watcher', roleName: 'Activity only', color: '#8A9',
  permissions: ['audit.view'], limits: { maxDiscountPct: 0, maxRefundIQD: 0 }, isSuperAdmin: false,
}
const audit = [
  { id: 'a1', userId: owner.id, userName: 'Rand Owner', action: 'prices.bulk', entity: 'product', entityId: '*', meta: { from: 35000, to: 41000, products: 12 }, createdAt: now - 60_000 },
  { id: 'a2', userId: 'u-ali', userName: 'Ali', action: 'device.register', entity: 'device', entityId: 'd1', meta: { name: 'Front desk', code: 'ST2' }, createdAt: now - 120_000 },
]
const role: Role = { id: 'role-sa', key: 'super_admin', name: 'Super Admin', description: '', permissions: ['*'], apps: ['pos', 'admin', 'delegate'], isSystem: true, createdAt: now, updatedAt: now }
const watcherRole: Role = { id: 'role-watch', key: 'watcher', name: 'Activity only', description: '', permissions: ['audit.view'], apps: ['admin'], isSystem: false, createdAt: now, updatedAt: now }

function pull(): PullPayload {
  const { key: _k, device: _d, sync: _s, ...settings } = DEFAULT_SETTINGS
  void _k; void _d; void _s
  return {
    serverTime: now, since: 0, settings: { ...settings, setupDone: true },
    roles: [role, watcherRole],
    users: [owner, watcher].map((u) => ({ id: u.id, name: u.name, username: u.username, roleId: u.roleId, active: true, color: u.color, hasPassword: true, grants: [], denies: [],
      limits: u.limits, failedAttempts: 0, lockedUntil: null, lastLoginAt: null, createdAt: now, updatedAt: now, createdBy: null })),
    products: [{
      id: 'p-kh', name: { en: 'Khamrah', ar: 'خمرة', ku: 'خەمرە' }, description: { en: '', ar: '', ku: '' }, brand: 'Lattafa', category: 'perfume', gender: 'unisex', concentration: 'EDP',
      scentFamilies: [], notes: { top: [], heart: [], base: [] }, season: 'all', longevity: 3, sillage: 3, image: null, art: { c1: '#000', c2: '#111', shape: 'rect' },
      showOnMenu: true, featured: false, isNew: false, active: true, createdAt: now, updatedAt: now,
      variants: [{ id: 'v-kh', productId: 'p-kh', label: '100 ml', size: 100, unit: 'ml', ml: 100, sku: 'KH-100', barcode: '2000000000017', costIQD: 30000, retailIQD: 60000, wholesaleIQD: 50000, minStock: 2, isTester: false, active: true, stock: 9 }],
    }],
    customers: [], deleted: { products: [], users: [], roles: [] },
    device: null, counters: null, // the admin panel is not a till
  }
}

function dashboard(period: Dashboard['period']): Dashboard {
  return {
    period, from: now - 3_600_000, to: now, financial: true,
    totals: { count: 12, revenueIQD: 1_250_000, refundsIQD: 0, netIQD: 1_250_000, unitsSold: 19, avgBasketIQD: 104_167, profitIQD: 410_000 },
    previous: { count: 8, revenueIQD: 1_000_000, netIQD: 1_000_000, profitIQD: 0 },
    channels: { store: { count: 9, revenueIQD: 950_000 }, delegate: { count: 3, revenueIQD: 300_000 } },
    series: period === 'today'
      ? { unit: 'hour', points: Array.from({ length: 15 }, (_, h) => ({ key: String(h), storeIQD: h === 10 ? 950_000 : 0, delegateIQD: h === 12 ? 300_000 : 0, count: 0 })) }
      : { unit: 'day', points: Array.from({ length: 7 }, (_, i) => ({ key: `2026-10-0${i + 3}`, storeIQD: 100_000 * i, delegateIQD: 20_000, count: 1 })) },
    topProducts: [{ productId: 'p-kh', name: { en: 'Khamrah', ar: 'خمرة', ku: 'خەمرە' }, brand: 'Lattafa', image: null, art: { c1: '#000', c2: '#111', shape: 'rect' }, units: 7, revenueIQD: 420_000 }],
    lowStock: { count: 1, items: [{ variantId: 'v1', name: { en: 'Asad', ar: 'أسد', ku: 'ئەسەد' }, label: '100 ml', sku: 'AS-100', qty: 0, minStock: 3 }] },
    delegates: [{ id: 'u-ahmed', name: 'Ahmed', color: '#7A9', salesIQD: 300_000, salesCount: 3, collectedIQD: 50_000, lastSeenAt: now - 60_000 }],
    debts: { totalIQD: 640_000, customers: 2, top: [{ id: 'c1', name: 'Noor Shop', phone: '0750 000 0000', balanceIQD: 500_000 }] },
    expensesIQD: 150_000,
    suppliers: { owedUSD: 260, owedIQD: 0, totalIQD: 379_600, rate: 1460, suppliers: 1, top: [{ id: 's1', name: 'Dubai Perfume House', currency: 'USD', balance: 260, balanceIQD: 379_600 }] },
    attention: { openRequests: 2, pendingClosings: 0, salesToReview: 0, ordersWaiting: 1 },
  }
}

let calls: { method: string; path: string; body: unknown; headers: Record<string, string> }[] = []
let reviewed = false
const flagged = {
  id: '5a1e0000-0000-4000-8000-000000000001', number: 'ST2-000077', shiftId: null, userId: owner.id, userName: 'Sara', customerId: null, customerName: '', channel: 'store', status: 'completed',
  items: [], subtotalIQD: 60000, itemDiscountIQD: 0, orderDiscountIQD: 0, orderDiscount: null, giftWrapIQD: 0, taxIQD: 0, roundingIQD: 0, pointsRedeemedIQD: 0, totalIQD: 60000,
  payments: [], paidIQD: 60000, changeIQD: 0, dueIQD: 0, pointsEarned: 0, pointsRedeemed: 0, exchangeRate: 1460, note: '', approvedBy: null, deviceId: null,
  createdAt: now - 3_600_000, voidedAt: null, voidReason: '', flags: ['negative_stock', 'price_mismatch'], needsReview: true, reviewedAt: null, reviewedBy: null, reviewNote: '',
}

beforeEach(async () => {
  await db.delete(); await db.open()
  localStorage.clear(); setActor(null); setApiToken(null)
  useSession.setState({ actor: null, token: null, locked: false, lastUserId: null })
  useUI.setState({ lang: 'en', theme: 'light' })
  setServerMode(true)
  window.location.hash = ''
  calls = []
  reviewed = false
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = url.replace('/api/v1', '')
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method: init.method ?? 'GET', path, body, headers: (init.headers ?? {}) as Record<string, string> })
    const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })
    if (path === '/health') return json(200, { ok: true, app: 'lattafa' })
    if (path === '/setup/status') return json(200, { setupDone: true })
    if (path === '/auth/login') {
      const who = body.username === 'watch' ? watcher : owner
      return body.password === 'right password'
        ? json(200, { token: 'tok-'+who.id, user: who, device: null })
        : json(401, { error: { code: 'invalid_credentials', params: { left: 4 } } })
    }
    // whoever this token belongs to (the panel checks the session is still the same person)
    const bearer = (init.headers as Record<string, string> | undefined)?.Authorization ?? ''
    const signedIn = bearer.includes(watcher.id) ? watcher : owner
    if (path === '/auth/me') return json(200, { user: signedIn })
    if (path.startsWith('/audit')) return json(200, { entries: audit })
    if (path === '/auth/logout') return json(200, { ok: true })
    if (path.startsWith('/sync/pull')) return json(200, pull())
    if (path === '/sync/push') return json(200, { results: [] })
    if (path === '/sales/review') return json(200, { sales: reviewed ? [] : [flagged] })
    if (path === `/sales/${flagged.id}/reviewed`) { reviewed = true; return json(200, { sale: { ...flagged, needsReview: false, reviewedAt: now, reviewedBy: owner.id, reviewNote: body.note } }) }
    const m = /^\/dashboard\?period=(\w+)$/.exec(path)
    if (m) return json(200, dashboard(m[1] as Dashboard['period']))
    return json(404, { error: { code: 'not_found', params: {} } })
  })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Admin panel', () => {
  it('signs the owner in without making the computer a till, shows the dashboard, and signs out', async () => {
    render(<AdminApp />)

    // a wrong password is explained, and the password box is emptied
    await user.type(await screen.findByLabelText('Username', {}, wait), 'owner')
    await user.type(screen.getByLabelText('Password'), 'wrong')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert', {}, wait)).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toHaveValue('')

    await user.type(screen.getByLabelText('Password'), 'right password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    // the dashboard
    expect(await screen.findByRole('heading', { name: /Good (morning|afternoon|evening), Rand/ }, wait)).toBeInTheDocument()
    const login = calls.filter((c) => c.path === '/auth/login').at(-1)!
    expect(login.body).toMatchObject({ username: 'owner', app: 'admin' })
    expect(login.headers['X-Device-Id']).toBeUndefined()             // no till identity is sent
    expect(await db.creds.get(owner.id)).toMatchObject({ passwordHash: null, pinHash: null }) // nothing derived from the password stays here

    expect(await screen.findByText('1,250,000', {}, wait)).toBeInTheDocument()   // sales
    expect(screen.getByText('410,000')).toBeInTheDocument()                     // profit
    expect(screen.getByText('25%')).toBeInTheDocument()                         // +25% vs before
    expect(screen.getByText('Khamrah')).toBeInTheDocument()
    expect(screen.getByText('76%')).toBeInTheDocument()                         // shop share of sales
    expect(screen.getByText('Ahmed')).toBeInTheDocument()
    expect(screen.getByText('Last seen just now')).toBeInTheDocument()
    expect(screen.getByText('Stock requests from delegates').closest('a')).toHaveAttribute('href', '#/delegates') // opens where it is dealt with
    expect(screen.getByText('Stock requests from delegates').closest('a')).toHaveTextContent('2')
    expect(screen.getByText('0 left · alert at 3')).toBeInTheDocument()
    expect(screen.getByText('Noor Shop')).toBeInTheDocument()
    expect(screen.getByText('Dubai Perfume House')).toBeInTheDocument()                  // owed to suppliers
    expect(screen.getByText('33% of sales · 260,000 after expenses')).toBeInTheDocument() // profit 410,000 − expenses 150,000
    expect(screen.getByText('Orders waiting to arrive').closest('a')).toHaveAttribute('href', '#/purchasing')

    // another period
    await user.click(screen.getByRole('button', { name: '7 days' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/dashboard?period=week')).toBe(true), wait)
    expect(await screen.findAllByText('vs the 7 days before', {}, wait)).toHaveLength(2) // sales and bills

    // the POS's own screens, run against the server
    const nav = screen.getByRole('navigation', { name: 'Main' })
    await user.click(within(nav).getByRole('link', { name: 'Products' }))
    expect(await screen.findByText('Khamrah', {}, wait)).toBeInTheDocument()
    await user.click(within(nav).getByRole('link', { name: 'Settings' }))
    expect(await screen.findByRole('button', { name: 'Shop & receipt' }, wait)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Data' })).toBeNull() // the till's own backup/wipe has no place here

    // sales the server flagged: why, and mark one as checked
    await user.click(within(nav).getByRole('link', { name: 'Sales to check' }))
    expect(await screen.findByText('ST2-000077', {}, wait)).toBeInTheDocument()
    expect(screen.getByText('Stock went below zero')).toBeInTheDocument()
    expect(screen.getByText('Different price')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Mark as checked' }))
    await user.type(await screen.findByLabelText('Note (optional)', {}, wait), 'Delivery entered late')
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Mark as checked' }))
    expect(await screen.findByText('Nothing to check. Every flagged sale has been looked at.', {}, wait)).toBeInTheDocument()
    expect(calls.find((c) => c.path.endsWith('/reviewed'))?.body).toEqual({ note: 'Delivery entered late' })

    // sign out ends the session on the server too
    await user.click(screen.getByRole('button', { name: 'Signed in as Rand Owner' }))
    await user.click(await screen.findByRole('button', { name: 'Sign out' }))
    expect(await screen.findByLabelText('Username', {}, wait)).toBeInTheDocument()
    expect(calls.some((c) => c.path === '/auth/logout')).toBe(true)
    expect(useSession.getState().actor).toBeNull()
  }, 30_000)

  it('an account made only to watch lands on the activity log and reaches nothing else', async () => {
    render(<AdminApp />)
    await user.type(await screen.findByLabelText('Username', {}, wait), 'watch')
    await user.type(screen.getByLabelText('Password'), 'right password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    // it lands on Activity: what happened, who did it, when
    expect(await screen.findByRole('heading', { name: 'Activity' }, wait)).toBeInTheDocument()
    expect(await screen.findByText('New till/phone connected', {}, wait)).toBeInTheDocument()
    expect(screen.getByText('Prices changed in bulk')).toBeInTheDocument()
    expect(screen.getByText('Rand Owner')).toBeInTheDocument()

    // …but never the figures behind it
    expect(screen.queryByText(/41,000/)).toBeNull()
    expect(screen.queryByText(/35,000/)).toBeNull()

    // and no other screen is on offer
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).getAllByRole('link').map((l) => l.textContent?.trim())).toEqual(['Activity'])
    window.location.hash = '#/reports'
    expect(await screen.findByRole('heading', { name: 'No access' }, wait)).toBeInTheDocument()
  }, 30_000)
})
