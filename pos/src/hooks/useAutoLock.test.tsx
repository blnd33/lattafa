// @vitest-environment jsdom
/**
 * The till asks for the PIN again only after the stretch the shop chose
 * (Settings → Security), and that choice reaches a till that is already open.
 */
import { act, cleanup, render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAutoLock } from './useAuth'
import { useSession } from '@/store/session'
import { DEFAULT_SETTINGS } from '@/services/settings'
import type { Actor, AppSettings } from '@/data/types'

const MIN = 60_000
const actor = { id: 'u-owner', name: 'Owner', permissions: [], roleName: 'Super Admin' } as unknown as Actor

let qc: QueryClient

const settingsWith = (autoLockMinutes: number): AppSettings => ({
  ...DEFAULT_SETTINGS,
  security: { ...DEFAULT_SETTINGS.security, autoLockMinutes },
})

function Host() {
  useAutoLock()
  return null
}

/** Mounts the hook with the shop's chosen idle time already in hand. */
function mount(autoLockMinutes: number | null) {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  if (autoLockMinutes !== null) qc.setQueryData(['settings'], settingsWith(autoLockMinutes))
  useSession.setState({ actor, locked: false, lastActivity: Date.now() })
  return render(<QueryClientProvider client={qc}><Host /></QueryClientProvider>)
}

const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })
const locked = () => useSession.getState().locked

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: false }) })
afterEach(() => { cleanup(); vi.useRealTimers(); useSession.setState({ actor: null, locked: false }) })

describe('auto lock', () => {
  it('locks once the chosen idle time has passed', () => {
    mount(30)
    tick(29 * MIN)
    expect(locked()).toBe(false)
    tick(2 * MIN)
    expect(locked()).toBe(true)
  })

  it('"Never" leaves the till open', () => {
    mount(0)
    tick(8 * 60 * MIN)
    expect(locked()).toBe(false)
  })

  it('a touch starts the countdown again', () => {
    mount(30)
    tick(25 * MIN)
    act(() => { window.dispatchEvent(new Event('pointerdown')) })
    tick(25 * MIN) // 50 minutes in, but only 25 since the last touch
    expect(locked()).toBe(false)
    tick(6 * MIN)
    expect(locked()).toBe(true)
  })

  it('never locks on a guess before the settings are in', () => {
    mount(null)
    tick(4 * 60 * MIN)
    expect(locked()).toBe(false)
  })

  it('a change made in the admin panel reaches a till that is already open', async () => {
    mount(0) // the shop had it switched off…
    tick(60 * MIN)
    expect(locked()).toBe(false)
    act(() => { qc.setQueryData(['settings'], settingsWith(5)) }) // …and turns it back on
    tick(1) // the query tells the till, which starts watching the clock again
    tick(6 * MIN)
    expect(locked()).toBe(true)
  })
})
