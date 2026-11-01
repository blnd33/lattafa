import { soldOut, type MenuData, type MenuProduct, type MenuSettings } from '@menu/api'
import { api } from '@/services/api'

/** Admin panel → Customer menu. The server side is backend/app/Services/MenuService.php. */
export type ManagedProduct = MenuProduct & { showOnMenu: boolean; order: number | null }
export interface MenuManage extends Omit<MenuData, 'products' | 'menu'> {
  menu: MenuSettings
  products: ManagedProduct[]
  canEditSettings: boolean
}

export interface Flags { showOnMenu: boolean; featured: boolean; isNew: boolean }

/** The arrangement being edited (nothing is saved until Save). */
export interface Draft {
  /** false = automatic order (featured first, then A–Z); true = the order in `order` */
  custom: boolean
  order: string[]
  flags: Record<string, Flags>
  settings: MenuSettings
}

export interface SaveBody {
  products: ({ id: string } & Flags)[]
  order?: string[]
  autoOrder?: true
  /** the photos/videos themselves are saved straight away (see media.ts), not with Save */
  settings?: Omit<MenuSettings, 'hero'>
}

export const loadMenu = () => api<MenuManage>('GET', '/menu/manage')
export const saveMenu = (body: SaveBody) => api<MenuManage>('PUT', '/menu/manage', body)
export const deleteHero = (id: string) => api<MenuManage>('DELETE', `/menu/media/${id}`)
export const orderHero = (ids: string[]) => api<MenuManage>('PUT', '/menu/media/order', { ids })

const flagsOf = (p: ManagedProduct): Flags => ({ showOnMenu: p.showOnMenu, featured: p.featured, isNew: p.isNew })
const sameFlags = (a: Flags, b: Flags) => a.showOnMenu === b.showOnMenu && a.featured === b.featured && a.isNew === b.isNew

/** The menu as saved, ready to edit. The server already lists the perfumes in menu order. */
export function draftOf(m: MenuManage): Draft {
  return {
    custom: m.products.some((p) => p.order !== null),
    order: m.products.map((p) => p.id),
    flags: Object.fromEntries(m.products.map((p) => [p.id, flagsOf(p)])),
    settings: { ...m.menu, hero: [...m.menu.hero] },
  }
}

/** The automatic order, as the server makes it: featured first, then A–Z by English name (else the Arabic, else the Kurdish). */
export function autoOrder(products: ManagedProduct[], flags: Record<string, Flags>): string[] {
  const key = (p: ManagedProduct) => (p.name.en || p.name.ar || p.name.ku || '').toLowerCase()
  return [...products]
    .sort((a, b) => Number(!flags[a.id]?.featured) - Number(!flags[b.id]?.featured) || (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))
    .map((p) => p.id)
}

/** Every perfume in the order the menu will show it, with the draft's switches. */
export function arranged(m: MenuManage, d: Draft): ManagedProduct[] {
  const byId = new Map(m.products.map((p) => [p.id, p]))
  const ids = d.custom ? d.order : autoOrder(m.products, d.flags)
  return ids.flatMap((id) => {
    const p = byId.get(id)
    return p ? [{ ...p, ...d.flags[id] }] : []
  })
}

/** What guests would see with the draft: the same shape the public menu gets from the server. */
export function previewData(m: MenuManage, d: Draft): MenuData {
  const products = arranged(m, d)
    .filter((p) => p.showOnMenu && !(d.settings.hideSoldOut && soldOut(p)))
    .map(({ showOnMenu: _s, order: _o, ...p }) => p)
  return { store: m.store, currency: m.currency, menu: { ...d.settings }, products, updatedAt: m.updatedAt }
}

/** Moves one perfume from place `from` to place `to`. */
export function move<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list
  const next = [...list]
  const [x] = next.splice(from, 1)
  next.splice(to, 0, x)
  return next
}

/** What Save sends: only what changed. `null` = nothing to save. */
export function changes(m: MenuManage, d: Draft, canEditSettings: boolean): SaveBody | null {
  const saved = draftOf(m)
  const products = m.products.filter((p) => !sameFlags(flagsOf(p), d.flags[p.id])).map((p) => ({ id: p.id, ...d.flags[p.id] }))
  const body: SaveBody = { products }
  if (d.custom && (!saved.custom || d.order.join() !== saved.order.join())) body.order = d.order
  if (!d.custom && saved.custom) body.autoOrder = true
  const s = d.settings
  if (canEditSettings && (s.showPrices !== saved.settings.showPrices || s.hideSoldOut !== saved.settings.hideSoldOut || s.whatsapp.trim() !== saved.settings.whatsapp || s.heroDim !== saved.settings.heroDim)) {
    body.settings = { showPrices: s.showPrices, hideSoldOut: s.hideSoldOut, whatsapp: s.whatsapp.trim(), heroDim: s.heroDim }
  }
  return products.length || body.order || body.autoOrder || body.settings ? body : null
}
