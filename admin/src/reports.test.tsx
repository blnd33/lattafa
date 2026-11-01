// @vitest-environment jsdom
/**
 * Admin panel → Reports: periods, how each kind of value is shown, sorting, the Excel file (written, then read back),
 * and the screen against a fake server — including setting a delegate's commission and opening the PDF page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { usePrint } from '@/components/PrintHost'
import { db } from '@/data/db'
import type { Actor } from '@/data/types'
import { translate } from '@/i18n'
import { setApiToken } from '@/services/api'
import { setActor } from '@/services/context'
import { setServerMode } from '@/services/mode'
import { useSession } from '@/store/session'
import { useUI } from '@/store/ui'
import { AdminApp } from './App'
import { presetRange, type ReportTable } from './reports/api'
import { cellText, sortRows } from './reports/format'

vi.mock('@/data/app', () => ({ APP: 'admin', DB_NAME: 'lattafa-admin-reports-test', SESSION_KEY: 'lattafa-admin-session' }))

const t = (k: string, v?: Record<string, string | number>) => translate('en', k, v)
const user = userEvent.setup({ delay: null })
const wait = { timeout: 15000 }
const owner: Actor = {
  id: 'u-owner', name: 'Rand Owner', username: 'owner', roleId: 'role-sa', roleKey: 'super_admin', roleName: 'Super Admin', color: '#D4A548',
  permissions: ['*'], limits: { maxDiscountPct: 100, maxRefundIQD: 10_000_000 }, isSuperAdmin: true,
}

const byProduct: ReportTable = {
  type: 'sales-by-product', from: new Date(2026, 9, 1).getTime(), to: new Date(2026, 9, 31, 23, 59, 59, 999).getTime(), financial: true, summary: [],
  columns: [
    { key: 'product', label: 'rc.product', type: 'name' }, { key: 'size', label: 'rc.size', type: 'text' }, { key: 'units', label: 'rc.units', type: 'int' },
    { key: 'revenue', label: 'rc.revenue', type: 'iqd' }, { key: 'margin', label: 'rc.margin', type: 'pct' },
  ],
  rows: [
    { id: 'v1', product: { en: 'Asad', ar: 'أسد', ku: 'ئەسەد' }, size: '100 ml', units: 3, revenue: 120000, margin: 40 },
    { id: 'v2', product: { en: 'Khamrah', ar: 'خمرة', ku: 'خەمرە' }, size: '100 ml', units: 5, revenue: 225000, margin: 40.5 },
  ],
  totals: { units: 8, revenue: 345000, margin: 40.3 },
}
const commission: ReportTable = {
  type: 'delegate-commission', from: 0, to: 0, financial: true, summary: [],
  columns: [{ key: 'delegate', label: 'rc.delegate', type: 'text' }, { key: 'net', label: 'rc.net', type: 'iqd' }, { key: 'rate', label: 'rc.rate', type: 'pct' }, { key: 'commission', label: 'rc.commission', type: 'iqd' }],
  rows: [{ id: 'u-ahmed', delegate: 'Ahmed', net: 1_000_000, rate: 0, commission: 0 }],
  totals: { net: 1_000_000, commission: 0 },
}

describe('report helpers', () => {
  it('turns a period into its first and last millisecond', () => {
    const now = new Date(2026, 9, 10, 15, 30)
    const day = (y: number, m: number, d: number) => new Date(y, m, d).getTime()
    expect(presetRange('today', now)).toEqual([day(2026, 9, 10), day(2026, 9, 11) - 1])
    expect(presetRange('yesterday', now)).toEqual([day(2026, 9, 9), day(2026, 9, 10) - 1])
    expect(presetRange('7', now)[0]).toBe(day(2026, 9, 4))
    expect(presetRange('month', now)[0]).toBe(day(2026, 9, 1))
    expect(presetRange('last_month', now)).toEqual([day(2026, 8, 1), day(2026, 9, 1) - 1])
    expect(presetRange('year', now)[0]).toBe(day(2026, 0, 1))
  })

  it('shows each kind of value the same way on screen, in the PDF and in messages', () => {
    const c = (type: string, key = 'v') => ({ key, label: 'x', type } as never)
    expect(cellText(c('iqd'), { v: -730000 }, t, 'en')).toBe('−730,000')
    expect(cellText(c('pct'), { v: 40.25 }, t, 'en')).toBe('40.3%')
    expect(cellText(c('money'), { v: 500, currency: 'USD' }, t, 'en')).toBe('$500.00')
    expect(cellText(c('money'), { v: 125000, currency: 'IQD' }, t, 'en')).toBe('125,000 IQD')
    expect(cellText(c('enum:exp.cat_'), { v: 'electricity' }, t, 'en')).toBe('Electricity & generator')
    expect(cellText(c('label'), { v: 'pl.net_profit' }, t, 'en')).toBe('Net profit')
    expect(cellText(c('name'), { v: { en: 'Khamrah', ar: 'خمرة', ku: 'خەمرە' } }, t, 'ar')).toBe('خمرة')
    expect(cellText(c('date', 'lastSold'), { lastSold: null }, t, 'en')).toBe('never') // never sold
    expect(cellText(c('int'), { v: null }, t, 'en')).toBe('—')
  })

  it('sorts numbers by value and keeps empty cells last', () => {
    const col = { key: 'n', label: 'x', type: 'int' as const }
    const rows = [{ n: 2 }, { n: null }, { n: 10 }]
    expect(sortRows(rows, col, -1, t, 'en').map((r) => r.n)).toEqual([10, 2, null])
    expect(sortRows(rows, col, 1, t, 'en').map((r) => r.n)).toEqual([2, 10, null])
  })
})

describe('Reports screen', () => {
  let calls: { method: string; path: string; body: unknown }[] = []
  beforeEach(async () => {
    await db.delete(); await db.open()
    localStorage.clear(); setServerMode(true)
    useUI.setState({ lang: 'en', theme: 'light' })
    setApiToken('tok'); setActor(owner)
    useSession.setState({ actor: owner, token: 'tok', locked: false, lastUserId: owner.id })
    calls = []
    let rate = 0
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      const path = url.replace('/api/v1', '')
      const method = init.method ?? 'GET'
      const body = init.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ method, path, body })
      const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })
      if (path === '/health') return json(200, { ok: true, app: 'lattafa' })
      if (path === '/setup/status') return json(200, { setupDone: true })
      if (path === '/auth/me') return json(200, { user: owner })
      if (path.startsWith('/sync/pull')) return json(500, { error: { code: 'server_error', params: {} } }) // not needed here
      if (path.startsWith('/reports/table/sales-by-day')) return json(200, { ...byProduct, type: 'sales-by-day' })
      if (path.startsWith('/reports/table/delegate-commission')) return json(200, { ...commission, rows: [{ ...commission.rows[0], rate, commission: Math.round(1_000_000 * rate / 100) }] })
      if (path === '/delegates/u-ahmed/commission') { rate = body.pct; return json(200, { ok: true }) }
      return json(404, { error: { code: 'not_found', params: {} } })
    })
  })
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('shows a report for a period, sorts it, sets a commission and opens the PDF page', async () => {
    window.location.hash = '#/reports'
    render(<AdminApp />)
    expect(await screen.findByRole('heading', { name: 'Sales by day' }, wait)).toBeInTheDocument()
    expect(await screen.findByText('225,000', {}, wait)).toBeInTheDocument()
    const first = calls.find((c) => c.path.startsWith('/reports/table/sales-by-day'))!
    const [from, to] = presetRange('30')
    expect(first.path).toBe(`/reports/table/sales-by-day?from=${from}&to=${to}`) // the report's own default period

    // sort by takings: biggest first, then smallest first
    const table = screen.getByRole('table')
    await user.click(within(table).getByRole('button', { name: /Takings/ }))
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('Khamrah')
    await user.click(within(table).getByRole('button', { name: /Takings/ }))
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('Asad')
    expect(within(table).getByText('Total')).toBeInTheDocument()

    // another period asks the server again
    await user.click(screen.getByRole('button', { name: 'Last month' }))
    const [lf, lt] = presetRange('last_month')
    await waitFor(() => expect(calls.some((c) => c.path === `/reports/table/sales-by-day?from=${lf}&to=${lt}`)).toBe(true), wait)

    // PDF: the A4 page goes to the print host
    await user.click(screen.getByRole('button', { name: 'PDF / print' }))
    expect(usePrint.getState().paper).toBe('a4')
    expect(usePrint.getState().node).not.toBeNull()

    // a delegate's commission is typed into the table
    await user.click(screen.getByRole('button', { name: 'Delegate commission' }))
    const input = await screen.findByLabelText('Commission % · Ahmed', {}, wait)
    await user.clear(input); await user.type(input, '5'); await user.tab()
    await waitFor(() => expect(calls.find((c) => c.path === '/delegates/u-ahmed/commission')?.body).toEqual({ pct: 5 }), wait)
    expect(await screen.findAllByText('50,000', {}, wait)).not.toHaveLength(0) // 5% of 1,000,000
  }, 40_000)
})
