import { db } from '@/data/db'
import type { Device } from '@/data/types'
import { AppError, assertCan } from './context'
import { audit } from './audit'
import { getSettings } from './settings'
import { isServer } from './mode'
import * as remote from './remote'

export async function listDevices(): Promise<(Device & { isThis: boolean })[]> {
  assertCan('devices.manage')
  if (isServer()) return remote.listDevices()
  const [devices, s] = await Promise.all([db.devices.toArray(), getSettings()])
  return devices.sort((a, b) => a.registeredAt - b.registeredAt).map((d) => ({ ...d, isThis: d.id === s.device.id }))
}

export async function updateDevice(id: string, patch: { name: string; code: string }): Promise<void> {
  assertCan('devices.manage')
  if (isServer()) return remote.updateDevice(id, patch)
  const name = patch.name.trim()
  const code = patch.code.trim().toUpperCase()
  if (!name) throw new AppError('required_fields')
  if (!/^[A-Z0-9]{2,6}$/.test(code)) throw new AppError('device_code_invalid')
  const clash = (await db.devices.toArray()).find((d) => d.code === code && d.id !== id)
  if (clash) throw new AppError('device_code_taken')
  await db.transaction('rw', [db.devices, db.settings, db.audit], async () => {
    await db.devices.update(id, { name, code })
    const s = await getSettings()
    if (s.device.id === id) await db.settings.put({ ...s, device: { ...s.device, name, code } })
    await audit('device.update', 'device', id, { name, code })
  })
}

/** Mark a device as revoked. It is enforced by the server once the backend is connected. */
export async function setDeviceRevoked(id: string, revoked: boolean): Promise<void> {
  assertCan('devices.manage')
  if (isServer()) return remote.setDeviceRevoked(id, revoked)
  const s = await getSettings()
  if (s.device.id === id && revoked) throw new AppError('cannot_modify_self')
  await db.devices.update(id, { revoked })
  await audit(revoked ? 'device.revoke' : 'device.restore', 'device', id)
}
