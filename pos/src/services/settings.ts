import { db } from '@/data/db'
import { STORE_LOCATION_ID, type AppSettings } from '@/data/types'
import { uuid } from '@/lib/id'
import { assertCan } from './context'
import { audit } from './audit'
import { isServer } from './mode'
import * as remote from './remote'

export const DEFAULT_SETTINGS: AppSettings = {
  key: 'app',
  setupDone: false,
  store: { name: 'Lattafa Perfumes', tagline: 'Duhok · Iraq', address: 'Duhok, Kurdistan Region, Iraq', phone: '', city: 'Duhok' },
  receipt: {
    header: '',
    footer: {
      en: 'Thank you for choosing Lattafa',
      ar: 'شكراً لاختياركم لطافة',
      ku: 'سوپاس بۆ هەڵبژاردنی لەتافە',
    },
    showLogo: true,
    showQr: true,
    qrUrl: '',
    paperMm: 80,
    autoPrint: false,
    copies: 1,
  },
  currency: { rate: 1460, rounding: 250, usdEnabled: true },
  tax: { pct: 0 },
  loyalty: { enabled: true, pointsPer1000IQD: 1, pointValueIQD: 10 },
  sales: { requireShift: false, allowNegativeStock: false, giftWrapFeeIQD: 2000, defaultCustomerCreditIQD: 0, returnWindowDays: 14 },
  // 30 minutes: long enough that serving one customer never locks the till mid-sale
  security: { autoLockMinutes: 30, maxFailedAttempts: 5, lockoutSeconds: 60 },
  device: { id: '', code: 'ST1', name: 'Counter 1', locationId: STORE_LOCATION_ID },
  sync: { mode: 'local', serverUrl: '', lastPullAt: 0 },
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }

function merge<T>(base: T, patch: DeepPartial<T>): T {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    const cur = out[k]
    if (v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' && !Array.isArray(cur)) {
      out[k] = merge(cur, v as DeepPartial<typeof cur>)
    } else if (v !== undefined) out[k] = v
  }
  return out as T
}

/** Stored settings merged over defaults (so newly added options always have a value). */
export async function getSettings(): Promise<AppSettings> {
  const row = await db.settings.get('app')
  return row ? merge(DEFAULT_SETTINGS, row as DeepPartial<AppSettings>) : structuredClone(DEFAULT_SETTINGS)
}

/** Used during first-run setup, before anybody can sign in. */
export async function saveSettingsRaw(s: AppSettings): Promise<void> {
  await db.settings.put(s)
}

export async function updateSettings(patch: DeepPartial<AppSettings>): Promise<AppSettings> {
  assertCan('settings.edit')
  if (isServer()) return remote.updateSettings(patch as Record<string, unknown>)
  const cur = await getSettings()
  const next = merge(cur, patch)
  next.key = 'app'
  await db.settings.put(next)
  await audit('settings.update', 'settings', 'app', { keys: Object.keys(patch) })
  return next
}

export async function ensureDevice(s: AppSettings): Promise<AppSettings> {
  if (s.device.id) return s
  const next = merge(s, { device: { id: uuid() } })
  await db.settings.put(next)
  await db.devices.put({ id: next.device.id, name: next.device.name, code: next.device.code, registeredAt: Date.now(), revoked: false })
  return next
}
