// @vitest-environment jsdom
/**
 * The customer menu inside the admin panel's live preview (`/menu/?preview`): it never fetches, shows exactly what the
 * admin page sends, and honours the menu settings (prices hidden, the WhatsApp number orders go to).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useUI } from '@/store/ui'
import { orderNumber, PREVIEW, type MenuData, type MenuProduct } from './api'
import { MenuApp } from './MenuApp'

const perfume = (id: string, en: string, priceIQD: number | null): MenuProduct => ({
  id, name: { en, ar: en, ku: en }, description: { en: '', ar: '', ku: '' }, brand: 'Lattafa', category: 'perfume', gender: 'men', concentration: 'EDP',
  scentFamilies: [], notes: { top: [], heart: [], base: [] }, season: 'all', longevity: 3, sillage: 3, image: null, art: { c1: '#111', c2: '#222', shape: 'rect' },
  featured: false, isNew: false, sizes: [{ id: `${id}-100`, label: '100 ml', size: 100, unit: 'ml', ml: 100, priceIQD, available: true }],
})
const data = (o: Partial<MenuData> = {}): MenuData => ({
  store: { name: 'Lattafa Test', tagline: '', phone: '0750 730 8005', address: '', city: 'Duhok' }, currency: { rate: 1460, usdEnabled: true },
  menu: { showPrices: true, hideSoldOut: false, whatsapp: '', heroDim: 45, hero: [] }, products: [perfume('p-asad', 'Asad', 40000), perfume('p-yara', 'Yara', 35000)], updatedAt: 1, ...o,
})
const send = (d: MenuData, lang?: 'en' | 'ar') => act(() => {
  window.dispatchEvent(new MessageEvent('message', { origin: location.origin, source: window.parent, data: { type: PREVIEW.data, data: d, lang } }))
})

describe('menu live preview', () => {
  beforeEach(() => {
    localStorage.clear()
    useUI.setState({ lang: 'en' })
    window.history.replaceState(null, '', '/menu/?preview=1')
  })
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/') })

  it('shows what the admin page sends instead of fetching, and follows each change', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const ready = vi.fn()
    window.addEventListener('message', (e) => { if (e.data?.type === PREVIEW.ready) ready() }, { once: true })
    render(<MenuApp />)
    await vi.waitFor(() => expect(ready).toHaveBeenCalled())
    expect(screen.getByRole('status')).toHaveTextContent('Loading the menu')

    send(data(), 'ar')
    expect(useUI.getState().lang).toBe('ar') // starts in the admin's language
    send(data(), 'en')
    expect(screen.getAllByRole('button', { name: 'Asad' })).not.toHaveLength(0)
    expect(screen.getAllByText('40,000')).not.toHaveLength(0)

    // the admin hides prices and takes Asad off: the preview follows without a reload
    send(data({ menu: { showPrices: false, hideSoldOut: false, whatsapp: '0750 111 2222', heroDim: 45, hero: [] }, products: [perfume('p-yara', 'Yara', 35000)] }))
    expect(screen.queryByRole('button', { name: 'Asad' })).toBeNull()
    expect(screen.queryByText('35,000')).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Any price' })).toBeNull() // no price filter without prices

    await userEvent.click(screen.getAllByRole('button', { name: 'Yara' })[0])
    const sheet = screen.getByRole('dialog', { name: 'Yara' })
    expect(within(sheet).getByText('Ask us for the price')).toBeInTheDocument()
    const order = within(sheet).getByRole('link', { name: /Order via WhatsApp/ })
    expect(order.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/9647501112222\?text=/)
    expect(decodeURIComponent(order.getAttribute('href')!.split('text=')[1])).not.toMatch(/IQD/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('ignores messages from anywhere else', () => {
    render(<MenuApp />)
    act(() => { window.dispatchEvent(new MessageEvent('message', { origin: 'https://evil.example', source: window.parent, data: { type: PREVIEW.data, data: data() } })) })
    expect(screen.queryByRole('button', { name: 'Asad' })).toBeNull()
  })

  it('sends orders to the menu\'s own WhatsApp number, or else the shop phone', () => {
    expect(orderNumber(data())).toBe('9647507308005')
    expect(orderNumber(data({ menu: { showPrices: true, hideSoldOut: false, whatsapp: '0750 111 2222', heroDim: 45, hero: [] } }))).toBe('9647501112222')
    expect(orderNumber({ store: data().store })).toBe('9647507308005') // a menu saved by an older version
  })

  it('puts the shop\'s photos and videos behind the title, taking turns, darkened as set', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      render(<MenuApp />)
      const hero = [
        { id: 'h-1', type: 'image' as const, src: '/storage/menu/hero/h-1.jpg', poster: null },
        { id: 'h-2', type: 'video' as const, src: '/storage/menu/hero/h-2.mp4', poster: '/storage/menu/hero/h-2-poster.jpg' },
      ]
      send(data({ menu: { showPrices: true, hideSoldOut: false, whatsapp: '', heroDim: 60, hero } }), 'en')
      const h1 = screen.getByRole('heading', { level: 1 })
      const section = h1.closest('section')!
      const img = section.querySelector('img[src="/storage/menu/hero/h-1.jpg"]')!
      const video = section.querySelector('video')!
      expect(video.getAttribute('src')).toBe('/storage/menu/hero/h-2.mp4')
      expect(video.getAttribute('poster')).toBe('/storage/menu/hero/h-2-poster.jpg')
      expect(video.muted).toBe(true)
      expect((section.querySelector('.bg-black') as HTMLElement).style.opacity).toBe('0.6')
      expect(section.querySelector('.rounded-t-full')).toBeNull() // no drawn bottles over a photo
      // the first shows, then the second takes over
      expect(img.parentElement).toHaveClass('opacity-100')
      expect(video.parentElement).toHaveClass('opacity-0')
      await act(async () => { vi.advanceTimersByTime(7100) })
      expect(video.parentElement).toHaveClass('opacity-100')
      expect(screen.getByRole('button', { name: 'Picture 2 of 2' })).toHaveAttribute('aria-current', 'true')
      await userEvent.click(screen.getByRole('button', { name: 'Picture 1 of 2' }))
      expect(img.parentElement).toHaveClass('opacity-100')

      // guests can stop the moving background, and start it again
      await userEvent.click(screen.getByRole('button', { name: 'Pause the background' }))
      await act(async () => { vi.advanceTimersByTime(7100) })
      expect(img.parentElement).toHaveClass('opacity-100') // no turn taken while paused
      await userEvent.click(screen.getByRole('button', { name: 'Play the background' }))
      await act(async () => { vi.advanceTimersByTime(7100) })
      expect(video.parentElement).toHaveClass('opacity-100')

      // without photos/videos: the soft gold light, nothing to pause
      send(data())
      expect(screen.getByRole('heading', { level: 1 }).closest('section')!.querySelector('video, img[src^="/storage"]')).toBeNull()
      expect(screen.queryByRole('button', { name: 'Pause the background' })).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
