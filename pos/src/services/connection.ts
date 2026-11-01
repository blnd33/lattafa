/**
 * Start-up: is this POS connected to the Lattafa server on this domain?
 *
 *  - already connected before → connected (works offline from its mirror until the server is back)
 *  - server reachable, nothing on this device yet → connect automatically
 *  - server reachable, but this device has data from running on its own → ask first (`needs-choice`)
 *  - no server → local mode, exactly as before
 */
import { db } from '@/data/db'
import { pingServer, setApiDevice } from './api'
import { resetForServer } from './mirror'
import { setServerMode } from './mode'
import { ensureDevice, getSettings, saveSettingsRaw } from './settings'

export type ConnectionState = 'server' | 'local' | 'needs-choice'

const STAY_LOCAL = 'lattafa-stay-local'

export async function initConnection(): Promise<ConnectionState> {
  let s = await getSettings()
  if (s.sync.mode === 'server') {
    s = await ensureDevice(s)
    setApiDevice(s.device.id)
    setServerMode(true)
    return 'server'
  }
  const hasLocalShop = !!(await db.settings.get('app'))?.setupDone
  // A brand-new device must not settle for "no server" because of one slow answer (server still starting, weak
  // Wi-Fi): it would set up a separate shop of its own. Ask a few times first.
  let reachable = await pingServer()
  for (let i = 0; !reachable && !hasLocalShop && i < 3; i++) {
    await new Promise((r) => setTimeout(r, 1500))
    reachable = await pingServer()
  }
  if (!reachable) return 'local'
  if (hasLocalShop) {
    let stay = false
    try { stay = localStorage.getItem(STAY_LOCAL) === '1' } catch { /* private mode */ }
    return stay ? 'local' : 'needs-choice'
  }
  await connectToServer(false)
  return 'server'
}

/** Switch this device to connected mode. `wipe` clears the data it kept while running on its own. */
export async function connectToServer(wipe: boolean): Promise<void> {
  if (wipe) await resetForServer()
  let s = await getSettings()
  s = await ensureDevice(s)
  await saveSettingsRaw({ ...s, setupDone: wipe ? false : s.setupDone, sync: { ...s.sync, mode: 'server', lastPullAt: 0 } })
  try { localStorage.removeItem(STAY_LOCAL) } catch { /* ignore */ }
  setApiDevice(s.device.id)
  setServerMode(true)
}

export function stayLocal(): void {
  try { localStorage.setItem(STAY_LOCAL, '1') } catch { /* ignore */ }
}
