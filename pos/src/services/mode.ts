/**
 * Local mode vs connected mode.
 *
 *  - **local**: the POS is its own database (no server) — how it ran before the backend existed, and how the tests run.
 *  - **server** ("connected"): the Lattafa API on this domain is the source of truth. The till keeps a mirror in
 *    IndexedDB so selling never waits for the network, pushes what it records, and pulls everything else.
 *
 * Services check `isServer()` synchronously, so the flag lives in memory and is set once at start-up.
 */
let server = false

export const isServer = (): boolean => server
export const setServerMode = (on: boolean): void => { server = on }
