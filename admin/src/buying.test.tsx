// @vitest-environment jsdom
/**
 * Purchasing and expenses in the admin panel against a fake server (fetch is stubbed): order perfume from a supplier,
 * receive part of it, pay the supplier, and add an expense — checking exactly what is sent to the server.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { db } from '@/data/db'
import type { Actor } from '@/data/types'
import { setApiToken } from '@/services/api'
import { setActor } from '@/services/context'
import { applyPull, type PullPayload } from '@/services/mirror'
import { setServerMode } from '@/services/mode'
import { DEFAULT_SETTINGS } from '@/services/settings'
import { useSession } from '@/store/session'
import { useUI } from '@/store/ui'
import { AdminApp } from './App'

vi.mock('@/data/app', () => ({ APP: 'admin', DB_NAME: 'lattafa-admin-buying-test', SESSION_KEY: 'lattafa-admin-session' }))

const user = userEvent.setup({ delay: null })
const wait = { timeout: 15000 }
const now = Date.now()
const owner: Actor = {
  id: 'u-owner', name: 'Rand Owner', username: 'owner', roleId: 'role-sa', roleKey: 'super_admin', roleName: 'Super Admin', color: '#D4A548',
  permissions: ['*'], limits: { maxDiscountPct: 100, maxRefundIQD: 10_000_000 }, isSuperAdmin: true,
}

function pull(): PullPayload {
  const { key: _k, device: _d, sync: _s, ...settings } = DEFAULT_SETTINGS
  void _k; void _d; void _s
  return {
    serverTime: now, since: 0, settings: { ...settings, setupDone: true, currency: { ...settings.currency, rate: 1460 } },
    roles: [{ id: 'role-sa', key: 'super_admin', name: 'Super Admin', description: '', permissions: ['*'], apps: ['pos', 'admin', 'delegate'], isSystem: true, createdAt: now, updatedAt: now }],
    users: [], customers: [], deleted: { products: [], users: [], roles: [] }, device: null, counters: null,
    products: [{
      id: 'p-kh', name: { en: 'Khamrah', ar: 'خمرة', ku: 'خەمرە' }, description: { en: '', ar: '', ku: '' }, brand: 'Lattafa', category: 'perfume', gender: 'unisex', concentration: 'EDP',
      scentFamilies: [], notes: { top: [], heart: [], base: [] }, season: 'all', longevity: 3, sillage: 3, image: null, art: { c1: '#000', c2: '#111', shape: 'rect' },
      showOnMenu: true, featured: false, isNew: false, active: true, createdAt: now, updatedAt: now,
      variants: [{ id: 'v-kh', productId: 'p-kh', label: '100 ml', size: 100, unit: 'ml', ml: 100, sku: 'KH-100', barcode: '2000000000017', costIQD: 27000, retailIQD: 45000, wholesaleIQD: 36000, minStock: 2, isTester: false, active: true, stock: 9 }],
    }],
  }
}

const supplier = { id: 'sup-1', name: 'Dubai Perfume House', phone: '', contact: 'Saeed', city: 'Dubai', currency: 'USD', notes: '', active: true, balance: 260, openOrders: 0, createdAt: now }
const order = (receivedQty: number) => ({
  id: 'po-1', number: 'PO-000001', status: receivedQty ? 'partial' : 'open', currency: 'USD', rate: 1500, supplier: { id: 'sup-1', name: 'Dubai Perfume House', currency: 'USD' },
  total: 185, receivedTotal: receivedQty * 18.5, note: '', orderedAt: now, expectedAt: null, closedAt: null, createdByName: 'Rand Owner', units: 10, receivedUnits: receivedQty,
  items: [{ id: 1, variantId: 'v-kh', productId: 'p-kh', name: { en: 'Khamrah', ar: 'خمرة', ku: 'خەمرە' }, label: '100 ml', sku: 'KH-100', qty: 10, receivedQty, unitCost: 18.5, lineTotal: 185 }],
  receipts: receivedQty ? [{ id: 'r-1', receivedAt: now, userName: 'Rand Owner', rate: 1500, total: receivedQty * 18.5, totalIQD: receivedQty * 27750, note: '', units: receivedQty }] : [],
})

let calls: { method: string; path: string; body: unknown }[] = []
let received = 0
let expenses: unknown[] = []

beforeEach(async () => {
  await db.delete(); await db.open()
  localStorage.clear(); setActor(null)
  setServerMode(true)
  useUI.setState({ lang: 'en', theme: 'light' })
  await applyPull(pull()) // the shop's catalogue is already on this computer
  setApiToken('tok'); setActor(owner)
  useSession.setState({ actor: owner, token: 'tok', locked: false, lastUserId: owner.id })
  calls = []; received = 0; expenses = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = url.replace('/api/v1', '')
    const method = init.method ?? 'GET'
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, path, body })
    const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })
    if (path === '/health') return json(200, { ok: true, app: 'lattafa' })
    if (path === '/setup/status') return json(200, { setupDone: true })
    if (path === '/auth/me') return json(200, { user: owner })
    if (path.startsWith('/sync/pull')) return json(200, { ...pull(), since: 1 })
    if (path === '/sync/push') return json(200, { results: [] })
    if (path === '/suppliers' && method === 'GET') return json(200, { suppliers: [supplier] })
    if (path === '/suppliers/sup-1/statement') {
      return json(200, { supplier, balance: 260, rows: [{ type: 'receipt', id: 'r-1', at: now, amount: 260, balance: 260, orderId: 'po-1', orderNumber: 'PO-000001', method: null, note: '', userName: 'Rand Owner' }] })
    }
    if (path === '/suppliers/sup-1/payments') return json(201, { payment: { id: 'pay-1' } })
    if (path.startsWith('/purchase-orders?')) return json(200, { orders: path.includes('supplierId') ? [order(received)] : [] })
    if (path === '/purchase-orders' && method === 'POST') return json(201, { order: order(0) })
    if (path === '/purchase-orders/po-1') return json(200, { order: order(received) })
    if (path === '/purchase-orders/po-1/receive') { received = body.lines[0].qty; return json(200, { order: order(received) }) }
    if (path.startsWith('/expenses?')) return json(200, { from: 0, to: 0, expenses, totalIQD: expenses.length ? 125000 : 0, byCategory: expenses.length ? [{ category: 'electricity', amountIQD: 125000, count: 1 }] : [], delegateIQD: 15000 })
    if (path === '/expenses' && method === 'POST') {
      const e = { id: 'e-1', ...body, rate: 1460, amountIQD: 125000, userId: owner.id, userName: 'Rand Owner' }
      expenses = [e]
      return json(201, { expense: e })
    }
    return json(404, { error: { code: 'not_found', params: {} } })
  })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Purchasing', () => {
  it('orders perfume from a supplier in dollars and receives part of it', async () => {
    window.location.hash = '#/purchasing'
    render(<AdminApp />)
    expect(await screen.findByText('No orders here yet.', {}, wait)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'New order' }))
    const dialog = await screen.findByRole('dialog', { name: 'New order' }, wait)
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Dubai Perfume House · USD' })).toBeInTheDocument(), wait)
    await user.selectOptions(within(dialog).getByLabelText('Supplier'), 'sup-1')
    await user.type(within(dialog).getByPlaceholderText('Search name, SKU or barcode…'), 'khamr')
    await user.click(await within(dialog).findByRole('button', { name: /Khamrah · 100 ml/ }, wait))
    // today's cost 27,000 IQD at the shop's 1,460 is suggested as $18.49; the invoice says $18.50
    const cost = within(dialog).getByLabelText('Unit cost · Khamrah')
    expect(cost).toHaveValue('18.49')
    await user.clear(cost); await user.type(cost, '18.5')
    const qty = within(dialog).getByLabelText('Qty · Khamrah')
    await user.clear(qty); await user.type(qty, '10')
    await user.type(within(dialog).getByLabelText('Dollar rate (IQD for $1)'), '1500')
    expect(within(dialog).getAllByText('$185.00').length).toBeGreaterThan(0) // line and order total
    await user.click(within(dialog).getByRole('button', { name: 'Save order' }))

    const sent = calls.find((c) => c.path === '/purchase-orders' && c.method === 'POST')!
    expect(sent.body).toEqual({ supplierId: 'sup-1', rate: 1500, note: '', expectedAt: null, receiveNow: false, lines: [{ variantId: 'v-kh', qty: 10, unitCost: 18.5 }] })

    // the saved order opens; four bottles came in the first box
    const detail = await screen.findByRole('dialog', { name: 'PO-000001 · Dubai Perfume House' }, wait)
    await user.click(within(detail).getByRole('button', { name: 'Receive goods' }))
    const rec = await screen.findByRole('dialog', { name: 'Receive goods · PO-000001' }, wait)
    const rq = within(rec).getByLabelText('Qty')
    expect(rq).toHaveValue('10') // all that is left, by default
    await user.clear(rq); await user.type(rq, '4')
    await user.click(within(rec).getByRole('button', { name: 'Receive' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/purchase-orders/po-1/receive')).toBe(true), wait)
    expect(calls.find((c) => c.path === '/purchase-orders/po-1/receive')!.body).toEqual({ lines: [{ itemId: 1, qty: 4, unitCost: 18.5 }], rate: 1500, note: '' })
    await waitFor(() => expect(calls.filter((c) => c.path.startsWith('/sync/pull')).length).toBeGreaterThan(0), wait) // stock refreshed on this computer
    expect(await screen.findByText('4 bottles · Rand Owner', {}, wait)).toBeInTheDocument()
  }, 40_000)

  it('shows what the shop owes a supplier and records a payment', async () => {
    window.location.hash = '#/purchasing/suppliers'
    render(<AdminApp />)
    await user.click(await screen.findByRole('button', { name: /Dubai Perfume House/ }, wait))
    const st = await screen.findByRole('dialog', { name: 'Dubai Perfume House' }, wait)
    expect(await within(st).findByText('Delivery PO-000001', {}, wait)).toBeInTheDocument()
    await user.click(within(st).getByRole('button', { name: 'Record payment' }))
    const pay = await screen.findByRole('dialog', { name: 'Pay Dubai Perfume House' }, wait)
    await user.type(within(pay).getByLabelText('Amount (USD)'), '100')
    await user.selectOptions(within(pay).getByLabelText('Paid by'), 'bank')
    await user.click(within(pay).getByRole('button', { name: 'Record payment' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/suppliers/sup-1/payments')).toBe(true), wait)
    expect(calls.find((c) => c.path === '/suppliers/sup-1/payments')!.body).toMatchObject({ amount: 100, method: 'bank', rate: 1460, purchaseOrderId: null, note: '' })
  }, 40_000)
})

describe('Expenses', () => {
  it('adds an expense and shows the month', async () => {
    window.location.hash = '#/expenses'
    render(<AdminApp />)
    expect(await screen.findAllByText('No expenses in this month.', {}, wait)).toHaveLength(2) // the summary and the list
    expect(screen.getByText('Delegates on the road (from approved daily closings): 15,000 IQD')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add expense' }))
    const dlg = await screen.findByRole('dialog', { name: 'Add expense' }, wait)
    await user.selectOptions(within(dlg).getByLabelText('Category'), 'electricity')
    await user.type(within(dlg).getByLabelText('Amount'), '125000')
    await user.type(within(dlg).getByLabelText('Note'), 'Generator 40 amps')
    await user.click(within(dlg).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/expenses' && c.method === 'POST')).toBe(true), wait)
    expect(calls.find((c) => c.path === '/expenses' && c.method === 'POST')!.body).toMatchObject({ category: 'electricity', currency: 'IQD', amount: 125000, method: 'cash', note: 'Generator 40 amps' })
    expect(await screen.findByText('Generator 40 amps · Cash · by Rand Owner', {}, wait)).toBeInTheDocument()
  }, 40_000)
})
