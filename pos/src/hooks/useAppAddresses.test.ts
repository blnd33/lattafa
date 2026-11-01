import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadAppAddresses, SAME_DOMAIN } from './useAppAddresses'

const answer = (status: number, body: unknown) =>
  vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))

describe('where the other apps are', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses the addresses the server gives (one address per app)', async () => {
    const fetch = answer(200, { menu: 'http://localhost:8001/', pos: 'http://localhost:8002/', delegate: 'http://localhost:8003/', admin: 'http://localhost:8004/' })
    vi.stubGlobal('fetch', fetch)
    expect(await loadAppAddresses()).toEqual({ menu: 'http://localhost:8001/', pos: 'http://localhost:8002/', delegate: 'http://localhost:8003/', admin: 'http://localhost:8004/' })
    expect(String(fetch.mock.calls[0][0])).toBe('/api/v1/apps')
  })

  it('falls back to the paths on this domain without a server, or for anything missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
    expect(await loadAppAddresses()).toEqual(SAME_DOMAIN)
    vi.stubGlobal('fetch', answer(404, { error: { code: 'not_found', params: {} } }))
    expect(await loadAppAddresses()).toEqual(SAME_DOMAIN) // an older server without /apps
    vi.stubGlobal('fetch', answer(200, { pos: 'http://localhost:8002/', admin: 42 }))
    expect(await loadAppAddresses()).toEqual({ ...SAME_DOMAIN, pos: 'http://localhost:8002/' })
  })
})
