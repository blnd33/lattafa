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
import type { Debts } from './debts/api'

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

function debts(period: Debts['period']): Debts {
  return {
    period, from: now - 30 * 86_400_000, to: now,
    receivable: {
      totalIQD: 640_000, customers: 2, overLimit: 1, aging: { age0: 290_000, age31: 0, age61: 0, age91: 350_000 },
      givenIQD: 230_000, givenCount: 3, collectedIQD: 75_000, collectedCount: 1, returnedIQD: 0,
      rows: [
        { id: 'c1', name: 'Noor Shop', phone: '0750 000 0000', type: 'shop', city: 'Duhok', balanceIQD: 500_000, creditLimitIQD: 400_000, age0: 150_000, age31: 0, age61: 0, age91: 350_000, lastDebtAt: now - 86_400_000, lastPaymentAt: null, oldestDays: 1 },
        { id: 'c2', name: 'Shilan Salon', phone: '', type: 'retail', city: '', balanceIQD: 140_000, creditLimitIQD: 0, age0: 140_000, age31: 0, age61: 0, age91: 0, lastDebtAt: now - 3_600_000, lastPaymentAt: now - 7_200_000, oldestDays: 0 },
      ],
    },
    payable: {
      totalIQD: 379_600, owedUSD: 260, owedIQD: 0, rate: 1460, suppliers: 1, boughtIQD: 438_000, boughtCount: 1, paidIQD: 58_400, paidCount: 1,
      rows: [{ id: 's1', name: 'Dubai Perfume House', phone: '', city: 'Dubai', currency: 'USD', active: true, received: 300, paid: 40, balance: 260, balanceIQD: 379_600, lastReceiptAt: now - 86_400_000, lastPaymentAt: now - 3_600_000 }],
    },
    netIQD: 260_400,
    series: { unit: 'day', points: Array.from({ length: 30 }, (_, i) => ({ key: `2026-10-${String(i + 1).padStart(2, '0')}`, givenIQD: i === 29 ? 230_000 : 0, collectedIQD: i === 29 ? 75_000 : 0, boughtIQD: 0, paidIQD: 0 })) },
    activity: [
      { id: 'm1', at: now - 3_600_000, side: 'customer', kind: 'collection', sign: -1, partyId: 'c2', party: 'Shilan Salon', ref: '', amount: 75_000, currency: 'IQD', amountIQD: 75_000, method: 'cash_iqd', by: 'Sara', note: '' },
      { id: 'm2', at: now - 7_200_000, side: 'supplier', kind: 'supplier_payment', sign: -1, partyId: 's1', party: 'Dubai Perfume House', ref: '', amount: 40, currency: 'USD', amountIQD: 58_400, method: 'bank', by: 'Rand Owner', note: 'Transfer' },
    ],
  }
}

function dashboard(period: Dashboard['period']): Dashboard {
  return {
    period, from: now - 3_600_000, to: now, financial: true,
    totals: { count: 12, revenueIQD: 1_250_000, refundsIQD: 0, netIQD: 1_250_000, unitsSold: 19, avgBasketIQD: 104_167, profitIQD: 410_000, creditIQD: 230_000, paidIQD: 1_020_000, collectedIQD: 75_000, receivedIQD: 1_095_000, creditProfitIQD: 80_000 },
    previous: { count: 8, revenueIQD: 1_000_000, netIQD: 1_000_000, profitIQD: 0, creditIQD: 115_000, paidIQD: 885_000, collectedIQD: 0, receivedIQD: 876_000 },
    channels: { store: { count: 9, revenueIQD: 950_000 }, delegate: { count: 3, revenueIQD: 300_000 } },
    series: period === 'today'
      ? { unit: 'hour', points: Array.from({ length: 15 }, (_, h) => ({ key: String(h), storeIQD: h === 10 ? 950_000 : 0, delegateIQD: h === 12 ? 300_000 : 0, count: 0 })) }
      : { unit: 'day', points: Array.from({ length: 7 }, (_, i) => ({ key: `2026-10-0${i + 3}`, storeIQD: 100_000 * i, delegateIQD: 20_000, count: 1 })) },
    topProducts: [{ productId: 'p-kh', name: { en: 'Khamrah', ar: 'خمرة', ku: 'خەمرە' }, brand: 'Lattafa', image: null, art: { c1: '#000', c2: '#111', shape: 'rect' }, units: 7, revenueIQD: 420_000 }],
    lowStock: { count: 1, items: [{ variantId: 'v1', name: { en: 'Asad', ar: 'أسد', ku: 'ئەسەد' }, label: '100 ml', sku: 'AS-100', qty: 0, minStock: 3 }] },
    delegates: [{ id: 'u-ahmed', name: 'Ahmed', color: '#7A9', salesIQD: 300_000, salesCount: 3, collectedIQD: 50_000, lastSeenAt: now - 60_000 }],
    debts: { totalIQD: 640_000, customers: 2, top: [{ id: 'c1', name: 'Noor Shop', phone: '0750 000 0000', balanceIQD: 500_000 }] },
    withDelegates: cashReceived
      ? { totalIQD: 0, cashIQD: 0, cashUSD: 0, rate: 1460, delegates: [] }
      : { totalIQD: 193_000, cashIQD: 120_000, cashUSD: 50, rate: 1460, delegates: [{ id: 'u-ahmed', name: 'Ahmed', color: '#7A9', cashIQD: 120_000, cashUSD: 50, valueIQD: 193_000, days: 2, oldestDay: '2026-10-08' }] },
    expensesIQD: 150_000,
    expenses: {
      totalIQD: 135_000, count: 2, delegateIQD: 15_000,
      byCategory: [{ category: 'electricity', amountIQD: 125_000, count: 1 }, { category: 'food', amountIQD: 10_000, count: 1 }],
      recent: [{ id: 'e1', category: 'electricity', amount: 125_000, currency: 'IQD', rate: 1, amountIQD: 125_000, method: 'cash', note: 'Generator', spentAt: now - 3_600_000, userId: owner.id, userName: 'Rand Owner' }],
      allTimeIQD: 2_480_000, allTimeCount: 31,
    },
    suppliers: { owedUSD: 260, owedIQD: 0, totalIQD: 379_600, rate: 1460, suppliers: 1, top: [{ id: 's1', name: 'Dubai Perfume House', currency: 'USD', balance: 260, balanceIQD: 379_600 }] },
    attention: { openRequests: 2, pendingClosings: 0, salesToReview: 0, ordersWaiting: 1 },
  }
}

let calls: { method: string; path: string; body: unknown; headers: Record<string, string> }[] = []
let cashReceived = false
let reviewed = false
let assistantKey = false
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
  cashReceived = false
  reviewed = false
  assistantKey = false
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
    if (path === '/assistant/status') return json(200, { configured: assistantKey, model: assistantKey ? 'claude-opus-5-5' : null })
    if (path.startsWith('/reports/table/sales-by-product?')) {
      return json(200, {
        type: 'sales-by-product', from: 0, to: now, financial: true, totals: null, summary: [],
        columns: [{ key: 'product', label: 'rc.product', type: 'name' }, { key: 'size', label: 'rc.size', type: 'text' }, { key: 'units', label: 'rc.units', type: 'int' }, { key: 'revenue', label: 'rc.revenue', type: 'iqd' }],
        rows: [{ product: { en: 'Asad', ar: 'أسد', ku: 'ئەسەد' }, size: '100 ml', units: 17, revenue: 714000 }, { product: { en: 'Khamrah', ar: 'خمرة', ku: 'خەمرە' }, size: '100 ml', units: 42, revenue: 2520000 }],
      })
    }
    if (path === '/assistant/chat') {
      const lines = [
        { type: 'tool', name: 'run_report' },
        { type: 'answer', text: 'Your best seller this month is **Khamrah**.\n\n| Perfume | Bottles |\n|---|---|\n| Khamrah | 42 |\n| Asad | 17 |' },
      ]
      return new Response(lines.map((l) => JSON.stringify(l)).join('\n') + '\n', { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } })
    }
    if (path === '/delegates/u-ahmed/receive-cash') { cashReceived = true; return json(200, { days: ['2026-10-08', '2026-10-09'], cashIQD: 120_000, cashUSD: 50 }) }
    const m = /^\/dashboard\?period=(\w+)$/.exec(path)
    if (m) return json(200, dashboard(m[1] as Dashboard['period']))
    if (path.startsWith('/expenses?')) {
      const all = path.startsWith('/expenses?from=0&')
      return json(200, { from: 0, to: now, count: all ? 31 : 2, totalIQD: all ? 2_480_000 : 135_000, delegateIQD: 0, expenses: dashboard('today').expenses!.recent, byCategory: dashboard('today').expenses!.byCategory })
    }
    const dm = /^\/debts\?period=(\w+)$/.exec(path)
    if (dm) return json(200, debts(dm[1] as Debts['period']))
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

    // the headline is money that came in: paid on the bills plus old debt paid back; what went on debt waits
    expect(await screen.findByText('1,095,000', {}, wait)).toBeInTheDocument()
    expect(screen.getByText('Sold 1,250,000 · 230,000 not paid yet · incl. 75,000 of old debt')).toBeInTheDocument()
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
    // everything still owed, opening the debts to collect it
    expect(screen.getByText('Not collected yet').closest('a')).toHaveAttribute('href', '#/debts')
    expect(screen.getByText('Not collected yet').closest('a')).toHaveTextContent('640,000')
    expect(screen.getByText('+230,000 new · 75,000 of old debt collected')).toBeInTheDocument()
    expect(screen.getByText('33% of sales · 80,000 of it not paid yet · 260,000 after expenses')).toBeInTheDocument() // profit 410,000 − expenses 150,000
    // cash the delegates still hold, until the shop receives it
    expect(screen.getByText('120,000 IQD + $50.00 · not handed over yet')).toBeInTheDocument()
    await user.click(screen.getByText('With delegates'))
    const cash = await screen.findByRole('dialog', {}, wait)
    expect(within(cash).getByText(/^2 days not handed over · since /)).toBeInTheDocument()
    await user.click(within(cash).getByRole('button', { name: 'Received' }))
    const ask = await screen.findByRole('dialog', { name: 'Received from Ahmed?' }, wait)
    await user.click(within(ask).getByRole('button', { name: 'Received' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/delegates/u-ahmed/receive-cash')).toBe(true), wait)
    expect(await screen.findByText('No cash is waiting with the delegates.', {}, wait)).toBeInTheDocument()
    expect(screen.getByText('Everything handed over')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.getByText('Orders waiting to arrive').closest('a')).toHaveAttribute('href', '#/purchasing')

    // another period
    await user.click(screen.getByRole('button', { name: '7 days' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/dashboard?period=week')).toBe(true), wait)
    expect(await screen.findAllByText('vs the 7 days before', {}, wait)).toHaveLength(2) // money received and bills

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

  it('shows debts both ways on their own screen', async () => {
    render(<AdminApp />)
    await user.type(await screen.findByLabelText('Username', {}, wait), 'owner')
    await user.type(screen.getByLabelText('Password'), 'right password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await screen.findByRole('heading', { name: /Good (morning|afternoon|evening), Rand/ }, wait)

    const nav = screen.getByRole('navigation', { name: 'Main' })
    await user.click(within(nav).getByRole('link', { name: 'Debts' }))
    expect(await screen.findByRole('heading', { name: 'Debts', level: 1 }, wait)).toBeInTheDocument()
    expect(await screen.findByText('Customers owe the shop', {}, wait)).toBeInTheDocument()
    expect(calls.some((c) => c.path === '/debts?period=month')).toBe(true)
    expect(screen.getByText('640,000')).toBeInTheDocument()
    expect(screen.getByText('The shop owes suppliers')).toBeInTheDocument()
    expect(screen.getByText('260,400')).toBeInTheDocument()                                // net position
    expect(screen.getByText('Customers owe the shop more than the shop owes its suppliers.')).toBeInTheDocument()
    expect(screen.getByText('Noor Shop')).toBeInTheDocument()
    expect(screen.getByText('Over limit')).toBeInTheDocument()

    // only the old debts
    await user.click(screen.getByRole('button', { name: 'Over 60 days' }))
    expect(screen.queryByText('Shilan Salon')).toBeNull()

    // what the shop owes, and every movement
    const tabs = screen.getByRole('group', { name: 'Debts' })
    await user.click(within(tabs).getByRole('button', { name: 'We owe suppliers' }))
    expect(await screen.findByText('Dubai Perfume House', {}, wait)).toBeInTheDocument()
    await user.click(within(tabs).getByRole('button', { name: 'Movements' }))
    expect(await screen.findByText('Payment collected · Shilan Salon', {}, wait)).toBeInTheDocument()
    expect(screen.getByText('Paid to supplier · Dubai Perfume House')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '90 days' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/debts?period=quarter')).toBe(true), wait)
  }, 30_000)

  it('the expenses card opens the expenses screen: everything recorded, and the form to add one', async () => {
    render(<AdminApp />)
    await user.type(await screen.findByLabelText('Username', {}, wait), 'owner')
    await user.type(screen.getByLabelText('Password'), 'right password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await screen.findByRole('heading', { name: /Good (morning|afternoon|evening), Rand/ }, wait)

    expect(await screen.findByText('Spent today', {}, wait)).toBeInTheDocument()
    expect(screen.getAllByText('150,000')).toHaveLength(2)                                    // shop 135,000 + delegates 15,000: the tile and the card
    expect(screen.getAllByText("includes 15,000 of delegates' road expenses")).toHaveLength(2) // the tile and the card
    expect(screen.getByText('· Generator')).toBeInTheDocument()                               // the latest entry

    // everything ever recorded
    await user.click(screen.getByRole('link', { name: 'All time: 2,480,000 IQD · 31 expenses' }))
    expect(await screen.findByText('Spent since the first expense', {}, wait)).toBeInTheDocument()
    expect(calls.some((c) => c.path.startsWith('/expenses?from=0&'))).toBe(true)
    expect(screen.getByText('2,480,000')).toBeInTheDocument()

    // back on the dashboard, "Add expense" opens the form straight away
    await user.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Dashboard' }))
    await user.click(await screen.findByRole('link', { name: 'Add expense' }, wait))
    expect(await screen.findByRole('dialog', { name: 'Add expense' }, wait)).toBeInTheDocument()
  }, 30_000)

  it('the assistant answers its built-in questions from the figures, free and without a key', async () => {
    render(<AdminApp />)
    await user.type(await screen.findByLabelText('Username', {}, wait), 'owner')
    await user.type(screen.getByLabelText('Password'), 'right password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await screen.findByRole('heading', { name: /Good (morning|afternoon|evening), Rand/ }, wait)

    await user.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Assistant' }))
    expect(await screen.findByText('Choose the period, then tap a question.', {}, wait)).toBeInTheDocument()
    expect(screen.queryByLabelText('Ask about sales, profit, stock, debts…')).toBeNull()        // no typing without a key
    expect(screen.getByText(/Typing your own questions needs a Claude API key/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '30 days' }))
    await user.click(screen.getByRole('button', { name: 'Best-selling perfumes' }))
    expect(await screen.findByText('Best-selling perfumes · 30 days', {}, wait)).toBeInTheDocument()
    const rows = await screen.findAllByRole('row', {}, wait)
    expect(rows[1]).toHaveTextContent('Khamrah')                                              // most bottles first
    expect(rows[1]).toHaveTextContent('2,520,000')
    expect(rows[2]).toHaveTextContent('Asad')
    const report = calls.find((c) => c.path.startsWith('/reports/table/sales-by-product?'))!
    const [from, to] = [...report.path.matchAll(/=(\d+)/g)].map((m) => Number(m[1]))
    expect(Math.round((to - from) / 86_400_000)).toBe(30)
    expect(calls.some((c) => c.path === '/assistant/chat')).toBe(false)                       // nothing went to the AI
  }, 30_000)

  it('with a Claude key, typed questions are answered too, with the conversation so far', async () => {
    assistantKey = true
    render(<AdminApp />)
    await user.type(await screen.findByLabelText('Username', {}, wait), 'owner')
    await user.type(screen.getByLabelText('Password'), 'right password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await screen.findByRole('heading', { name: /Good (morning|afternoon|evening), Rand/ }, wait)
    await user.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Assistant' }))

    await user.type(await screen.findByLabelText('Ask about sales, profit, stock, debts…', {}, wait), 'What is my best seller this month?')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByRole('cell', { name: 'Khamrah' }, wait)).toBeInTheDocument()
    expect(screen.getByText('Khamrah', { selector: 'strong' })).toBeInTheDocument()
    const sent = calls.find((c) => c.path === '/assistant/chat')!
    expect(sent.body).toEqual({ messages: [{ role: 'user', content: 'What is my best seller this month?' }] })
    expect(sent.headers.Authorization).toBe('Bearer tok-u-owner')

    await user.type(screen.getByLabelText('Ask about sales, profit, stock, debts…'), 'And last month?')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(calls.filter((c) => c.path === '/assistant/chat')).toHaveLength(2), wait)
    expect((calls.filter((c) => c.path === '/assistant/chat')[1].body as { messages: unknown[] }).messages).toHaveLength(3)
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
