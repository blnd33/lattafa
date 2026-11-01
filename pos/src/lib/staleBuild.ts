/**
 * After a new version is installed, a page that was already open still runs the old one. Opening a screen it hadn't
 * loaded yet then asks for a file the new version replaced, and the app would go blank. Reload once into the new
 * version instead (not again within 10 s, so a page that really can't load doesn't reload forever).
 */
const KEY = 'lattafa-stale-reload'
const STALE = /dynamically imported module|importing a module script failed|error loading dynamically imported module/i

export function reloadOnStaleBuild(reload: () => void = () => location.reload()): void {
  const once = (): boolean => {
    try {
      if (Date.now() - Number(sessionStorage.getItem(KEY) || 0) < 10_000) return false
      sessionStorage.setItem(KEY, String(Date.now()))
    } catch { /* storage blocked: reload anyway */ }
    reload()
    return true
  }
  // Vite's own signal for a screen whose file failed to load
  window.addEventListener('vite:preloadError', (e) => { if (once()) e.preventDefault() })
  window.addEventListener('error', (e) => { if (STALE.test(String(e.message))) once() })
  window.addEventListener('unhandledrejection', (e) => { if (STALE.test(String((e.reason as Error | undefined)?.message ?? e.reason))) once() })
}
