/** Public menu data (`GET /api/v1/menu`). The last good copy is kept on the phone so a weak signal still shows the menu. */
import type { BottleShape, Gender, I18nText, Lang, SizeUnit } from '@/data/types'

/** `priceIQD` is null when the shop has chosen not to show prices on the menu. */
export interface MenuSize { id: string; label: string; size: number; unit: SizeUnit; ml: number; priceIQD: number | null; available: boolean }
export interface MenuProduct {
  id: string
  name: I18nText
  description: I18nText
  brand: string
  category: string
  gender: Gender
  concentration: string
  scentFamilies: string[]
  notes: { top: string[]; heart: string[]; base: string[] }
  season: 'all' | 'winter' | 'summer'
  longevity: number
  sillage: number
  image: string | null
  art: { c1: string; c2: string; shape: BottleShape }
  featured: boolean
  isNew: boolean
  sizes: MenuSize[]
}
/** A photo or video behind the top of the menu (`poster` = a video's first frame, shown while it loads). */
export interface HeroMedia { id: string; type: 'image' | 'video'; src: string; poster: string | null }
/**
 * Set in the admin panel → Customer menu. `whatsapp` empty = orders go to the shop phone. `hero` = photos/videos behind
 * the top of the menu (taking turns when there are several), darkened by `heroDim` % so the title stays readable.
 */
export interface MenuSettings { showPrices: boolean; hideSoldOut: boolean; whatsapp: string; heroDim: number; hero: HeroMedia[] }
export interface MenuData {
  store: { name: string; tagline: string; phone: string; address: string; city: string }
  currency: { rate: number; usdEnabled: boolean }
  /** missing in a menu saved on the phone by an older version */
  menu?: MenuSettings
  products: MenuProduct[]
  updatedAt: number
}

export const DEFAULT_MENU: MenuSettings = { showPrices: true, hideSoldOut: false, whatsapp: '', heroDim: 45, hero: [] }
export const menuSettings = (d: MenuData): MenuSettings => ({ ...DEFAULT_MENU, ...d.menu })

const CACHE = 'lattafa-menu-cache'

export function cachedMenu(): MenuData | null {
  try { return JSON.parse(localStorage.getItem(CACHE) ?? 'null') } catch { return null }
}

export async function fetchMenu(): Promise<MenuData> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 12_000)
  try {
    const r = await fetch('/api/v1/menu', { headers: { Accept: 'application/json' }, signal: ctrl.signal })
    if (!r.ok) throw new Error(`menu ${r.status}`)
    const data = (await r.json()) as MenuData
    try { localStorage.setItem(CACHE, JSON.stringify(data)) } catch { /* storage full or private mode */ }
    return data
  } finally {
    clearTimeout(t)
  }
}

/** Lowest price a customer can actually buy now (falls back to any size when everything is sold out). */
export const fromPrice = (p: MenuProduct) => Math.min(...(p.sizes.some((s) => s.available) ? p.sizes.filter((s) => s.available) : p.sizes).map((s) => s.priceIQD ?? 0))
export const soldOut = (p: MenuProduct) => p.sizes.every((s) => !s.available)

/**
 * The two prices that split the menu's "from" prices into a cheaper, middle and dearer third, rounded to a round
 * number — so the price filter follows whatever the shop sells. `null` when there are too few prices to split.
 */
export function priceBands(prices: number[]): [number, number] | null {
  const s = prices.filter((n) => n > 0).sort((a, b) => a - b)
  if (new Set(s).size < 3) return null
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(s.length * q))]
  for (const step of [at(1 / 3) >= 100000 ? 10000 : 5000, 1000, 250]) {
    const a = Math.round(at(1 / 3) / step) * step, b = Math.round(at(2 / 3) / step) * step
    if (s.some((n) => n < a) && s.some((n) => n >= a && n < b) && s.some((n) => n >= b)) return [a, b]
  }
  return null
}

/** Iraqi numbers as WhatsApp wants them: "0750 730 8005" → "9647507308005". `null` when it isn't a usable number. */
export function whatsappNumber(phone: string): string | null {
  let d = phone.replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  if (d.startsWith('0')) d = `964${d.slice(1)}`
  return d.length >= 11 && d.length <= 15 ? d : null
}

/** Where "Order via WhatsApp" goes: the menu's own number if the shop set one, else the shop phone. */
export const orderNumber = (d: Pick<MenuData, 'store' | 'menu'>) => whatsappNumber(d.menu?.whatsapp || d.store.phone)

/**
 * Live preview (admin panel → Customer menu): the menu opened as `/menu/?preview` inside the admin page shows the
 * unsaved arrangement the admin page sends it, instead of fetching the menu. Same-origin messages only.
 */
export const PREVIEW = { ready: 'lattafa-menu-ready', data: 'lattafa-menu-preview' } as const
export interface PreviewMessage { type: typeof PREVIEW.data; data: MenuData; lang?: Lang }
export const isPreview = () => new URLSearchParams(location.search).has('preview')
