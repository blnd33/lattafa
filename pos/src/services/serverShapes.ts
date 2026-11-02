/**
 * The JSON shapes the Lattafa API sends (see backend/app/Http/Resources/Present.php) and how they map onto the
 * local types. Shared by the POS mirror and the delegate app; no database code here.
 */
import type { AppSettings, Customer, Product, Role, User, Variant } from '@/data/types'

/* ───────── server shapes (see backend/app/Http/Resources/Present.php) ───────── */

export type ServerVariant = Variant & { stock: number }
export type ServerProduct = Product & { variants: ServerVariant[] }
export type ServerUser = Omit<User, 'pinHash' | 'pinSalt' | 'passwordHash' | 'passwordSalt'> & { hasPassword: boolean; roleKey?: string }
export type ServerDevice = { id: string; name: string; code: string; registeredAt: number; revoked: boolean; lastSeenAt?: number | null }
export type ServerSettings = Omit<AppSettings, 'key' | 'device' | 'sync'>

export interface PullPayload {
  serverTime: number
  since: number
  settings: ServerSettings
  roles: Role[]
  users: ServerUser[]
  products: ServerProduct[]
  customers: Customer[]
  deleted: { products: string[]; users: string[]; roles: string[] }
  /** How many products and sizes the shop has in all, so a device can tell its copy has fallen out of step. */
  catalog?: { products: number; variants: number }
  device: ServerDevice | null
  counters: { sale: number; return: number } | null
}

/** A server account as the local `users` table stores it. Credential columns stay empty — see `creds`. */
export function userFromServer(u: ServerUser): User {
  const { hasPassword, roleKey: _rk, ...rest } = u
  void _rk
  return { ...rest, pinHash: '', pinSalt: '', passwordHash: hasPassword ? 'server' : null, passwordSalt: null }
}

export function splitProduct(p: ServerProduct): { product: Product; variants: Variant[]; stock: Record<string, number> } {
  const { variants, ...product } = p
  const stock: Record<string, number> = {}
  const vs = variants.map(({ stock: qty, ...v }) => { stock[v.id] = qty ?? 0; return { ...v, productId: p.id } })
  return { product, variants: vs, stock }
}
