/**
 * Which app this page is. The POS and the admin panel share all their code but never their local data: the admin panel
 * keeps its own copy of the shop's data and its own sign-in, so an owner who opens /admin/ on a till does not sign that
 * till in as themselves, and signing out of the admin panel never signs the cashier out.
 */
export type AppKey = 'pos' | 'admin'

export const APP: AppKey = typeof location !== 'undefined' && /^\/admin(\/|$)/.test(location.pathname) ? 'admin' : 'pos'

/** IndexedDB database holding this app's local copy of the shop */
export const DB_NAME = APP === 'admin' ? 'lattafa-admin' : 'lattafa-pos'

/** localStorage key of whoever is signed in */
export const SESSION_KEY = APP === 'admin' ? 'lattafa-admin-session' : 'lattafa-session'
