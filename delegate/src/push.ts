/**
 * Asking the phone to ring for new orders with the app closed (Web Push).
 *
 * Off until the delegate taps "Turn on" — browsers only grant it on a real tap, and an app that asks on first load
 * is usually refused for good. Everything here fails quietly: the bell inside the app is what people rely on.
 */
import { api, isOfflineError } from '@/services/api'

export type PushState = 'unsupported' | 'off' | 'on' | 'blocked' | 'no-keys'

/** The server's public key, url-safe base64 → the bytes `pushManager.subscribe` wants. */
const b64ToBytes = (s: string): ArrayBuffer => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4)
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out.buffer
}

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

async function registration(): Promise<ServiceWorkerRegistration | null> {
  try { return (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.ready) } catch { return null }
}

/** Where things stand right now, without asking the person anything. */
export async function pushState(): Promise<PushState> {
  if (!supported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  const reg = await registration()
  const sub = await reg?.pushManager.getSubscription().catch(() => null)
  return sub ? 'on' : 'off'
}

/** Turns it on: asks the phone, then tells the server where to send. Returns where things ended up. */
export async function turnOnPush(): Promise<PushState> {
  if (!supported()) return 'unsupported'
  let key = ''
  try {
    const r = await api<{ enabled: boolean; publicKey: string }>('GET', '/push/key')
    if (!r.enabled || !r.publicKey) return 'no-keys'
    key = r.publicKey
  } catch (e) {
    if (isOfflineError(e)) return 'off'
    return 'no-keys'
  }
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off'
  const reg = await registration()
  if (!reg) return 'unsupported'
  try {
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) })
    const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
    await api('POST', '/push/subscribe', {
      endpoint: json.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth, app: 'delegate',
    })
    return 'on'
  } catch { return 'off' }
}

/** Turns it off on this phone and forgets it on the server. */
export async function turnOffPush(): Promise<PushState> {
  const reg = await registration()
  const sub = await reg?.pushManager.getSubscription().catch(() => null)
  if (sub) {
    const endpoint = sub.endpoint
    await sub.unsubscribe().catch(() => undefined)
    await api('POST', '/push/unsubscribe', { endpoint }).catch(() => undefined)
  }
  return 'off'
}
