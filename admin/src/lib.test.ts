import { afterEach, describe, expect, it, vi } from 'vitest'
import { translate } from '@/i18n'
import { ago, change, compact, dayMonth, freshness, greeting, longDate, plural, weekday } from './lib'

const t = (k: string, v?: Record<string, string | number>) => translate('en', k, v)

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

describe('the admin panel keeps its own local data', () => {
  it('uses its own database and sign-in on /admin/, and the POS ones everywhere else', async () => {
    vi.stubGlobal('location', { pathname: '/admin/' })
    vi.resetModules()
    expect(await import('@/data/app')).toMatchObject({ APP: 'admin', DB_NAME: 'lattafa-admin', SESSION_KEY: 'lattafa-admin-session' })

    vi.stubGlobal('location', { pathname: '/pos/' })
    vi.resetModules()
    expect(await import('@/data/app')).toMatchObject({ APP: 'pos', DB_NAME: 'lattafa-pos', SESSION_KEY: 'lattafa-session' })

    vi.stubGlobal('location', { pathname: '/administrator/' }) // only the /admin/ folder itself
    vi.resetModules()
    expect((await import('@/data/app')).APP).toBe('pos')
  })
})

describe('dashboard helpers', () => {
  it('shortens amounts for the chart axis', () => {
    expect([compact(0), compact(950), compact(12_500), compact(450_000), compact(1_250_000), compact(12_400_000)]).toEqual(['0', '950', '12.5K', '450K', '1.25M', '12.4M'])
  })

  it('compares with the period before, but not with nothing', () => {
    expect(change(150, 100)).toBe(50)
    expect(change(50, 100)).toBe(-50)
    expect(change(100, 0)).toBeNull()
    expect(change(-50, -100)).toBe(50) // a loss that halved is an improvement
  })

  it('says how long ago a delegate was seen, and colours the dot', () => {
    const now = 1_000_000_000
    expect(ago(now - 30_000, t, now)).toBe('just now')
    expect(ago(now - 12 * 60_000, t, now)).toBe('12 min ago')
    expect(ago(now - 3 * 3_600_000, t, now)).toBe('3 h ago')
    expect(ago(now - 3 * 86_400_000, t, now)).toBe('3 days ago')
    expect([freshness(now - 60_000, now), freshness(now - 30 * 60_000, now), freshness(now - 5 * 3_600_000, now), freshness(null, now)])
      .toEqual(['bg-success', 'bg-warning', 'bg-fg-2/40', 'bg-fg-2/30'])
  })

  it('writes Kurdish dates itself (browsers have none and would show English)', () => {
    const fri = new Date(2026, 9, 9, 12)
    expect(longDate(fri, 'ku')).toBe('هەینی، 9ی تشرینی یەکەم 2026')
    expect(weekday(fri, 'ku')).toBe('هەینی')
    expect(dayMonth(fri, 'ku')).toBe('9 تشرینی یەکەم')
    expect(longDate(fri, 'en')).toMatch(/^Friday,? 9 October 2026$/)
    expect(plural(t, 1, 'ap.bill_1', 'ap.bills_n')).toBe('1 bill')
    expect(plural(t, 3, 'ap.bill_1', 'ap.bills_n')).toBe('3 bills')
  })

  it('sends each person to the first screen they may open', async () => {
    const { adminHome } = await import('./Shell')
    const can = (perms: string[]) => (p: string) => perms.includes(p)
    expect(adminHome(can(['reports.view', 'products.edit']))).toBe('/')                                    // owner, manager: the dashboard
    expect(adminHome(can(['products.view', 'products.edit', 'inventory.view', 'inventory.adjust']))).toBe('/products') // stock keeper
    expect(adminHome(can(['inventory.view']))).toBe('/inventory')
    expect(adminHome(can([]))).toBeNull()
  })

  it('greets by first name and time of day', () => {
    expect(greeting(t, 'Rand Bjar', 9)).toBe('Good morning, Rand')
    expect(greeting(t, 'Rand Bjar', 14)).toBe('Good afternoon, Rand')
    expect(greeting(t, 'Rand Bjar', 20)).toBe('Good evening, Rand')
  })
})
