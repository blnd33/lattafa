import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { SESSION_KEY } from '@/data/app'
import type { Actor } from '@/data/types'
import { getApiToken, setApiToken } from '@/services/api'
import { setActor } from '@/services/context'

interface SessionState {
  actor: Actor | null
  /** connected mode: the server token of whoever is signed in (null in local mode) */
  token: string | null
  /** remembered so the PIN screen can pre-select the last cashier */
  lastUserId: string | null
  locked: boolean
  lastActivity: number
  signIn: (a: Actor) => void
  signOut: () => void
  lock: () => void
  unlock: () => void
  touch: () => void
  replaceActor: (a: Actor) => void
}

/**
 * The signed-in person. The Actor (with effective permissions) is persisted so a
 * page refresh doesn't log the cashier out mid-sale; it is re-validated against
 * the database (or the server, when connected) on boot — see useBootSession.
 * In connected mode the sign-in services set the API token; it is persisted with the session.
 */
export const useSession = create<SessionState>()(
  persist(
    (set, get) => ({
      actor: null,
      token: null,
      lastUserId: null,
      locked: false,
      lastActivity: Date.now(),
      signIn: (actor) => { setActor(actor); set({ actor, token: getApiToken(), lastUserId: actor.id, locked: false, lastActivity: Date.now() }) },
      signOut: () => { setActor(null); setApiToken(null); set({ actor: null, token: null, locked: false }) },
      lock: () => set({ locked: true }),
      unlock: () => set({ locked: false, lastActivity: Date.now(), token: getApiToken() ?? get().token }),
      touch: () => { if (Date.now() - get().lastActivity > 5000) set({ lastActivity: Date.now() }) },
      replaceActor: (actor) => { setActor(actor); set({ actor }) },
    }),
    {
      name: SESSION_KEY, // the admin panel has its own (see data/app.ts)
      partialize: (s) => ({ actor: s.actor, token: s.token, lastUserId: s.lastUserId, locked: s.locked, lastActivity: s.lastActivity }),
      onRehydrateStorage: () => (state) => {
        if (state?.actor) setActor(state.actor)
        if (state?.token) setApiToken(state.token)
      },
    },
  ),
)
