// @vitest-environment jsdom
/**
 * The wholesale catalogue as a buyer meets it.
 *
 * The test that matters most is the one about prices: a visitor who has not entered a code must not be able to
 * find a figure anywhere in the page, because the server never sent one. The rest is the way through — welcome,
 * country, the collection, a perfume, the order — and the arithmetic the catalogue does on the buyer's behalf.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CatalogueApp } from './CatalogueApp'
import { NO_FILTERS, sift } from './screens/Browse'
import { useCatalogue } from './store'
import type { Look, Perfume } from './api'

const user = userEvent.setup({ delay: null })
const wait = { timeout: 10000 }

const WORDS = {
  'cat.welcome_title': 'The Wholesale Collection',
  'cat.welcome_lead': 'For perfume shops, distributors and retailers.',
  'cat.explore': 'Explore the collection',
  'cat.choose_country': 'Where are you buying from?',
  'cat.country_search': 'Search countries',
  'cat.change_country': 'Change country',
  'cat.locked_prices': 'Unlock wholesale prices',
  'cat.unlock_title': 'Your wholesale access code',
  'cat.unlock_lead': 'Enter the code Lattafa gave your business.',
  'cat.unlock_cta': 'Unlock',
  'cat.code_label': 'Access code',
  'cat.lock': 'Sign out',
  'cat.err_code_invalid': 'That code was not recognised.',
  'cat.err_min_order': 'Minimum wholesale order: {minimum}. Add {add} more to continue.',
  'cat.err_qty_step': '{sku}: in steps of {step} bottles.',
  'cat.in_stock': 'In stock',
  'cat.out_of_stock': 'Out of stock',
  'cat.home': 'Home',
  'cat.all_perfumes': 'All perfumes',
  'cat.search': 'Search perfumes',
  'cat.favourites': 'Favourites',
  'cat.your_order': 'Your order',
  'cat.menu': 'Menu',
  'cat.close': 'Close',
  'cat.new': 'New',
  'cat.featured': 'Featured',
  'cat.kind_perfume': 'Perfume',
  'cat.kind_oud': 'Oud',
  'cat.sizes': 'Sizes',
  'cat.add_to_order': 'Add to order',
  'cat.remove': 'Remove',
  'cat.subtotal': 'Subtotal',
  'cat.ready_to_send': 'Ready to send',
  'cat.send_order': 'Send this order',
  'cat.prices_usd': 'All prices are in US dollars.',
  'cat.unlock_to_order': 'Enter your access code to see prices and order.',
  'cat.min_qty': 'Minimum {qty} bottles.',
  'cat.qty_step': 'In steps of {step} bottles.',
  // sending it
  'cat.co_title': 'Send your order',
  'cat.co_business': 'Business name',
  'cat.co_contact': 'Contact person',
  'cat.co_phone': 'Phone',
  'cat.co_whatsapp': 'WhatsApp',
  'cat.co_email': 'Email',
  'cat.co_address': 'Delivery address',
  'cat.co_note': 'Anything we should know',
  'cat.co_via_whatsapp': 'Order via WhatsApp',
  'cat.co_place': 'Place the order',
  'cat.co_pending_hint': 'Either way, your order reaches us the same.',
  'cat.co_thanks': 'Thank you — we have your order',
  'cat.co_reference': 'Your reference',
  'cat.co_pending': 'Waiting for Lattafa to confirm it. Nothing ships until we do.',
  'cat.co_keep_browsing': 'Keep browsing',
  'cat.back': 'Back',
  // the homepage sections
  'cat.shop_by_kind': 'Shop by kind',
  'cat.new_arrivals': 'New arrivals',
  'cat.story_title': 'Made in the Emirates, worn everywhere',
  'cat.story_body': 'Lattafa blends oud, amber and florals in the Gulf tradition.',
  'cat.how_title': 'How wholesale works',
  'cat.how_1': 'Browse the whole collection — no code needed.',
  'cat.how_2': 'Enter the code we gave your business to see your own prices.',
  'cat.how_3': 'Build your order and send it.',
  // how it looks
  'cat.collections': 'Collections',
  'cat.look_provisional': 'The colours and wordmark on this page are a working placeholder, not official Lattafa branding.',
  'cat.photograph_n': 'Photograph {n}',
}

const TURKEY = { id: 'c-tr', iso2: 'TR', name: { en: 'Türkiye' }, language: 'en', minOrderCents: 50000, isDefault: true }
const IRAQ = { id: 'c-iq', iso2: 'IQ', name: { en: 'Iraq' }, language: 'en', minOrderCents: 0, isDefault: false }

const perfume = (id: string, name: string, over: Partial<Perfume> = {}): Perfume => ({
  id,
  name,
  description: `${name} description`,
  notes: { top: ['bergamot'], heart: ['rose'], base: ['oud'] },
  brand: 'Lattafa',
  category: 'perfume',
  gender: 'unisex',
  concentration: 'EDP',
  scentFamilies: ['oriental'],
  season: 'all',
  longevity: 4,
  sillage: 3,
  image: null,
  images: [],
  art: { c1: '#C9A227', c2: '#7A5C12', shape: 'rect' },
  featured: false,
  isNew: false,
  sizes: [{ variantId: `${id}-100`, sku: `${name.toUpperCase()}-100`, label: '100 ml', size: 100, unit: 'ml', ml: 100, minQty: 6, step: 6 }],
  ...over,
})

const PRODUCTS = [
  perfume('p-kham', 'Khamrah', { featured: true }),
  perfume('p-asad', 'Asad', { isNew: true }),
  perfume('p-oud', 'Oud Mood', { category: 'oud', sizes: [{ variantId: 'p-oud-100', sku: 'OUD-100', label: '100 ml', size: 100, unit: 'ml', ml: 100, minQty: 2, step: 2 }] }),
]

const COLLECTIONS = [
  { id: 'col-oud', slug: 'oud-collection', name: 'Oud Collection', description: 'The deep ones.', image: null, featured: true, products: ['p-oud'] },
]

/** The look as the owner left it: the house theme, and the sections in the order the admin panel saved them. */
const HOUSE_BRAND = { ink: '#1A1714', ivory: '#FBF8F2', gold: '#D4A548', wordmark: 'LATTAFA', tagline: 'Est. Duhok', provisional: true }
const SECTIONS = ['hero', 'kinds', 'collections', 'featured', 'new', 'story', 'how']
const houseLook = (): Look => ({
  brand: { ...HOUSE_BRAND },
  sections: SECTIONS.map((key) => ({ key, on: true })),
  headline: '',
  lead: '',
  hero: null,
  footer: { note: '', email: '', phone: '', instagram: '', website: '' },
})

/** What `GET /open` hands back this test. A test that is about the look rearranges it before rendering. */
let LOOK = houseLook()

let calls: string[] = []
/** every Idempotency-Key the catalogue sent, so a double press can be told from two orders */
let keys: string[] = []
let unlockFails = false

function stubServer() {
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = url.replace('/api/v1/wholesale', '').split('?')[0]!
    calls.push(`${init.method ?? 'GET'} ${path}`)
    const key = (init.headers as Record<string, string> | undefined)?.['Idempotency-Key']
    if (key) keys.push(key)
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })

    if (path === '/open') {
      return json({
        countries: [TURKEY, IRAQ], languages: [{ code: 'en', name: 'English', native: 'English', rtl: false }],
        defaultCountryId: 'c-tr', language: 'en', words: WORDS, currency: 'USD', whatsapp: '',
        look: LOOK,
      })
    }
    if (path === '/products') {
      return json({
        language: 'en', products: PRODUCTS,
        categories: [{ key: 'perfume', count: 2 }, { key: 'oud', count: 1 }], brands: ['Lattafa'],
        collections: COLLECTIONS,
      })
    }
    if (path === '/unlock') {
      if (unlockFails) return json({ error: { code: 'code_invalid', params: {} } }, 422)
      return json({ token: 'tok-1', session: { business: 'Istanbul Perfumes', contactPerson: 'Mert', country: TURKEY, expiresAt: 9e12 } })
    }
    if (path === '/me') return json({ session: { business: 'Istanbul Perfumes', contactPerson: 'Mert', country: TURKEY, expiresAt: 9e12 } })
    if (path === '/prices') {
      return json({
        minOrderCents: 50000,
        lines: [
          { variantId: 'p-kham-100', productId: 'p-kham', sku: 'KHAMRAH-100', label: '100 ml', ml: 100, category: 'perfume', priceCents: 2400, source: 'country', minQty: 6, step: 6 },
          { variantId: 'p-asad-100', productId: 'p-asad', sku: 'ASAD-100', label: '100 ml', ml: 100, category: 'perfume', priceCents: 1900, source: 'customer', minQty: 6, step: 6 },
          // the one that used to be out of stock: priced, and so orderable like any other
          { variantId: 'p-oud-100', productId: 'p-oud', sku: 'OUD-100', label: '100 ml', ml: 100, category: 'oud', priceCents: 3200, source: 'country', minQty: 2, step: 2 },
        ],
      })
    }
    if (path === '/quote') {
      const body = JSON.parse(String(init.body)) as { lines: { variantId: string; qty: number }[] }
      const qty = body.lines[0]?.qty ?? 0
      const subtotal = qty * 2400
      const short = Math.max(0, 50000 - subtotal)
      return json({
        ok: short === 0,
        units: qty,
        subtotalCents: subtotal,
        minOrderCents: 50000,
        shortfallCents: short,
        lines: [{ variantId: 'p-kham-100', sku: 'KHAMRAH-100', label: '100 ml', qty, unitCents: 2400, lineCents: subtotal, minQty: 6, step: 6, source: 'country', problems: [] }],
        problems: short > 0 ? [{ code: 'min_order', params: { minimum: 50000, add: short } }] : [],
      })
    }
    if (path === '/lock') return json({ ok: true })
    if (path === '/orders' && (init.method ?? 'GET') === 'POST') {
      const body = JSON.parse(String(init.body)) as { lines: { qty: number }[]; method: string }
      const units = body.lines.reduce((n, l) => n + l.qty, 0)
      return json({
        order: {
          id: 'o-1', number: 'LAT-10025', reference: 'H9BJHFRHAI', status: 'pending_approval', method: body.method,
          businessName: 'Istanbul Perfumes', contactPerson: 'Mert', phone: '', whatsapp: '', email: '', address: '', note: '',
          subtotalCents: units * 2400, units, minOrderCents: 50000, currency: 'USD', paymentStatus: 'unpaid', paidCents: 0,
          placedAt: 1, decidedAt: null, whatsappOpenedAt: null, rejectReason: '', items: [],
        },
      }, 201)
    }
    return json({})
  })
}

/** Straight to the collection, with the welcome and the country already behind us. */
function alreadyIn(over: Partial<ReturnType<typeof useCatalogue.getState>> = {}) {
  useCatalogue.setState({ entered: true, countryId: 'c-tr', language: 'en', dir: 'ltr', htmlLang: 'en', token: null, favourites: [], basket: {}, ...over })
}

beforeEach(() => {
  localStorage.clear()
  calls = []
  keys = []
  unlockFails = false
  LOOK = houseLook()
  document.documentElement.removeAttribute('style')
  useCatalogue.setState({ entered: false, countryId: null, language: 'en', dir: 'ltr', htmlLang: 'en', token: null, favourites: [], basket: {} })
  stubServer()
  window.scrollTo = () => {}
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

/* ───────────────────────── filtering, on its own ───────────────────────── */

describe('finding a perfume', () => {
  it('matches a name, a house, a note or the code off the box', () => {
    expect(sift(PRODUCTS, 'khamrah', NO_FILTERS).map((p) => p.id)).toEqual(['p-kham'])
    expect(sift(PRODUCTS, 'lattafa', NO_FILTERS)).toHaveLength(3)
    expect(sift(PRODUCTS, 'rose', NO_FILTERS)).toHaveLength(3)       // a heart note every one of them shares
    expect(sift(PRODUCTS, 'ASAD-100', NO_FILTERS).map((p) => p.id)).toEqual(['p-asad'])
    expect(sift(PRODUCTS, 'nothing like this', NO_FILTERS)).toEqual([])
  })

  it('narrows by kind', () => {
    expect(sift(PRODUCTS, '', { ...NO_FILTERS, kind: 'oud' }).map((p) => p.id)).toEqual(['p-oud'])
    expect(sift(PRODUCTS, '', NO_FILTERS)).toHaveLength(3)
    expect(sift(PRODUCTS, '', { ...NO_FILTERS, kind: 'mist' })).toEqual([])
  })
})

/* ───────────────────────── the way in ───────────────────────── */

describe('arriving', () => {
  it('shows the house, then asks where the buyer is shopping from', async () => {
    render(<CatalogueApp />)

    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('LATTAFA'), wait)
    expect(screen.getByText('The Wholesale Collection')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Explore the collection' }))
    await waitFor(() => expect(screen.getByText('Where are you buying from?')).toBeInTheDocument(), wait)
    expect(screen.getByText('Türkiye')).toBeInTheDocument()
  })

  it('remembers the country, and the collection follows', async () => {
    render(<CatalogueApp />)
    await user.click(await waitFor(() => screen.getByRole('button', { name: 'Explore the collection' }), wait))
    await user.click(await waitFor(() => screen.getByText('Türkiye'), wait))

    await waitFor(() => expect(screen.getByText('Khamrah')).toBeInTheDocument(), wait)
    expect(useCatalogue.getState().countryId).toBe('c-tr')
    expect(calls).toContain('GET /products')
  })

  it('changing country throws away a session opened for another one', () => {
    alreadyIn({ token: 'tok-1', basket: { 'p-kham-100': 12 } })
    useCatalogue.getState().setCountry('c-iq', 'en', false)

    expect(useCatalogue.getState().token).toBeNull()
    expect(useCatalogue.getState().basket).toEqual({})
  })
})

/* ───────────────────────── the rule the catalogue rests on ───────────────────────── */

describe('prices', () => {
  it('shows no figure anywhere until a code has been entered', async () => {
    alreadyIn()
    const { container } = render(<CatalogueApp />)
    await waitFor(() => expect(screen.getByText('Khamrah')).toBeInTheDocument(), wait)

    expect(container.textContent).not.toMatch(/\$\s?\d/)
    expect(screen.getAllByText('Unlock wholesale prices').length).toBeGreaterThan(0)
    // and the catalogue never even asked for prices
    expect(calls).not.toContain('GET /prices')
  })

  it('shows this buyer’s own prices once the code is accepted', async () => {
    alreadyIn()
    render(<CatalogueApp />)
    await waitFor(() => expect(screen.getByText('Khamrah')).toBeInTheDocument(), wait)

    await user.click(screen.getAllByRole('button', { name: /Unlock wholesale prices/ })[0]!)
    await user.type(await waitFor(() => screen.getByLabelText('Access code'), wait), 'LAT-ZEQ93K7Q')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))

    await waitFor(() => expect(screen.getByText('$24.00')).toBeInTheDocument(), wait)
    expect(screen.getByText('$19.00')).toBeInTheDocument()    // the price agreed with this business
    expect(screen.getByRole('button', { name: /Istanbul Perfumes/ })).toBeInTheDocument()
  })

  it('says plainly when a code is not recognised, and stays shut', async () => {
    alreadyIn()
    unlockFails = true
    render(<CatalogueApp />)
    await waitFor(() => expect(screen.getByText('Khamrah')).toBeInTheDocument(), wait)

    await user.click(screen.getAllByRole('button', { name: /Unlock wholesale prices/ })[0]!)
    await user.type(await waitFor(() => screen.getByLabelText('Access code'), wait), 'LAT-ZZZZZZZZ')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('That code was not recognised.'), wait)
    expect(useCatalogue.getState().token).toBeNull()
  })

  it('a session the server no longer honours quietly goes back to browsing', async () => {
    alreadyIn({ token: 'stale' })
    vi.stubGlobal('fetch', async (url: string) => {
      const path = url.replace('/api/v1/wholesale', '').split('?')[0]!
      const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })
      if (path === '/open') return json({ countries: [TURKEY], languages: [{ code: 'en', name: 'English', native: 'English', rtl: false }], defaultCountryId: 'c-tr', language: 'en', words: WORDS, currency: 'USD' })
      if (path === '/products') return json({ language: 'en', products: PRODUCTS, categories: [], brands: [] })
      return json({ error: { code: 'not_unlocked', params: {} } }, 401)
    })

    render(<CatalogueApp />)
    await waitFor(() => expect(useCatalogue.getState().token).toBeNull(), wait)
  })
})

/* ───────────────────────── a perfume, and the order ───────────────────────── */

describe('ordering', () => {
  const openKhamrah = async () => {
    render(<CatalogueApp />)
    await user.click(await waitFor(() => screen.getByText('Khamrah'), wait))
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Khamrah'), wait)
  }

  it('a perfume reads properly without being able to be ordered', async () => {
    alreadyIn()
    await openKhamrah()

    expect(screen.getByText('Khamrah description')).toBeInTheDocument()
    expect(screen.getByText(/bergamot/)).toBeInTheDocument()
    expect(screen.getByText('Enter your access code to see prices and order.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add to order' })).not.toBeInTheDocument()
  })

  it('counts in the steps the shop sells in', async () => {
    alreadyIn({ token: 'tok-1' })
    await openKhamrah()

    const add = await waitFor(() => screen.getByRole('button', { name: 'Add to order' }), wait)
    await user.click(add)
    expect(useCatalogue.getState().basket['p-kham-100']).toBe(6)   // the first + lands on the smallest allowed
    await user.click(add)
    expect(useCatalogue.getState().basket['p-kham-100']).toBe(12)  // then six at a time, never seven

    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(useCatalogue.getState().basket['p-kham-100']).toBe(6)
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(useCatalogue.getState().basket['p-kham-100']).toBeUndefined()
  })

  it('shows the server’s own total, and what is still missing from it', async () => {
    alreadyIn({ token: 'tok-1', basket: { 'p-kham-100': 6 } })
    render(<CatalogueApp />)

    await user.click(await waitFor(() => screen.getByRole('button', { name: 'Your order' }), wait))

    // 6 × $24.00, as the server adds it up — once on the line, once as the subtotal
    const subtotal = await waitFor(() => screen.getByText('Subtotal').closest('div')!, wait)
    expect(within(subtotal).getByText('$144.00')).toBeInTheDocument()
    expect(screen.getByText(/Minimum wholesale order: \$500\.00\. Add \$356\.00 more to continue\./)).toBeInTheDocument()
    expect(screen.queryByText('Ready to send')).not.toBeInTheDocument()
  })

  it('says an order is ready once it clears the minimum', async () => {
    alreadyIn({ token: 'tok-1', basket: { 'p-kham-100': 24 } })
    render(<CatalogueApp />)

    await user.click(await waitFor(() => screen.getByRole('button', { name: 'Your order' }), wait))
    await waitFor(() => expect(screen.getByText('Ready to send')).toBeInTheDocument(), wait)
    expect(within(screen.getByText('Subtotal').closest('div')!).getByText('$576.00')).toBeInTheDocument()
  })

  it('keeps what the buyer saved, across a reload', async () => {
    alreadyIn({ favourites: ['p-asad'] })
    render(<CatalogueApp />)

    await user.click(await waitFor(() => screen.getByRole('button', { name: 'Favourites' }), wait))
    await waitFor(() => expect(screen.getByText('Asad')).toBeInTheDocument(), wait)
    expect(screen.queryByText('Khamrah')).not.toBeInTheDocument()
  })
})

/* ───────────────────────── sending it ───────────────────────── */

describe('sending an order', () => {
  /** Opens the basket and waits for the server's own answer, because Send is disabled until it arrives. */
  const openBasket = async (ready = true) => {
    render(<CatalogueApp />)
    await user.click(await waitFor(() => screen.getByRole('button', { name: 'Your order' }), wait))
    if (ready) await waitFor(() => expect(screen.getByRole('button', { name: 'Send this order' })).toBeEnabled(), wait)
  }

  /** Through the form and out the other side. */
  const sendIt = async () => {
    await user.click(screen.getByRole('button', { name: 'Send this order' }))
    await waitFor(() => expect(screen.getByLabelText('Business name')).toBeInTheDocument(), wait)
    await user.click(screen.getByRole('button', { name: 'Place the order' }))
    await waitFor(() => expect(screen.getByText('Thank you — we have your order')).toBeInTheDocument(), wait)
  }

  it('cannot be sent while the server says something is wrong with it', async () => {
    alreadyIn({ token: 'tok-1', basket: { 'p-kham-100': 6 } })   // $144, under the $500 minimum
    await openBasket(false)

    await waitFor(() => expect(screen.getByText(/Minimum wholesale order/)).toBeInTheDocument(), wait)
    expect(screen.getByRole('button', { name: 'Send this order' })).toBeDisabled()
  })

  it('takes the business’s details, prefilled, and sends the basket', async () => {
    alreadyIn({ token: 'tok-1', basket: { 'p-kham-100': 24 } })
    await openBasket()

    await user.click(screen.getByRole('button', { name: 'Send this order' }))
    expect(await waitFor(() => screen.getByLabelText('Business name'), wait)).toHaveValue('Istanbul Perfumes')

    await user.click(screen.getByRole('button', { name: 'Place the order' }))
    await waitFor(() => expect(screen.getByText('Thank you — we have your order')).toBeInTheDocument(), wait)

    const sent = calls.find((c) => c === 'POST /orders')
    expect(sent).toBeDefined()
    expect(screen.getByText('LAT-10025')).toBeInTheDocument()
    // and the basket is emptied, so a refresh cannot send it a second time
    expect(useCatalogue.getState().basket).toEqual({})
  })

  it('says plainly that the order is waiting for Lattafa, not on its way', async () => {
    alreadyIn({ token: 'tok-1', basket: { 'p-kham-100': 24 } })
    await openBasket()
    await sendIt()

    expect(screen.getByText(/Waiting for Lattafa to confirm it/)).toBeInTheDocument()
  })

  it('carries one idempotency key, so a double press is one order', async () => {
    alreadyIn({ token: 'tok-1', basket: { 'p-kham-100': 24 } })
    await openBasket()
    await sendIt()

    expect(keys.length).toBeGreaterThan(0)
    expect(new Set(keys).size).toBe(1)
  })
})

/* ───────────────────────── the shelf stays in the shop ───────────────────────── */

describe('what a buyer is told about stock', () => {
  it('is told nothing at all: the catalogue sells with no limit', async () => {
    alreadyIn()
    const { container } = render(<CatalogueApp />)
    await user.click(await waitFor(() => screen.getByRole('button', { name: 'All perfumes' }), wait))
    await waitFor(() => expect(screen.getByText('Oud Mood')).toBeInTheDocument(), wait)

    // no badge, no filter, no quantity — a shelf in Duhok is nobody abroad's business
    expect(container.textContent).not.toMatch(/in stock|out of stock/i)
    expect(container.textContent).not.toMatch(/\b\d+ (left|available)\b/i)
  })

  it('every size with a price can be ordered, however many are on the shelf', async () => {
    alreadyIn({ token: 'tok-1' })
    render(<CatalogueApp />)
    await user.click(await waitFor(() => screen.getByRole('button', { name: 'All perfumes' }), wait))
    await user.click(await waitFor(() => screen.getByText('Oud Mood'), wait))

    // Oud Mood was the sold-out one in the old world; now it is orderable like any other
    await waitFor(() => expect(screen.getByLabelText('Add to order')).toBeEnabled(), wait)
  })
})

/* ───────────────────────── how the owner has arranged it ───────────────────────── */

describe('the look the owner chose', () => {
  it('draws the sections in the owner’s order, and leaves out the ones switched off', async () => {
    LOOK.sections = [{ key: 'story', on: true }, { key: 'how', on: true }]
    alreadyIn()
    render(<CatalogueApp />)

    const headings = await waitFor(() => {
      const found = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
      expect(found).toContain('How wholesale works')
      return found
    }, wait)

    // the story comes before how it works, because that is the order the admin panel saved
    expect(headings.indexOf('Made in the Emirates, worn everywhere')).toBeLessThan(headings.indexOf('How wholesale works'))
    // and the sections that are off are simply not on the page
    expect(screen.queryByText('Shop by kind')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Featured' })).not.toBeInTheDocument()
  })

  it('says the owner’s own headline, wordmark and contacts', async () => {
    LOOK.headline = 'The house of oud, wholesale'
    LOOK.lead = 'Ship from Duhok to anywhere.'
    LOOK.brand.wordmark = 'LATTAFA DUHOK'
    LOOK.footer = { note: 'Container loads by arrangement.', email: 'trade@example.com', phone: '+964 750 000 0000', instagram: '@example', website: 'example.com' }
    alreadyIn()
    render(<CatalogueApp />)

    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('The house of oud, wholesale'), wait)
    expect(screen.getByText('Ship from Duhok to anywhere.')).toBeInTheDocument()
    expect(screen.getAllByText('LATTAFA DUHOK').length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: 'trade@example.com' })).toHaveAttribute('href', 'mailto:trade@example.com')
    expect(screen.getByRole('link', { name: '@example' })).toHaveAttribute('href', 'https://instagram.com/example')
    expect(screen.getByRole('link', { name: 'example.com' })).toHaveAttribute('href', 'https://example.com')
    expect(screen.getByText('Container loads by arrangement.')).toBeInTheDocument()
  })

  it('a line the owner left empty is absent rather than blank', async () => {
    alreadyIn()
    render(<CatalogueApp />)
    await waitFor(() => expect(screen.getByText('Khamrah')).toBeInTheDocument(), wait)

    expect(screen.queryAllByRole('link', { name: /mailto|instagram/ })).toEqual([])
    // the catalogue falls back to its own words for the headline
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('The Wholesale Collection')
  })

  it('admits in the footer that the colours are a placeholder, and stops once they are not', async () => {
    alreadyIn()
    const first = render(<CatalogueApp />)
    await waitFor(() => expect(screen.getByText(/working placeholder/)).toBeInTheDocument(), wait)
    first.unmount()

    LOOK.brand.provisional = false
    render(<CatalogueApp />)
    await waitFor(() => expect(screen.getByText('Khamrah')).toBeInTheDocument(), wait)
    expect(screen.queryByText(/working placeholder/)).not.toBeInTheDocument()
  })

  it('paints the page in the owner’s three colours', async () => {
    LOOK.brand = { ...LOOK.brand, ink: '#101010', ivory: '#FFFEF8', gold: '#B8860B' }
    alreadyIn()
    render(<CatalogueApp />)
    await waitFor(() => expect(screen.getByText('Khamrah')).toBeInTheDocument(), wait)

    const style = document.documentElement.style
    expect(style.getPropertyValue('--color-gold')).toBe('#B8860B')
    expect(style.getPropertyValue('--bg')).toBe('#FFFEF8')
    expect(style.getPropertyValue('--text')).toBe('#101010')
    // everything else is mixed from those three in CSS, so it follows without a second list here
    expect(style.getPropertyValue('--color-gold-soft')).toContain('#B8860B')
  })

  it('a collection takes the buyer to its own perfumes, and nothing else', async () => {
    alreadyIn()
    render(<CatalogueApp />)
    await user.click(await waitFor(() => screen.getByRole('button', { name: /Oud Collection/ }), wait))

    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Oud Collection'), wait)
    expect(screen.getByText('Oud Mood')).toBeInTheDocument()
    expect(screen.queryByText('Khamrah')).not.toBeInTheDocument()
  })

  it('shows every photograph the catalogue has been given for a perfume', async () => {
    const photographed = perfume('p-pic', 'Yara', { image: '/a.jpg', images: ['/a.jpg', '/b.jpg', '/c.jpg'] })
    PRODUCTS.push(photographed)
    try {
      alreadyIn()
      render(<CatalogueApp />)
      await user.click(await waitFor(() => screen.getByRole('button', { name: 'All perfumes' }), wait))
      await user.click(await waitFor(() => screen.getByText('Yara'), wait))

      await waitFor(() => expect(screen.getByRole('button', { name: 'Photograph 3' })).toBeInTheDocument(), wait)
      await user.click(screen.getByRole('button', { name: 'Photograph 3' }))
      expect(screen.getByRole('img', { name: 'Yara' })).toHaveAttribute('src', '/c.jpg')
    } finally {
      PRODUCTS.pop()
    }
  })
})
