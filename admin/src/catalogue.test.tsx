// @vitest-environment jsdom
/**
 * Admin panel → Wholesale catalogue: the screens that let the owner run the international side without a developer.
 *
 * What is worth testing here is not that a table renders, but that the screen tells the truth about money and
 * permissions — an empty price box means "follow the dollar list", a price and a percentage together is refused
 * before it ever reaches the server, an access code is shown exactly once, and a tab nobody may open is not there.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within, type RenderResult } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ConfirmProvider } from '@/components/ui/Modal'
import { Toaster } from '@/components/ui/Toaster'
import type { Actor } from '@/data/types'
import { setApiToken } from '@/services/api'
import { setActor } from '@/services/context'
import { setServerMode } from '@/services/mode'
import { useSession } from '@/store/session'
import { useUI } from '@/store/ui'
import { db } from '@/data/db'
import { CatalogueSection } from './catalogue/CatalogueSection'
import { CountriesTab } from './catalogue/CountriesTab'
import { CustomersTab } from './catalogue/CustomersTab'
import { LookTab } from './catalogue/LookTab'
import { PerfumesTab } from './catalogue/PerfumesTab'
import { PricesTab } from './catalogue/PricesTab'
import { RulesTab } from './catalogue/RulesTab'
import { toCents, toBp, toDollars, fromBp } from './catalogue/api'

vi.mock('@/data/app', () => ({ APP: 'admin', DB_NAME: 'lattafa-admin-catalogue-test', SESSION_KEY: 'lattafa-admin-session' }))

const user = userEvent.setup({ delay: null })
const wait = { timeout: 10000 }

const actorWith = (permissions: string[]): Actor => ({
  id: 'u-1', name: 'Rand Owner', username: 'owner', roleId: 'r-1', roleKey: 'custom', roleName: 'Staff', color: '#D4A548',
  permissions, limits: { maxDiscountPct: 100, maxRefundIQD: 10_000_000 }, isSuperAdmin: permissions.includes('*'),
})

const TURKEY = { id: 'c-tr', iso2: 'TR', name: { en: 'Türkiye' }, language: 'tr', enabled: true, isDefault: true, sort: 1, minOrderCents: 50000, customers: 2 }
const IRAQ = { id: 'c-iq', iso2: 'IQ', name: { en: 'Iraq' }, language: 'ar', enabled: false, isDefault: false, sort: 2, minOrderCents: 0, customers: 0 }
const LANGUAGES = [
  { code: 'en', name: 'English', native: 'English', rtl: false, enabled: true, sort: 1 },
  { code: 'ar', name: 'Arabic', native: 'العربية', rtl: true, enabled: true, sort: 2 },
  { code: 'tr', name: 'Turkish', native: 'Türkçe', rtl: false, enabled: true, sort: 3 },
]
const PRICES = [
  // priced for Türkiye, and the dollar list underneath it
  { variantId: 'v-kham', productId: 'p-kham', name: 'Khamrah', brand: 'Lattafa', category: 'perfume', sku: 'KHAM-100', label: '100 ml', ml: 100, listCents: 1800, priceCents: 2400, effectiveCents: 2400 },
  // no price of its own: falls back to the list
  { variantId: 'v-asad', productId: 'p-asad', name: 'Asad', brand: 'Lattafa', category: 'perfume', sku: 'ASAD-100', label: '100 ml', ml: 100, listCents: 1900, priceCents: null, effectiveCents: 1900 },
  // priced nowhere at all
  { variantId: 'v-yara', productId: 'p-yara', name: 'Yara', brand: 'Lattafa', category: 'perfume', sku: 'YARA-50', label: '50 ml', ml: 50, listCents: 0, priceCents: null, effectiveCents: null },
]
const BUYER = {
  id: 'b-1', businessName: 'Istanbul Perfumes', contactPerson: 'Mert', email: '', phone: '', whatsapp: '+90 555 000 0000',
  countryId: 'c-tr', country: TURKEY, address: '', status: 'active' as const, notes: 'pays on time', posCustomerId: null,
  ordersCount: 0, ordersValueCents: 0, liveCodes: 1, codes: null, createdAt: 1,
}
const CODE = { id: 'k-1', customerId: 'b-1', display: 'LAT-••••3K7Q', countryId: null, active: true, revoked: false, expiresAt: null, revokedAt: null, uses: 3, lastUsedAt: 2, createdAt: 1 }

/* ───────── how it looks, and the perfumes in it ───────── */

const SECTIONS = ['hero', 'kinds', 'collections', 'featured', 'new', 'story', 'how']
const APPEARANCE = {
  brand: { ink: '#1A1714', ivory: '#FBF8F2', gold: '#D4A548', wordmark: 'LATTAFA', tagline: 'Est. Duhok', provisional: true },
  homepage: { headline: '', lead: '', hero: null, sections: SECTIONS.map((key) => ({ key, on: true })) },
  footer: { note: '', email: '', phone: '', instagram: '', website: '' },
}
const COLLECTION = {
  id: 'col-oud', slug: 'oud-collection', name: { en: 'Oud Collection' }, description: { en: 'The deep ones.' },
  image: null, enabled: true, featured: true, sort: 0, perfumes: 1, productIds: ['p-oud'],
}
const CATALOGUE_PERFUME = {
  fromThePos: {
    id: 'p-kham', name: { en: 'Khamrah', ar: '', ku: '' }, description: { en: 'Dates and vanilla.', ar: '', ku: '' },
    brand: 'Lattafa', category: 'perfume', gender: 'unisex', concentration: 'EDP',
    notes: { top: [], heart: [], base: [] }, image: null, featured: false, isNew: false, active: true,
  },
  hidden: false, featured: null as boolean | null, images: [], translations: [], collections: [],
}

/** Two perfumes in the till's own catalogue, which is where the wholesale screens read them from. */
async function seedPerfumes() {
  const shared = {
    description: { en: '', ar: '', ku: '' }, gender: 'unisex' as const, concentration: 'EDP', scentFamilies: [],
    notes: { top: [], heart: [], base: [] }, season: 'all' as const, longevity: 4, sillage: 3, image: null,
    art: { c1: '#C9A227', c2: '#7A5C12', shape: 'rect' as const }, showOnMenu: true, featured: false, isNew: false,
    active: true, createdAt: 1, updatedAt: 1,
  }
  await db.products.clear()
  await db.products.bulkPut([
    { ...shared, id: 'p-kham', name: { en: 'Khamrah', ar: 'خمرة', ku: 'خەمرە' }, brand: 'Lattafa', category: 'perfume' },
    { ...shared, id: 'p-oud', name: { en: 'Oud Mood', ar: 'عود مود', ku: 'عود مود' }, brand: 'Lattafa', category: 'oud' },
  ])

  // a perfume with nothing to sell is not in the catalogue at all, so each needs its size
  await db.variants.clear()
  await db.variants.bulkPut(['p-kham', 'p-oud'].map((productId) => ({
    id: `${productId}-100`, productId, label: '100 ml', size: 100, unit: 'ml' as const, ml: 100,
    sku: `${productId}-100`, barcode: '', costIQD: 0, retailIQD: 0, wholesaleIQD: 0, minStock: 0,
    isTester: false, active: true,
  })))
}

let calls: { method: string; path: string; body: unknown }[] = []

function stubServer(over: Record<string, unknown> = {}) {
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = url.replace('/api/v1', '')
    const method = init.method ?? 'GET'
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, path, body })
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })
    const bare = path.split('?')[0]!

    if (over[`${method} ${bare}`]) return json(over[`${method} ${bare}`])
    if (bare === '/catalogue/countries' && method === 'GET') return json({ countries: [TURKEY, IRAQ] })
    if (bare === '/catalogue/languages' && method === 'GET') return json({ languages: LANGUAGES })
    if (bare === '/catalogue/translations' && method === 'GET') return json({ languages: [] })
    if (bare === '/catalogue/customers' && method === 'GET') return json({ customers: [BUYER] })
    if (bare === '/catalogue/customers/b-1' && method === 'GET') return json({ customer: { ...BUYER, codes: [CODE] } })
    if (bare === '/catalogue/customers/b-1/exemptions' && method === 'GET') return json({ letOff: [] })
    if (bare === '/catalogue/customers/b-1/terms' && method === 'GET') return json({ prices: [], discount: null })
    if (bare === '/catalogue/customers/b-1/codes' && method === 'POST') return json({ code: CODE, plain: 'LAT-ZEQ93K7Q' }, 201)
    if (bare === '/catalogue/prices/c-tr' && method === 'GET') return json({ rows: PRICES })
    if (bare === '/catalogue/prices/history' && method === 'GET') return json({ history: [] })
    if (bare === '/catalogue/rules' && method === 'GET') return json({ rules: [] })
    if (bare === '/catalogue/appearance' && method === 'GET') return json(APPEARANCE)
    if (bare.startsWith('/catalogue/appearance') && method === 'PUT') return json(APPEARANCE)
    if (bare === '/catalogue/collections' && method === 'GET') return json({ collections: [COLLECTION] })
    if (bare === '/catalogue/perfumes/p-kham' && method === 'GET') return json(CATALOGUE_PERFUME)
    if (bare.startsWith('/catalogue/perfumes/') && method === 'PUT') return json(CATALOGUE_PERFUME)
    if (bare === '/catalogue/collections/col-oud/products' && method === 'PUT') return json({ count: 2 })
    if (method === 'PUT' || method === 'POST' || method === 'PATCH') return json({ changed: 1, ok: true, country: TURKEY, rule: {}, customer: BUYER, language: LANGUAGES[0] })
    return json({})
  })
}

/** The screen as the admin panel really wraps it: queries, confirm dialogs, and the toasts it answers with. */
function renderIn(node: ReactNode): RenderResult {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ConfirmProvider>{node}<Toaster /></ConfirmProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  setServerMode(true)
  useUI.setState({ lang: 'en', theme: 'light' })
  setApiToken('tok')
  setActor(actorWith(['*']))
  useSession.setState({ actor: actorWith(['*']), token: 'tok', locked: false, lastUserId: 'u-1' })
  calls = []
  stubServer()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

/* ───────── the money boxes, on their own ───────── */

describe('what someone typed into a money box', () => {
  it('reads dollars as whole cents, and refuses anything that is not a number', () => {
    expect(toCents('24.50')).toBe(2450)
    expect(toCents('$1,250.75')).toBe(125075)
    expect(toCents('18')).toBe(1800)
    expect(toCents('24.5')).toBe(2450)
    expect(toCents('')).toBeNull()      // empty is not zero: it means "no price here"
    expect(toCents('abc')).toBeNull()
    expect(toCents('24.555')).toBeNull()
    expect(toCents('-5')).toBeNull()
  })

  it('reads a percentage as basis points, and refuses more than all of it', () => {
    expect(toBp('17.5')).toBe(1750)
    expect(toBp('100')).toBe(10000)
    expect(toBp('0')).toBe(0)
    expect(toBp('101')).toBeNull()
    expect(toBp('')).toBeNull()
    expect(toBp('half')).toBeNull()
  })

  it('writes figures back the way they were typed', () => {
    expect(toDollars(2450)).toBe('24.5')
    expect(toDollars(null)).toBe('')
    expect(toDollars(0)).toBe('0')
    expect(fromBp(1750)).toBe('17.5')
    expect(fromBp(null)).toBe('')
  })
})

/* ───────── which tabs a person sees ───────── */

describe('who sees what', () => {
  it('a Sales Manager gets prices and buyers; a Catalogue Manager gets neither', async () => {
    useSession.setState({ actor: actorWith(['catalogue.view', 'catalogue.customers', 'catalogue.prices', 'catalogue.codes', 'catalogue.rules']) })
    renderIn(<CatalogueSection />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Prices' })).toBeInTheDocument(), wait)
    expect(screen.getByRole('button', { name: 'Wholesale customers' })).toBeInTheDocument()

    cleanup()
    useSession.setState({ actor: actorWith(['catalogue.view', 'catalogue.products', 'catalogue.countries', 'catalogue.translations']) })
    renderIn(<CatalogueSection />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Countries' })).toBeInTheDocument(), wait)
    expect(screen.queryByRole('button', { name: 'Prices' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Wholesale customers' })).not.toBeInTheDocument()
  })
})

/* ───────── countries ───────── */

describe('countries', () => {
  it('shows where the catalogue is open, in what language, and for how little', async () => {
    renderIn(<CountriesTab canEdit />)
    const row = await waitFor(() => screen.getByText('Türkiye').closest('tr')!, wait)

    expect(within(row).getByText('Türkçe')).toBeInTheDocument()
    expect(within(row).getByText('$500')).toBeInTheDocument()
    expect(within(row).getByText('Open')).toBeInTheDocument()
    expect(within(row).getByText('Offered first')).toBeInTheDocument()
    expect(within(screen.getByText('Iraq').closest('tr')!).getByText('Closed')).toBeInTheDocument()
  })

  it('sends a new country with its smallest order in whole cents', async () => {
    renderIn(<CountriesTab canEdit />)
    await waitFor(() => expect(screen.getByText('Türkiye')).toBeInTheDocument(), wait)

    await user.click(screen.getByRole('button', { name: 'Add a country' }))
    await user.type(screen.getByLabelText('Country code'), 'de')
    await user.type(screen.getByLabelText('English'), 'Germany')
    await user.type(screen.getByLabelText('Smallest order'), '750')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/catalogue/countries')).toBe(true), wait)
    const sent = calls.find((c) => c.method === 'POST' && c.path === '/catalogue/countries')!.body as Record<string, unknown>
    expect(sent.iso2).toBe('DE')                      // typed in lower case, sent as the code
    expect(sent.minOrderCents).toBe(75000)            // $750.00
    expect((sent.name as Record<string, string>).en).toBe('Germany')
  })

  it('hides every way of changing anything from someone who may only look', async () => {
    renderIn(<CountriesTab canEdit={false} />)
    await waitFor(() => expect(screen.getByText('Türkiye')).toBeInTheDocument(), wait)

    expect(screen.queryByRole('button', { name: 'Add a country' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })
})

/* ───────── prices ───────── */

describe('a country’s prices', () => {
  it('shows the dollar list underneath, and what a buyer actually pays', async () => {
    renderIn(<PricesTab />)
    await waitFor(() => expect(screen.getByText('Khamrah')).toBeInTheDocument(), wait)

    // its own price wins
    expect(within(screen.getByText('Khamrah').closest('tr')!).getByDisplayValue('24')).toBeInTheDocument()
    // no price of its own: the box is empty and the list is what they pay
    const asad = screen.getByText('Asad').closest('tr')!
    expect(within(asad).getByLabelText('Asad 100 ml — This country')).toHaveValue('')
    // the dollar list and what they pay are the same figure, because there is nothing on top of it
    expect(within(asad).getAllByText('$19')).toHaveLength(2)
    // priced nowhere: it cannot be ordered, and the screen says so rather than showing $0
    expect(within(screen.getByText('Yara').closest('tr')!).getByText('No price')).toBeInTheDocument()
  })

  it('sends a typed price in cents, and an emptied box as "no price"', async () => {
    renderIn(<PricesTab />)
    await waitFor(() => expect(screen.getByText('Khamrah')).toBeInTheDocument(), wait)

    await user.clear(screen.getByLabelText('Khamrah 100 ml — This country'))
    await user.type(screen.getByLabelText('Asad 100 ml — This country'), '21.5')
    await user.click(screen.getByRole('button', { name: /^Save/ }))

    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.path.startsWith('/catalogue/prices/'))).toBe(true), wait)
    const sent = (calls.find((c) => c.method === 'PUT' && c.path.startsWith('/catalogue/prices/'))!.body as { prices: Record<string, number | null> }).prices
    expect(sent['v-asad']).toBe(2150)
    expect(sent['v-kham']).toBeNull()                 // cleared = falls back to the dollar list
  })

  it('will not save a box that is not a number', async () => {
    renderIn(<PricesTab />)
    await waitFor(() => expect(screen.getByText('Khamrah')).toBeInTheDocument(), wait)

    await user.clear(screen.getByLabelText('Khamrah 100 ml — This country'))
    await user.type(screen.getByLabelText('Khamrah 100 ml — This country'), 'twenty')
    await user.click(screen.getByRole('button', { name: /^Save/ }))

    await waitFor(() => expect(screen.getByText('That is not a number.')).toBeInTheDocument(), wait)
    expect(calls.some((c) => c.method === 'PUT' && c.path.startsWith('/catalogue/prices/'))).toBe(false)
  })

  it('can narrow the list to sizes nobody could order', async () => {
    renderIn(<PricesTab />)
    await waitFor(() => expect(screen.getByText('Khamrah')).toBeInTheDocument(), wait)

    await user.click(screen.getByRole('button', { name: 'Missing a price' }))
    await waitFor(() => expect(screen.queryByText('Khamrah')).not.toBeInTheDocument(), wait)
    expect(screen.getByText('Yara')).toBeInTheDocument()
    expect(screen.queryByText('Asad')).not.toBeInTheDocument()   // it has the dollar list to fall back on
  })
})

/* ───────── buyers and their codes ───────── */

describe('wholesale customers', () => {
  it('lists the businesses with their country and how many codes work', async () => {
    renderIn(<CustomersTab canEditPrices canEditRules />)
    const row = await waitFor(() => screen.getByText('Istanbul Perfumes').closest('tr')!, wait)

    expect(within(row).getByText('Türkiye')).toBeInTheDocument()
    expect(within(row).getByText('Mert')).toBeInTheDocument()
    expect(within(row).getByText('Buying')).toBeInTheDocument()
  })

  it('shows a new access code once, in full, and never again', async () => {
    renderIn(<CustomersTab canEditPrices canEditRules />)
    await user.click(await waitFor(() => screen.getByText('Istanbul Perfumes'), wait))
    await user.click(await waitFor(() => screen.getByRole('button', { name: 'Access codes' }), wait))

    // what is on file shows only the last four characters
    await waitFor(() => expect(screen.getByText('LAT-••••3K7Q')).toBeInTheDocument(), wait)
    expect(screen.queryByText(/LAT-ZEQ9/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'New code' }))
    await waitFor(() => expect(screen.getByText('LAT-ZEQ93K7Q')).toBeInTheDocument(), wait)
    expect(screen.getByText(/cannot be read again/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'I have written it down' }))
    await waitFor(() => expect(screen.queryByText('LAT-ZEQ93K7Q')).not.toBeInTheDocument(), wait)
  })

  it('keeps our own notes about a business on this side of the counter', async () => {
    renderIn(<CustomersTab canEditPrices canEditRules />)
    await user.click(await waitFor(() => screen.getByText('Istanbul Perfumes'), wait))

    await waitFor(() => expect(screen.getByText('pays on time')).toBeInTheDocument(), wait)
    expect(screen.getByText('Our notes')).toBeInTheDocument()
    // and they are never part of what the buyer's own session would carry
    expect(calls.every((c) => c.method === 'GET')).toBe(true)
  })
})

/* ───────── order rules ───────── */

describe('order rules', () => {
  it('refuses a smallest quantity that is not a whole number of steps', async () => {
    renderIn(<RulesTab canEdit />)
    await waitFor(() => expect(screen.getByText('The general rule')).toBeInTheDocument(), wait)

    await user.type(screen.getByLabelText('Smallest quantity'), '7')
    await user.type(screen.getByLabelText('In steps of'), '6')

    await waitFor(() => expect(screen.getByText(/can never be satisfied/)).toBeInTheDocument(), wait)
    await user.click(screen.getAllByRole('button', { name: 'Save' })[0]!)
    expect(calls.some((c) => c.method === 'PUT' && c.path === '/catalogue/rules')).toBe(false)
  })

  it('spells out the quantities a buyer may order', async () => {
    renderIn(<RulesTab canEdit />)
    await waitFor(() => expect(screen.getByText('The general rule')).toBeInTheDocument(), wait)

    await user.type(screen.getByLabelText('Smallest quantity'), '6')
    await user.type(screen.getByLabelText('In steps of'), '6')

    await waitFor(() => expect(screen.getByText(/Allowed: 6, 12, 18, 24…/)).toBeInTheDocument(), wait)
  })

  it('shows each country’s own smallest order, which is set with the country', async () => {
    renderIn(<RulesTab canEdit />)
    const section = await waitFor(() => screen.getByText('Smallest order, by country').closest('div')!, wait)

    expect(within(section).getByText('$500')).toBeInTheDocument()
    expect(within(section).getByText('follows the general rule')).toBeInTheDocument()
  })
})

/* ───────── how the catalogue looks ───────── */

describe('how the catalogue looks', () => {
  it('shows the three colours, and says plainly that they are provisional', async () => {
    renderIn(<LookTab canEdit />)
    await waitFor(() => expect(screen.getByLabelText('Pick Gold')).toHaveValue('#d4a548'), wait)

    // the switch carries words a person can read, not only an aria-label
    expect(screen.getByText('Mark the look as provisional')).toBeInTheDocument()
    expect(screen.getByText('Provisional')).toBeInTheDocument()
  })

  it('saves the sections in the order the owner moved them into', async () => {
    renderIn(<LookTab canEdit />)
    const list = await waitFor(() => screen.getByText('Sections, in order').parentElement!.querySelector('ul')!, wait)

    // "Browse by kind" is second; one tap up puts it first
    const kinds = within(list).getByText('Browse by kind').closest('li')!
    await user.click(within(kinds).getByRole('button', { name: 'Move up' }))
    await user.click(screen.getAllByRole('button', { name: 'Save' })[1]!)

    const saved = await waitFor(() => calls.find((c) => c.method === 'PUT' && c.path === '/catalogue/appearance/homepage')!, wait)
    const patch = (saved.body as { patch: { sections: { key: string }[] } }).patch
    expect(patch.sections.map((s) => s.key)).toEqual(['kinds', 'hero', 'collections', 'featured', 'new', 'story', 'how'])
  })

  it('a reader sees the look but is given no way to change it', async () => {
    renderIn(<LookTab canEdit={false} />)
    await waitFor(() => expect(screen.getByLabelText('Pick Gold')).toBeDisabled(), wait)

    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Move up' })).not.toBeInTheDocument()
  })
})

/* ───────── the perfumes, as the catalogue shows them ───────── */

describe('a perfume in the catalogue', () => {
  beforeEach(seedPerfumes)

  it('shows what the shop owns without offering to change it here', async () => {
    renderIn(<PerfumesTab canEdit canTranslate />)
    await user.click(await waitFor(() => screen.getByText('Khamrah'), wait))

    const shop = await waitFor(() => screen.getByText('From the shop').closest('div')!, wait)
    expect(within(shop).getByText('Lattafa')).toBeInTheDocument()
    // the POS owns the perfume: this panel is facts, not fields
    expect(within(shop).queryAllByRole('textbox')).toEqual([])
    expect(screen.getByText('Owned by Products — change it there and the tills, the menu and the delegates see it too.')).toBeInTheDocument()
  })

  it('hides a perfume from the catalogue without touching the perfume', async () => {
    renderIn(<PerfumesTab canEdit canTranslate />)
    await user.click(await waitFor(() => screen.getByText('Khamrah'), wait))
    await user.click(await waitFor(() => screen.getByRole('switch', { name: 'Show in the catalogue' }), wait))

    const sent = await waitFor(() => calls.find((c) => c.method === 'PUT' && c.path === '/catalogue/perfumes/p-kham')!, wait)
    expect(sent.body).toEqual({ hidden: true })
    // nothing was sent to the products endpoint the tills read
    expect(calls.filter((c) => c.path.startsWith('/products'))).toEqual([])
  })

  it('writes the words of one language without disturbing the others', async () => {
    renderIn(<PerfumesTab canEdit canTranslate />)
    await user.click(await waitFor(() => screen.getByText('Khamrah'), wait))

    const name = await waitFor(() => screen.getByLabelText('Name', { selector: 'input' }), wait)
    await user.type(name, 'Khamrah (Türkiye)')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    const sent = await waitFor(() => calls.find((c) => c.method === 'PUT' && c.path.startsWith('/catalogue/perfumes/p-kham/text/'))!, wait)
    expect(sent.path).toBe('/catalogue/perfumes/p-kham/text/ar')
    expect(sent.body).toEqual({ name: 'Khamrah (Türkiye)', description: '' })
  })

  it('a collection starts from the perfumes already in it and sends the whole list back', async () => {
    renderIn(<PerfumesTab canEdit canTranslate />)
    await user.click(await waitFor(() => screen.getByRole('button', { name: 'Collections' }), wait))
    await user.click(await waitFor(() => screen.getByRole('button', { name: 'Choose perfumes' }), wait))

    // "Oud Mood" is already in it, so the button offers to save the one it has
    const dialog = await waitFor(() => screen.getByRole('dialog'), wait)
    expect(within(dialog).getByRole('button', { name: 'Save 1' })).toBeInTheDocument()

    await user.click(within(dialog).getByText('Khamrah'))
    await user.click(within(dialog).getByRole('button', { name: 'Save 2' }))

    const sent = await waitFor(() => calls.find((c) => c.method === 'PUT' && c.path === '/catalogue/collections/col-oud/products')!, wait)
    expect(sent.body).toEqual({ productIds: ['p-oud', 'p-kham'] })
  })
})
