import { useEffect } from 'react'
import { hasPerm } from '@/lib/permissions'
import { useSession } from '@/store/session'
import { refreshActor } from '@/services/auth'
import { useSettings } from './queries'

export function useActor() {
  return useSession((s) => s.actor)
}

/** `const canSell = useCan('pos.sell')` — for showing/hiding UI (services re-check on save). */
export function useCan(permission: string): boolean {
  const actor = useSession((s) => s.actor)
  return !!actor && hasPerm(actor.permissions, permission)
}

export function useCanAny(...perms: string[]): boolean {
  const actor = useSession((s) => s.actor)
  return !!actor && perms.some((p) => hasPerm(actor.permissions, p))
}

/**
 * On boot, re-validate the persisted session against the database: a user who was
 * disabled or had permissions changed while the page was closed is signed out or
 * gets the new permissions immediately.
 */
export function useBootSession(ready: boolean) {
  const actor = useSession((s) => s.actor)
  const replaceActor = useSession((s) => s.replaceActor)
  const signOut = useSession((s) => s.signOut)
  useEffect(() => {
    if (!ready || !actor) return
    let cancelled = false
    void (async () => {
      const fresh = await refreshActor(actor.id)
      if (cancelled || fresh === undefined) return // offline: keep the session, check again next time
      if (!fresh) signOut()
      else if (JSON.stringify(fresh.permissions) !== JSON.stringify(actor.permissions) || fresh.roleName !== actor.roleName) replaceActor(fresh)
    })()
    return () => { cancelled = true }
    // only on first ready; later changes are handled where they happen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])
}

/**
 * Asks for the PIN again after a stretch with nobody touching the till
 * (Settings → Security → "Ask for the PIN again after"; "Never" switches it off).
 *
 * The setting is read through the query, not once at start-up, so changing it in the
 * admin panel reaches a till that is already open — on its next sync, without a reload.
 */
export function useAutoLock() {
  const actor = useSession((s) => s.actor)
  const locked = useSession((s) => s.locked)
  const lock = useSession((s) => s.lock)
  const { data: settings } = useSettings()
  // until the settings are in, lock nothing: a till must never lock on a guessed figure
  const minutes = settings?.security.autoLockMinutes ?? 0
  useEffect(() => {
    if (!actor || locked || minutes <= 0) return
    const bump = () => useSession.getState().touch()
    // a wheel counts as well: at a desktop till, scrolling a long list is someone working
    const evts: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'touchstart', 'wheel']
    evts.forEach((e) => window.addEventListener(e, bump, { passive: true }))
    const timer = setInterval(() => {
      if (Date.now() - useSession.getState().lastActivity > minutes * 60_000) lock()
    }, 15_000)
    return () => { evts.forEach((e) => window.removeEventListener(e, bump)); clearInterval(timer) }
  }, [actor, locked, lock, minutes])
}
