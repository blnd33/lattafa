// @vitest-environment jsdom
/**
 * Admin panel → Customer menu: the arrangement maths (automatic vs. arranged order, what the preview shows, what Save
 * sends) and the screen against a fake server — switches, moving a perfume, menu settings, saving, and the live preview
 * handshake with the menu inside the frame — and the photos/videos behind the top of the menu (sent in pieces, deleted).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PREVIEW } from '@menu/api'
import { db } from '@/data/db'
import type { Actor } from '@/data/types'
import { setApiToken } from '@/services/api'
import { setActor } from '@/services/context'
import { setServerMode } from '@/services/mode'
import { useSession } from '@/store/session'
import { useUI } from '@/store/ui'
import { AdminApp } from './App'
import { arranged, autoOrder, changes, draftOf, move, previewData, type ManagedProduct, type MenuManage } from './menu/api'

vi.mock('@/data/app', () => ({ APP: 'admin', DB_NAME: 'lattafa-admin-menu-test', SESSION_KEY: 'lattafa-admin-session' }))
// jsdom can't decode photos or play videos: the browser-side preparing is replaced, the piece-by-piece sending is real
vi.mock('./menu/media', async (real) => ({
  ...(await real<typeof import('./menu/media')>()),
  prepare: async (file: File) => ({ blob: new Blob([await file.arrayBuffer()], { type: file.type }), type: file.type.startsWith('video/') ? 'video' : 'image', poster: null }),
}))

const user = userEvent.setup({ delay: null })
const wait = { timeout: 15000 }
const owner: Actor = {
  id: 'u-owner', name: 'Rand Owner', username: 'owner', roleId: 'role-sa', roleKey: 'super_admin', roleName: 'Super Admin', color: '#D4A548',
  permissions: ['*'], limits: { maxDiscountPct: 100, maxRefundIQD: 10_000_000 }, isSuperAdmin: true,
}

const perfume = (id: string, en: string, o: Partial<ManagedProduct> = {}, available = true): ManagedProduct => ({
  id, name: { en, ar: en, ku: en }, description: { en: '', ar: '', ku: '' }, brand: 'Lattafa', category: 'perfume', gender: 'unisex', concentration: 'EDP',
  scentFamilies: [], notes: { top: [], heart: [], base: [] }, season: 'all', longevity: 3, sillage: 3, image: null, art: { c1: '#111', c2: '#222', shape: 'rect' },
  featured: false, isNew: false, showOnMenu: true, order: null,
  sizes: [{ id: `${id}-100`, label: '100 ml', size: 100, unit: 'ml', ml: 100, priceIQD: 40000, available }], ...o,
})
// as the server sends it: automatic order (featured first, then A–Z)
const saved = (): MenuManage => ({
  store: { name: 'Lattafa Test', tagline: '', phone: '0750 730 8005', address: '', city: 'Duhok' }, currency: { rate: 1460, usdEnabled: true },
  menu: { showPrices: true, hideSoldOut: false, whatsapp: '', heroDim: 45, hero: [{ id: 'h-1', type: 'image', src: '/storage/menu/hero/h-1.jpg', poster: null }] }, canEditSettings: true, updatedAt: 1,
  products: [
    perfume('p-yara', 'Yara', { featured: true }),
    perfume('p-asad', 'Asad'),
    perfume('p-haya', 'Haya', { showOnMenu: false }),
    perfume('p-khamrah', 'Khamrah', {}, false),
  ],
})

describe('menu arrangement', () => {
  it('starts from the saved menu and knows the automatic order', () => {
    const m = saved()
    const d = draftOf(m)
    expect(d.custom).toBe(false)
    expect(autoOrder(m.products, d.flags)).toEqual(['p-yara', 'p-asad', 'p-haya', 'p-khamrah'])
    // featuring Khamrah moves it up while the order is automatic
    d.flags['p-khamrah'].featured = true
    expect(arranged(m, d).map((p) => p.id)).toEqual(['p-khamrah', 'p-yara', 'p-asad', 'p-haya'])
    expect(changes(m, d, true)).toEqual({ products: [{ id: 'p-khamrah', showOnMenu: true, featured: true, isNew: false }] })
  })

  it('previews only what guests would see, and hides sold-out perfumes when asked', () => {
    const m = saved()
    const d = draftOf(m)
    expect(previewData(m, d).products.map((p) => p.id)).toEqual(['p-yara', 'p-asad', 'p-khamrah'])
    expect(previewData(m, d).products[0]).not.toHaveProperty('showOnMenu')
    d.settings.hideSoldOut = true
    d.flags['p-haya'].showOnMenu = true
    expect(previewData(m, d).products.map((p) => p.id)).toEqual(['p-yara', 'p-asad', 'p-haya'])
    expect(previewData(m, d).menu).toEqual({ showPrices: true, hideSoldOut: true, whatsapp: '', heroDim: 45, hero: m.menu.hero })
  })

  it('sends the order only when it was arranged, and "automatic" only when it was arranged before', () => {
    const m = saved()
    const d = { ...draftOf(m), custom: true, order: move(draftOf(m).order, 3, 0) }
    expect(d.order).toEqual(['p-khamrah', 'p-yara', 'p-asad', 'p-haya'])
    expect(changes(m, d, true)).toEqual({ products: [], order: d.order })
    expect(changes(m, { ...draftOf(m), custom: true }, true)).toEqual({ products: [], order: m.products.map((p) => p.id) }) // arranging = freezing the current order

    const arrangedBefore = { ...m, products: m.products.map((p, i) => ({ ...p, order: i + 1 })) }
    expect(changes(arrangedBefore, draftOf(arrangedBefore), true)).toBeNull()
    expect(changes(arrangedBefore, { ...draftOf(arrangedBefore), custom: false }, true)).toEqual({ products: [], autoOrder: true })
  })

  it('sends menu settings only if this person may change them', () => {
    const m = saved()
    const d = draftOf(m)
    d.settings.whatsapp = ' 0750 111 2222 '
    expect(changes(m, d, true)).toEqual({ products: [], settings: { showPrices: true, hideSoldOut: false, whatsapp: '0750 111 2222', heroDim: 45 } })
    // the photos/videos themselves are saved on their own, never with Save
    expect(changes(m, { ...draftOf(m), settings: { ...draftOf(m).settings, hero: [] } }, true)).toBeNull()
    expect(changes(m, { ...draftOf(m), settings: { ...draftOf(m).settings, heroDim: 70 } }, true)?.settings?.heroDim).toBe(70)
    expect(changes(m, d, false)).toBeNull()
  })
})

describe('Customer menu screen', () => {
  let calls: { method: string; path: string; body: unknown }[] = []
  let hero: MenuManage['menu']['hero'] = []
  let received = 0
  beforeEach(async () => {
    hero = saved().menu.hero
    await db.delete(); await db.open()
    localStorage.clear(); setServerMode(true)
    useUI.setState({ lang: 'en', theme: 'light' })
    setApiToken('tok'); setActor(owner)
    useSession.setState({ actor: owner, token: 'tok', locked: false, lastUserId: owner.id })
    calls = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      const path = url.replace('/api/v1', '')
      const method = init.method ?? 'GET'
      const body = init.body instanceof Blob ? init.body : init.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ method, path, body })
      const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })
      if (path === '/health') return json(200, { ok: true, app: 'lattafa' })
      // each app on its own address (scripts/serve.mjs): the links between them follow
      if (path === '/apps') return json(200, { menu: 'http://localhost:8001/', pos: 'http://localhost:8002/', delegate: 'http://localhost:8003/', admin: 'http://localhost:8004/' })
      if (path === '/setup/status') return json(200, { setupDone: true })
      if (path === '/auth/me') return json(200, { user: owner })
      if (path.startsWith('/sync/pull')) return json(500, { error: { code: 'server_error', params: {} } }) // not needed here
      if (path === '/menu/manage' && method === 'GET') return json(200, { ...saved(), menu: { ...saved().menu, hero } })
      // photos/videos: start, pieces (the server keeps count), finish, delete
      if (path === '/menu/media' && method === 'POST') { received = 0; return json(201, { uploadId: 'up-1', chunkBytes: 4 }) }
      if (path.startsWith('/menu/media/up-1/part')) {
        const at = Number(new URL(path, 'http://x').searchParams.get('at'))
        if (at !== received) return json(409, { error: { code: 'media_offset', params: { at: received } } })
        received += (body as Blob).size
        return json(200, { received })
      }
      if (path === '/menu/media/up-1/finish') {
        hero = [...hero, { id: 'h-new', type: 'video', src: '/storage/menu/hero/h-new.mp4', poster: null }]
        return json(200, { ...saved(), menu: { ...saved().menu, hero } })
      }
      if (path.startsWith('/menu/media/') && method === 'DELETE') {
        hero = hero.filter((m) => !path.endsWith(m.id))
        return json(200, { ...saved(), menu: { ...saved().menu, hero } })
      }
      if (path === '/menu/manage' && method === 'PUT') {
        const m = saved()
        const flags = (id: string) => (body.products as { id: string }[]).find((x) => x.id === id) ?? {}
        return json(200, { ...m, menu: { ...m.menu, ...body.settings }, products: body.order.map((id: string, i: number) => ({ ...m.products.find((p) => p.id === id), ...flags(id), order: i + 1 })) })
      }
      return json(404, { error: { code: 'not_found', params: {} } })
    })
  })
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('arranges the menu, previews it live and saves only what changed', async () => {
    window.location.hash = '#/menu'
    render(<AdminApp />)
    expect(await screen.findByRole('heading', { name: 'Customer menu' }, wait)).toBeInTheDocument()
    const list = await screen.findByRole('list', { name: 'Perfumes' }, wait)
    const rowOf = (name: string) => within(list).getByRole('group', { name }).closest('li')!
    expect(within(list).getAllByRole('listitem').map((li) => within(li).getByRole('group').getAttribute('aria-label'))).toEqual(['Yara', 'Asad', 'Haya', 'Khamrah'])
    expect(screen.getByText('3 of 4 perfumes on the menu')).toBeInTheDocument()
    expect(within(rowOf('Haya')).getByText('—')).toBeInTheDocument() // hidden: no number on the menu
    expect(within(rowOf('Khamrah')).getByText('Sold out')).toBeInTheDocument()

    // the preview frame says it is ready → it gets what guests would see, in the admin's language
    const frame = screen.getByTitle('Live preview') as HTMLIFrameElement
    expect(frame.getAttribute('src')).toBe('/menu/?preview=1')
    const sent = vi.spyOn(frame.contentWindow!, 'postMessage')
    window.dispatchEvent(new MessageEvent('message', { origin: location.origin, source: frame.contentWindow, data: { type: PREVIEW.ready } }))
    expect(sent).toHaveBeenCalledWith(expect.objectContaining({ type: PREVIEW.data, lang: 'en' }), location.origin)
    expect((sent.mock.calls.at(-1)![0] as { data: { products: { id: string }[] } }).data.products.map((p) => p.id)).toEqual(['p-yara', 'p-asad', 'p-khamrah'])

    // show Haya, feature Asad, move Khamrah up, set a WhatsApp number
    await user.click(within(rowOf('Haya')).getByRole('button', { name: 'On menu' }))
    expect(within(rowOf('Haya')).getByRole('button', { name: 'On menu' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(within(rowOf('Asad')).getByRole('button', { name: 'Featured' }))
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('Asad') // automatic order: featured first, A–Z
    await user.click(screen.getByRole('button', { name: 'Move Khamrah up' }))
    expect(within(list).getAllByRole('listitem').map((li) => within(li).getByRole('group').getAttribute('aria-label'))).toEqual(['Asad', 'Yara', 'Khamrah', 'Haya'])
    expect(screen.getByText('Order: arranged by you. Perfumes added later go at the end.')).toBeInTheDocument()
    await user.type(screen.getByLabelText('WhatsApp number for orders'), 'call me')
    expect(screen.getByText('This doesn\'t look like a phone number WhatsApp can use.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save menu' })).toBeDisabled()
    await user.clear(screen.getByLabelText('WhatsApp number for orders'))
    await user.type(screen.getByLabelText('WhatsApp number for orders'), '0750 111 2222')

    // the preview follows without saving
    await waitFor(() => expect((sent.mock.calls.at(-1)![0] as { data: { products: { id: string }[]; menu: { whatsapp: string } } }).data.menu.whatsapp).toBe('0750 111 2222'), wait)
    expect((sent.mock.calls.at(-1)![0] as { data: { products: { id: string }[] } }).data.products.map((p) => p.id)).toEqual(['p-asad', 'p-yara', 'p-khamrah', 'p-haya'])
    expect(screen.getByText('Not saved yet')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save menu' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true), wait)
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({
      products: [{ id: 'p-asad', showOnMenu: true, featured: true, isNew: false }, { id: 'p-haya', showOnMenu: true, featured: false, isNew: false }],
      order: ['p-asad', 'p-yara', 'p-khamrah', 'p-haya'],
      settings: { showPrices: true, hideSoldOut: false, whatsapp: '0750 111 2222', heroDim: 45 },
    })
    expect(await screen.findByText('As guests see it', {}, wait)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save menu' })).toBeNull()
  }, 40_000)

  it('adds a video in pieces and deletes a photo, and the preview follows', async () => {
    window.location.hash = '#/menu'
    render(<AdminApp />)
    const grid = await screen.findByRole('list', { name: 'Top of the menu: photos & videos' }, wait)
    expect(within(grid).getAllByRole('listitem')).toHaveLength(1)
    const frame = screen.getByTitle('Live preview') as HTMLIFrameElement
    const sent = vi.spyOn(frame.contentWindow!, 'postMessage')
    const lastHero = () => (sent.mock.calls.at(-1)![0] as { data: { menu: { hero: { id: string }[] } } }).data.menu.hero.map((m) => m.id)

    // a 10-byte "video" goes in pieces of 4 (the server says how big a piece may be)
    const input = document.querySelector('input[type=file]') as HTMLInputElement
    expect(input.accept).toBe('image/jpeg,image/png,image/webp,video/mp4,video/webm')
    await userEvent.upload(input, new File(['0123456789'], 'shop.mp4', { type: 'video/mp4' }))
    expect(await screen.findByText('Added to the menu.', {}, wait)).toBeInTheDocument()
    expect(calls.filter((c) => c.path.includes('/part')).map((c) => c.path)).toEqual(['/menu/media/up-1/part?at=0', '/menu/media/up-1/part?at=4', '/menu/media/up-1/part?at=8'])
    expect(calls.find((c) => c.path === '/menu/media')?.body).toEqual({ mime: 'video/mp4', size: 10 })
    expect(within(grid).getAllByRole('listitem')).toHaveLength(2)
    expect(within(grid).getAllByRole('listitem')[1]).toHaveTextContent('2 · Video')
    await waitFor(() => expect(lastHero()).toEqual(['h-1', 'h-new']), wait)
    expect(screen.queryByText('Changes not saved yet — guests still see the old menu.')).toBeNull() // already saved

    // delete the photo: asked first, then gone from the list and the preview
    await userEvent.click(within(grid).getByRole('button', { name: 'Delete number 1' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }, wait))
    await waitFor(() => expect(within(grid).getAllByRole('listitem')).toHaveLength(1), wait)
    expect(calls.some((c) => c.method === 'DELETE' && c.path === '/menu/media/h-1')).toBe(true)
    await waitFor(() => expect(lastHero()).toEqual(['h-new']), wait)

    // darkening is a setting like the others: previewed now, saved with "Save menu"
    const dim = screen.getByLabelText(/Darken the picture/)
    expect(dim).toHaveValue('45')
    const { fireEvent } = await import('@testing-library/react')
    fireEvent.change(dim, { target: { value: '70' } })
    await waitFor(() => expect((sent.mock.calls.at(-1)![0] as { data: { menu: { heroDim: number } } }).data.menu.heroDim).toBe(70), wait)
    expect(screen.getByText('Changes not saved yet — guests still see the old menu.')).toBeInTheDocument()
  }, 40_000)

  it('links to the other apps at their own addresses', async () => {
    window.location.hash = '#/menu'
    render(<AdminApp />)
    await screen.findByRole('heading', { name: 'Customer menu' }, wait)
    await waitFor(() => expect(screen.getByRole('link', { name: 'Open the POS' })).toHaveAttribute('href', 'http://localhost:8002/'), wait)
    expect(screen.getByRole('link', { name: 'Open the delegate app' })).toHaveAttribute('href', 'http://localhost:8003/')
    expect(screen.getByRole('link', { name: 'Open the customer menu' })).toHaveAttribute('href', 'http://localhost:8001/')
    expect(screen.getByRole('link', { name: 'Open the menu' })).toHaveAttribute('href', 'http://localhost:8001/')
    // the live preview stays on this address (it talks to the admin page, which only works on the same address)
    expect(screen.getByTitle('Live preview')).toHaveAttribute('src', '/menu/?preview=1')
  }, 40_000)
})
