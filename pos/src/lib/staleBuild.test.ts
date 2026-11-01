// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { reloadOnStaleBuild } from './staleBuild'

describe('a page left open across an update', () => {
  afterEach(() => { sessionStorage.clear(); vi.useRealTimers() })

  it('reloads once into the new version when a screen’s file is gone, not in a loop', () => {
    vi.useFakeTimers()
    const reload = vi.fn()
    reloadOnStaleBuild(reload)
    const fail = () => window.dispatchEvent(new ErrorEvent('error', { message: 'TypeError: Failed to fetch dynamically imported module: http://x/assets/SettingsPage-old.js' }))
    fail()
    expect(reload).toHaveBeenCalledTimes(1)
    fail() // still failing straight after the reload (e.g. no connection): leave it
    expect(reload).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(11_000)
    window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }))
    expect(reload).toHaveBeenCalledTimes(2)
    window.dispatchEvent(new ErrorEvent('error', { message: 'something else broke' }))
    expect(reload).toHaveBeenCalledTimes(2)
  })
})
