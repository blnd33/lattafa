/**
 * The wholesale catalogue's own API client. The server side is `backend/app/Services/Catalogue/*`.
 *
 * Two doors, deliberately apart. `open` and `products` are public and carry **no price at all** — not hidden, not
 * nulled, never built. Everything else needs the session token a valid access code opens, and that is the only
 * route by which a figure in dollars reaches a browser.
 */

const BASE = '/api/v1/wholesale'

export interface Country {
  id: string
  iso2: string
  name: Record<string, string>
  language: string
  minOrderCents: number
  isDefault: boolean
}

export interface Language { code: string; name: string; native: string; rtl: boolean }

/**
 * The three colours and the wordmark the whole catalogue is drawn in.
 *
 * `provisional` is the owner saying, in the footer, that this is the house theme rather than Lattafa's own brand
 * kit. Nothing in here was invented by the catalogue; it is whatever the appearance screen holds.
 */
export interface Brand {
  ink: string
  ivory: string
  gold: string
  wordmark: string
  tagline: string
  provisional: boolean
}

/** One homepage section the owner has left switched on. The order of the list is the order of the page. */
export interface LookSection { key: string; on: boolean }

export interface FooterInfo { note: string; email: string; phone: string; instagram: string; website: string }

export interface Look {
  brand: Brand
  /** only the sections switched on, in the owner's order */
  sections: LookSection[]
  /** empty = the catalogue's own translated words */
  headline: string
  lead: string
  hero: string | null
  footer: FooterInfo
}

export interface Open {
  countries: Country[]
  languages: Language[]
  defaultCountryId: string | null
  language: string
  /** the catalogue's own words in that language, as `{'cat.explore': 'Explore the collection'}` */
  words: Record<string, string>
  currency: 'USD'
  /** the shop's own WhatsApp number, the same one the QR menu uses; empty when the shop has not set one */
  whatsapp: string
  /** how the owner has arranged it — colours, headline, which sections and in what order */
  look: Look
}

export interface Size {
  variantId: string
  sku: string
  label: string
  size: number
  unit: string
  ml: number
  /** all a visitor is told about the shelf */
  inStock: boolean
  minQty: number
  step: number
}

export interface Perfume {
  id: string
  name: string
  description: string
  notes: { top: string[]; heart: string[]; base: string[] }
  brand: string
  category: string
  gender: string
  concentration: string
  scentFamilies: string[]
  season: string
  longevity: number
  sillage: number
  image: string | null
  /** the shop's own photograph first, then whatever the catalogue has added — may be empty */
  images: string[]
  art: { c1: string; c2: string; shape: string }
  featured: boolean
  isNew: boolean
  inStock: boolean
  sizes: Size[]
}

/** An editorial grouping the owner made — "Oud Collection", "Gift sets". Never a POS category. */
export interface CollectionRow {
  id: string
  slug: string
  name: string
  description: string
  image: string | null
  featured: boolean
  /** product ids, in the owner's order; only perfumes the catalogue is showing */
  products: string[]
}

export interface Collection {
  language: string
  products: Perfume[]
  categories: { key: string; count: number }[]
  brands: string[]
  collections: CollectionRow[]
}

export interface Session {
  business: string
  contactPerson: string
  country: { id: string; iso2: string; name: Record<string, string>; language: string; minOrderCents: number } | null
  expiresAt: number
}

export interface PriceLine {
  variantId: string
  productId: string
  sku: string
  label: string
  ml: number
  category: string
  priceCents: number
  source: string
  inStock: boolean
  minQty: number
  step: number
}

export interface PriceList { minOrderCents: number; lines: PriceLine[] }

export interface Problem { code: string; params: Record<string, string | number> }

export interface QuoteLine {
  variantId: string
  sku: string
  label: string
  qty: number
  unitCents: number | null
  lineCents: number
  minQty: number
  step: number
  source: string | null
  problems: Problem[]
}

export interface Quote {
  ok: boolean
  lines: QuoteLine[]
  subtotalCents: number
  units: number
  minOrderCents: number
  shortfallCents: number
  problems: Problem[]
}

/** What the server refused, with its figures — the catalogue says it in the buyer's own words. */
export class CatalogueError extends Error {
  constructor(public readonly code: string, public readonly params: Record<string, string | number> = {}) {
    super(code)
  }
}

async function call<T>(path: string, opts: { token?: string | null; method?: string; body?: unknown; idempotencyKey?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey

  let res: Response
  try {
    res = await fetch(BASE + path, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      credentials: 'omit',
    })
  } catch {
    throw new CatalogueError('offline')
  }

  const data = res.headers.get('Content-Type')?.includes('application/json') ? await res.json().catch(() => null) : null
  if (res.ok) return data as T

  const err = (data as { error?: { code?: string; params?: Record<string, string | number> } } | null)?.error
  throw new CatalogueError(err?.code ?? 'unknown', err?.params ?? {})
}

export const getOpen = (language?: string) => call<Open>(`/open${language ? `?language=${encodeURIComponent(language)}` : ''}`)
export const getCollection = (language: string) => call<Collection>(`/products?language=${encodeURIComponent(language)}`)

export const unlock = (code: string, country?: string | null) =>
  call<{ token: string; session: Session }>('/unlock', { method: 'POST', body: { code, country: country ?? undefined } })

export const getSession = (token: string) => call<{ session: Session }>('/me', { token }).then((r) => r.session)
export const getPrices = (token: string) => call<PriceList>('/prices', { token })
export const lock = (token: string) => call<{ ok: true }>('/lock', { method: 'POST', token })

export const getQuote = (token: string, lines: { variantId: string; qty: number }[]) =>
  call<Quote>('/quote', { method: 'POST', token, body: { lines } })

export interface OrderItem {
  variantId: string
  productId: string | null
  sku: string
  name: string
  label: string
  qty: number
  unitCents: number
  lineCents: number
}

export interface Order {
  id: string
  /** LAT-10025 */
  number: string
  /** the buyer's own way back to this order — random, so nobody reads another's by counting */
  reference: string
  status: string
  method: 'direct' | 'whatsapp'
  businessName: string
  contactPerson: string
  phone: string
  whatsapp: string
  email: string
  address: string
  note: string
  subtotalCents: number
  units: number
  minOrderCents: number
  currency: string
  paymentStatus: string
  paidCents: number
  placedAt: number
  decidedAt: number | null
  whatsappOpenedAt: number | null
  rejectReason: string
  items: OrderItem[]
}

export interface Who {
  lines: { variantId: string; qty: number }[]
  method: 'direct' | 'whatsapp'
  businessName: string
  contactPerson?: string
  phone?: string
  whatsapp?: string
  email?: string
  address?: string
  note?: string
}

/**
 * Sends the order. The server prices and checks the basket again, writes it, and holds the stock — all in one
 * transaction. `Idempotency-Key` makes the same checkout sent twice one order rather than two.
 */
export const placeOrder = (token: string, body: Who, idempotencyKey: string) =>
  call<{ order: Order; whatsapp?: string }>('/orders', { method: 'POST', token, body, idempotencyKey })

/** Records that WhatsApp was opened. Its own fact — never taken as the message having been sent. */
export const whatsappOpened = (token: string, reference: string) =>
  call<{ order: Order }>(`/orders/${encodeURIComponent(reference)}/whatsapp-opened`, { method: 'POST', token })

export const getOrders = (token: string) => call<{ orders: Order[] }>('/orders', { token }).then((r) => r.orders)
export const getOrder = (token: string, reference: string) =>
  call<{ order: Order }>(`/orders/${encodeURIComponent(reference)}`, { token }).then((r) => r.order)

/** `2450` → `$24.50`. The catalogue is USD only; there is no other currency and no conversion. */
export const money = (cents: number): string => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
