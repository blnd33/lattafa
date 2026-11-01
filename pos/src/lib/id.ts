/**
 * Client-generated UUID v4.
 *
 * `crypto.randomUUID()` only exists in secure contexts (https / localhost). A POS
 * tablet opened over plain http on the shop LAN (http://192.168.x.x) is *not* a
 * secure context, so we build the UUID from `getRandomValues` (available
 * everywhere) with a Math.random last resort.
 */
export function uuid(): string {
  const c: Crypto | undefined = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') {
    try {
      return c.randomUUID()
    } catch {
      /* fall through */
    }
  }
  const b = new Uint8Array(16)
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b)
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0'))
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10).join('')}`
}

/** Random hex string (salts, device codes). */
export function randomHex(bytes = 16): string {
  const b = new Uint8Array(bytes)
  const c: Crypto | undefined = globalThis.crypto
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b)
  else for (let i = 0; i < bytes; i++) b[i] = Math.floor(Math.random() * 256)
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}
