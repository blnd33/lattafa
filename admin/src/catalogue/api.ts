import { api } from '@/services/api'

/**
 * Admin panel → Wholesale catalogue. The server side is `backend/app/Services/Catalogue/*` and the shapes below
 * match `App\Http\Resources\PresentCatalogue` exactly.
 *
 * Money is whole US cents everywhere and percentages are basis points (17.5 % = 1750) — the catalogue is USD only,
 * and neither is ever a float on the way in or out.
 */

export interface CatCountry {
  id: string
  iso2: string
  /** the country's name per language code — {en: 'Iraq', ar: 'العراق', …} */
  name: Record<string, string>
  language: string
  enabled: boolean
  isDefault: boolean
  sort: number
  minOrderCents: number
  customers: number | null
}

export interface CatLanguage { code: string; name: string; native: string; rtl: boolean; enabled: boolean; sort: number }

export type CustomerStatus = 'active' | 'suspended' | 'closed'

export interface AccessCode {
  id: string
  customerId: string
  /** LAT-••••3K7Q — the code itself is shown once, when it is made, and never again */
  display: string
  countryId: string | null
  active: boolean
  revoked: boolean
  expiresAt: number | null
  revokedAt: number | null
  uses: number
  lastUsedAt: number | null
  createdAt: number
}

export interface Buyer {
  id: string
  businessName: string
  contactPerson: string
  email: string
  phone: string
  whatsapp: string
  countryId: string | null
  country: CatCountry | null
  address: string
  status: CustomerStatus
  notes: string
  posCustomerId: string | null
  ordersCount: number
  ordersValueCents: number
  liveCodes: number | null
  codes: AccessCode[] | null
  createdAt: number
}

export interface PriceRow {
  variantId: string
  productId: string
  name: string
  brand: string
  category: string
  sku: string
  label: string
  ml: number
  /** the delegate's dollar list — what a size falls back to when a country has set no price */
  listCents: number
  /** this country's own price, or null where it has none */
  priceCents: number | null
  /** what a buyer with no special terms actually pays, or null when nothing is priced anywhere */
  effectiveCents: number | null
}

export interface CustomerTerm {
  variantId: string
  name: string
  sku: string
  label: string
  priceCents: number | null
  percentBp: number | null
  validFrom: number | null
  validTo: number | null
  inForce: boolean
}

export interface Discount { id: string; percentBp: number; validFrom: number | null; validTo: number | null }

export interface OrderRule {
  id: string
  scope: 'global' | 'category'
  scopeId: string
  minOrderCents: number
  minQty: number
  qtyIncrement: number
  enabled: boolean
}

export interface PriceChange {
  id: string
  scope: 'country' | 'customer' | 'customer_wide'
  scopeId: string
  variantId: string | null
  fromCents: number | null
  toCents: number | null
  fromPercentBp: number | null
  toPercentBp: number | null
  byName: string
  at: number
}

export interface TranslationSheet { language: string; done: number; total: number; rows: { key: string; en: string; value: string }[] }
export interface LanguageProgress { language: string; name: string; native: string; done: number; total: number }

/** The rules a business can be let off. */
export const EXEMPTIONS = ['min_order', 'min_qty', 'qty_increment'] as const
export type Exemption = (typeof EXEMPTIONS)[number]

/** The perfume categories the shop uses (the same list as the product editor). */
export const CATEGORIES = ['perfume', 'oud', 'mist', 'oil', 'set', 'home']

// ───────────────────────── money and percentages in a text box ─────────────────────────

/**
 * What someone typed into a dollar box, as whole cents — `null` when it is not a number at all, so the box can be
 * marked instead of quietly saving a wrong figure. Empty means nothing, which is how a price is taken away.
 */
export function toCents(text: string): number | null {
  const s = text.replace(/[\s$,٬]/g, '').replace('٫', '.')
  if (!s) return null
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null
  return Math.round(Number(s) * 100)
}

export const toDollars = (cents: number | null | undefined): string => (cents === null || cents === undefined ? '' : String(Math.round(cents) / 100))

/** `1750` ⇄ `17.5` — percentages are kept as basis points so nothing is ever half a cent out. */
export function toBp(text: string): number | null {
  const s = text.replace(/[\s%٪]/g, '').replace('٫', '.')
  if (!s) return null
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null
  const bp = Math.round(Number(s) * 100)
  return bp > 10000 ? null : bp
}

export const fromBp = (bp: number | null | undefined): string => (bp === null || bp === undefined ? '' : String(Math.round(bp) / 100))

/** `?q=…&missing=1`, leaving out anything empty. A GET may not carry a body, so filters go in the path. */
function query(params: Record<string, string | number | boolean | undefined | null>): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || v === false) continue
    q.set(k, v === true ? '1' : String(v))
  }
  const s = q.toString()
  return s ? `?${s}` : ''
}

// ───────────────────────── countries and languages ─────────────────────────

export const getCountries = () => api<{ countries: CatCountry[] }>('GET', '/catalogue/countries').then((r) => r.countries)

export interface CountryBody { iso2: string; name: Record<string, string>; language: string; enabled?: boolean; isDefault?: boolean; sort?: number; minOrderCents?: number }
export const saveCountry = (body: CountryBody, id?: string) =>
  api<{ country: CatCountry }>(id ? 'PUT' : 'POST', id ? `/catalogue/countries/${id}` : '/catalogue/countries', body).then((r) => r.country)
export const deleteCountry = (id: string) => api<{ ok: true }>('DELETE', `/catalogue/countries/${id}`)

export const getLanguages = () => api<{ languages: CatLanguage[] }>('GET', '/catalogue/languages').then((r) => r.languages)
export const saveLanguage = (body: Partial<CatLanguage> & { code: string }) => api<{ language: CatLanguage }>('PUT', '/catalogue/languages', body).then((r) => r.language)
export const deleteLanguage = (code: string) => api<{ ok: true }>('DELETE', `/catalogue/languages/${code}`)

// ───────────────────────── the words ─────────────────────────

export const getTranslations = (language: string) => api<TranslationSheet>('GET', `/catalogue/translations/${language}`)
export const saveTranslations = (language: string, values: Record<string, string>) =>
  api<{ changed: number }>('PUT', `/catalogue/translations/${language}`, { values }).then((r) => r.changed)
export const getProgress = () => api<{ languages: LanguageProgress[] }>('GET', '/catalogue/translations').then((r) => r.languages)

// ───────────────────────── who buys ─────────────────────────

export const getBuyers = (filters: { q?: string; status?: string; countryId?: string } = {}) =>
  api<{ customers: Buyer[] }>('GET', `/catalogue/customers${query(filters)}`).then((r) => r.customers)
export const getBuyer = (id: string) => api<{ customer: Buyer }>('GET', `/catalogue/customers/${id}`).then((r) => r.customer)

export type BuyerBody = Partial<Omit<Buyer, 'id' | 'country' | 'codes' | 'liveCodes' | 'ordersCount' | 'ordersValueCents' | 'createdAt'>> & { businessName: string }
export const saveBuyer = (body: BuyerBody, id?: string) =>
  api<{ customer: Buyer }>(id ? 'PUT' : 'POST', id ? `/catalogue/customers/${id}` : '/catalogue/customers', body).then((r) => r.customer)
export const setBuyerStatus = (id: string, status: CustomerStatus) =>
  api<{ customer: Buyer }>('PATCH', `/catalogue/customers/${id}/status`, { status }).then((r) => r.customer)

// ───────────────────────── access codes ─────────────────────────

/** Removes a business and everything that was only its own. Refused with `customer_has_orders` once it has traded. */
export const deleteBuyer = (id: string) => api<{ ok: true }>('DELETE', `/catalogue/customers/${id}`)

export const getCodes = (customerId: string) => api<{ codes: AccessCode[] }>('GET', `/catalogue/customers/${customerId}/codes`).then((r) => r.codes)
/** The one call that ever returns a code in full — show it once, then it is gone for good. */
export const generateCode = (customerId: string, body: { countryId?: string | null; expiresAt?: number | null } = {}) =>
  api<{ code: AccessCode; plain: string }>('POST', `/catalogue/customers/${customerId}/codes`, body)
export const setCodeActive = (codeId: string, active: boolean) => api<{ code: AccessCode }>('PATCH', `/catalogue/codes/${codeId}/active`, { active }).then((r) => r.code)
export const revokeCode = (codeId: string) => api<{ code: AccessCode }>('POST', `/catalogue/codes/${codeId}/revoke`).then((r) => r.code)

// ───────────────────────── prices ─────────────────────────

export const getCountryPrices = (countryId: string, filters: { q?: string; missing?: boolean } = {}) =>
  api<{ rows: PriceRow[] }>('GET', `/catalogue/prices/${countryId}${query(filters)}`).then((r) => r.rows)
export const saveCountryPrices = (countryId: string, prices: Record<string, number | null>) =>
  api<{ changed: number }>('PUT', `/catalogue/prices/${countryId}`, { prices }).then((r) => r.changed)

export const getTerms = (customerId: string) => api<{ prices: CustomerTerm[]; discount: Discount | null }>('GET', `/catalogue/customers/${customerId}/terms`)
export const saveTerms = (customerId: string, terms: Record<string, { priceCents?: number | null; percentBp?: number | null; validFrom?: number | null; validTo?: number | null }>) =>
  api<{ changed: number }>('PUT', `/catalogue/customers/${customerId}/terms`, { terms }).then((r) => r.changed)
export const setDiscount = (customerId: string, percentBp: number | null, validFrom?: number | null, validTo?: number | null) =>
  api<{ discount: Discount | null }>('PUT', `/catalogue/customers/${customerId}/discount`, { percentBp, validFrom, validTo }).then((r) => r.discount)

export const getPriceHistory = (filters: { scope?: string; scopeId?: string; variantId?: string; limit?: number } = {}) =>
  api<{ history: PriceChange[] }>('GET', `/catalogue/prices/history${query(filters)}`).then((r) => r.history)

// ───────────────────────── how little we will sell ─────────────────────────

export const getRules = () => api<{ rules: OrderRule[] }>('GET', '/catalogue/rules').then((r) => r.rules)
export const saveRule = (body: { scope: 'global' | 'category'; scopeId?: string; minOrderCents?: number; minQty?: number; qtyIncrement?: number; enabled?: boolean }) =>
  api<{ rule: OrderRule }>('PUT', '/catalogue/rules', body).then((r) => r.rule)
export const deleteRule = (id: string) => api<{ ok: true }>('DELETE', `/catalogue/rules/${id}`)

export const getExemptions = (customerId: string) => api<{ letOff: Exemption[] }>('GET', `/catalogue/customers/${customerId}/exemptions`).then((r) => r.letOff)
export const setExemptions = (customerId: string, letOff: Exemption[]) =>
  api<{ letOff: Exemption[] }>('PUT', `/catalogue/customers/${customerId}/exemptions`, { letOff }).then((r) => r.letOff)

// ───────────────────────── orders ─────────────────────────

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

export interface Reservation {
  status: 'active' | 'consumed' | 'released' | 'error'
  heldAt: number
  consumedAt: number | null
  releasedAt: number | null
  /** how long the bottles have been held — nothing ever releases them on its own */
  heldForMs: number | null
}

export interface OrderPayment {
  id: string
  orderId: string
  method: string
  amountCents: number
  status: 'pending' | 'confirmed' | 'failed' | 'refunded'
  reference: string
  note: string
  byName: string
  at: number
}

export interface WholesaleOrder {
  id: string
  number: string
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
  adminNote: string
  subtotalCents: number
  units: number
  minOrderCents: number
  paymentStatus: string
  paidCents: number
  placedAt: number
  decidedAt: number | null
  whatsappOpenedAt: number | null
  rejectReason: string
  customerId: string
  countryId: string | null
  country: { iso2: string; name: Record<string, string> } | null
  items: OrderItem[]
  reservation: Reservation | null
  history: { from: string; to: string; byName: string; reason: string; at: number }[] | null
  payments: OrderPayment[] | null
}

export const ORDER_STATUSES = ['pending_approval', 'approved', 'rejected', 'cancelled', 'integration_error'] as const
export const PAYMENT_METHODS = ['bank_transfer', 'cash', 'other'] as const

export const getOrders = (filters: { status?: string; q?: string; countryId?: string; customerId?: string } = {}) =>
  api<{ orders: WholesaleOrder[] }>('GET', `/catalogue/orders${query(filters)}`).then((r) => r.orders)
export const getOrder = (id: string) => api<{ order: WholesaleOrder }>('GET', `/catalogue/orders/${id}`).then((r) => r.order)

export const approveOrder = (id: string) => api<{ order: WholesaleOrder }>('POST', `/catalogue/orders/${id}/approve`).then((r) => r.order)
export const rejectOrder = (id: string, reason: string) => api<{ order: WholesaleOrder }>('POST', `/catalogue/orders/${id}/reject`, { reason }).then((r) => r.order)
export const cancelOrder = (id: string, reason: string) => api<{ order: WholesaleOrder }>('POST', `/catalogue/orders/${id}/cancel`, { reason }).then((r) => r.order)
export const releaseHold = (id: string, reason: string) => api<{ order: WholesaleOrder }>('POST', `/catalogue/orders/${id}/release-hold`, { reason }).then((r) => r.order)

export const recordPayment = (orderId: string, body: { method: string; amountCents: number; reference?: string; note?: string; status?: string }) =>
  api<{ payment: OrderPayment }>('POST', `/catalogue/orders/${orderId}/payments`, body).then((r) => r.payment)
export const setPaymentStatus = (paymentId: string, status: string) =>
  api<{ payment: OrderPayment }>('PATCH', `/catalogue/payments/${paymentId}`, { status }).then((r) => r.payment)
export const deletePayment = (paymentId: string) => api<{ ok: true }>('DELETE', `/catalogue/payments/${paymentId}`)

// ───────────────────────── how it looks, and what we say about the perfumes ─────────────────────────

export interface Brand {
  ink: string
  ivory: string
  gold: string
  wordmark: string
  tagline: string
  /** true while the theme is the house one rather than Lattafa's own kit */
  provisional: boolean
}

export interface Section { key: string; on: boolean }

export interface Homepage {
  headline: string
  lead: string
  hero: string | null
  sections: Section[]
}

export interface Footer { note: string; email: string; phone: string; instagram: string; website: string }

export interface Appearance { brand: Brand; homepage: Homepage; footer: Footer }

/** The sections the catalogue knows how to draw. Mirrors `AppearanceService::SECTIONS`. */
export const SECTIONS = ['hero', 'kinds', 'collections', 'featured', 'new', 'story', 'how'] as const

export interface Collection {
  id: string
  slug: string
  name: Record<string, string>
  description: Record<string, string>
  image: string | null
  enabled: boolean
  featured: boolean
  sort: number
  perfumes: number | null
  /** in order; null when the listing did not carry them */
  productIds: string[] | null
}

export interface CataloguePerfume {
  /** what the POS owns — shown here, never written from here */
  fromThePos: {
    id: string
    name: Record<string, string>
    description: Record<string, string>
    brand: string
    category: string
    gender: string
    concentration: string
    notes: { top: string[]; heart: string[]; base: string[] }
    image: string | null
    featured: boolean
    isNew: boolean
    active: boolean
  }
  hidden: boolean
  /** null = follow the product's own flag */
  featured: boolean | null
  images: { id: string; url: string; sort: number }[]
  translations: { language: string; name: string | null; description: string | null; notes: unknown }[]
  collections: string[]
}

export const getAppearance = () => api<Appearance>('GET', '/catalogue/appearance')
export const saveAppearance = (key: 'brand' | 'homepage' | 'footer', patch: Record<string, unknown>) =>
  api<Appearance>('PUT', `/catalogue/appearance/${key}`, { patch })
export const setHero = (image: string | null) => api<Appearance>('PUT', '/catalogue/appearance/hero', { image })

export const getCollections = () => api<{ collections: Collection[] }>('GET', '/catalogue/collections').then((r) => r.collections)
export const saveCollection = (body: Record<string, unknown>, id?: string) =>
  api<{ collection: Collection }>(id ? 'PUT' : 'POST', id ? `/catalogue/collections/${id}` : '/catalogue/collections', body).then((r) => r.collection)
export const deleteCollection = (id: string) => api<{ ok: true }>('DELETE', `/catalogue/collections/${id}`)
export const setCollectionProducts = (id: string, productIds: string[]) =>
  api<{ count: number }>('PUT', `/catalogue/collections/${id}/products`, { productIds }).then((r) => r.count)

export const getPerfume = (id: string) => api<CataloguePerfume>('GET', `/catalogue/perfumes/${id}`)
export const setPerfume = (id: string, body: { hidden?: boolean; featured?: boolean | null }) =>
  api<CataloguePerfume>('PUT', `/catalogue/perfumes/${id}`, body)
export const setPerfumeText = (id: string, language: string, body: { name?: string; description?: string }) =>
  api<CataloguePerfume>('PUT', `/catalogue/perfumes/${id}/text/${language}`, body)
export const addPerfumeImage = (id: string, image: string) => api<CataloguePerfume>('POST', `/catalogue/perfumes/${id}/images`, { image })
export const deletePerfumeImage = (imageId: string) => api<{ ok: true }>('DELETE', `/catalogue/images/${imageId}`)
