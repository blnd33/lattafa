import { useEffect, useState, useSyncExternalStore } from 'react'

/**
 * Device classes the layout switches on. These match Tailwind's breakpoints:
 *   phone   < 768   (bottom nav, full-screen sheets)
 *   tablet  768–1023 (icon rail, cart as a slide-over unless landscape ≥1024)
 *   desktop ≥ 1024  (rail/sidebar + persistent cart panel)
 */
export type DeviceClass = 'phone' | 'tablet' | 'desktop'

function subscribeMedia(query: string) {
  return (cb: () => void) => {
    const m = window.matchMedia(query)
    m.addEventListener('change', cb)
    return () => m.removeEventListener('change', cb)
  }
}

export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    subscribeMedia(query),
    () => window.matchMedia(query).matches,
    () => false,
  )
}

export function useDevice(): DeviceClass {
  const isDesktop = useMedia('(min-width: 1024px)')
  const isTablet = useMedia('(min-width: 768px)')
  return isDesktop ? 'desktop' : isTablet ? 'tablet' : 'phone'
}

/** True when the primary input is a finger (phones/tablets) rather than a mouse. */
export function useIsTouch(): boolean {
  return useMedia('(pointer: coarse)')
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  return online
}

/** Ask for a screen wake lock so a counter tablet doesn't dim mid-sale (best effort). */
export function useWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    const request = async () => { try { lock = await navigator.wakeLock.request('screen') } catch { /* denied */ } }
    void request()
    const onVis = () => { if (document.visibilityState === 'visible') void request() }
    document.addEventListener('visibilitychange', onVis)
    return () => { document.removeEventListener('visibilitychange', onVis); void lock?.release() }
  }, [enabled])
}
