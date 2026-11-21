import { createContext, useContext } from 'react'
import type { Brand, Look } from './api'

/** The sections the catalogue knows how to draw, in the order it offers them. Mirrors `AppearanceService::SECTIONS`. */
export const SECTIONS = ['hero', 'kinds', 'collections', 'featured', 'new', 'story', 'how'] as const

/**
 * What the catalogue draws with before the server has answered — the same house theme `AppearanceService` ships,
 * so the first paint and the loaded page are the same colours and the same wordmark.
 */
export const DEFAULT_BRAND: Brand = {
  ink: '#1A1714',
  ivory: '#FBF8F2',
  gold: '#D4A548',
  wordmark: 'LATTAFA',
  tagline: 'Est. Duhok',
  provisional: true,
}

/**
 * What the catalogue draws if `GET /open` carries no `look` — a page left open across a release, or a browser
 * serving a cached reply from before the appearance screen existed. The homepage is still the whole page in its
 * shipped order rather than a blank, because a buyer should never meet an empty showroom.
 */
export const DEFAULT_LOOK: Look = {
  brand: DEFAULT_BRAND,
  sections: SECTIONS.map((key) => ({ key, on: true })),
  headline: '',
  lead: '',
  hero: null,
  footer: { note: '', email: '', phone: '', instagram: '', website: '' },
}

export const BrandContext = createContext<Brand>(DEFAULT_BRAND)

/** The wordmark and tagline every screen writes at the top of the page. */
export const useBrand = (): Brand => useContext(BrandContext)

/**
 * Paints the catalogue in the owner's three colours.
 *
 * The whole app is already built on theme variables — `bg-surface`, `text-fg`, `border-gold` — so one set of
 * custom properties on `<html>` recolours every screen at once, with no second stylesheet and no classes that
 * exist only for the catalogue. Everything beyond the three is mixed from them in CSS rather than worked out
 * here: `color-mix` does it in the right colour space, and the browser redoes it if a colour changes.
 *
 * The catalogue is always the light look (there is no dark toggle on a public page), which is why `--bg` and
 * `--text` can be set outright.
 */
export function applyBrand(brand: Brand): void {
  const root = document.documentElement.style
  const gold = (pct: number, towards: string) => `color-mix(in oklab, ${brand.gold} ${pct}%, ${towards})`
  const paper = (pct: number, towards: string) => `color-mix(in oklab, ${brand.ivory} ${pct}%, ${towards})`

  const vars: Record<string, string> = {
    '--color-gold': brand.gold,
    '--color-gold-dark': gold(82, 'black'),
    '--color-gold-light': gold(52, 'white'),
    '--color-gold-soft': gold(16, 'white'),
    '--gold-text': gold(66, 'black'),

    '--color-ink': brand.ink,
    '--color-charcoal': `color-mix(in oklab, ${brand.ink} 88%, white)`,
    '--color-ivory': brand.ivory,

    '--bg': brand.ivory,
    '--surface-2': paper(86, brand.gold),
    '--line': paper(74, brand.gold),
    '--text': brand.ink,
    '--text-2': `color-mix(in oklab, ${brand.ink} 58%, ${brand.ivory})`,
    '--overlay': `color-mix(in srgb, ${brand.ink} 62%, transparent)`,
    '--img-bg': `radial-gradient(circle at 50% 38%, ${paper(60, 'white')} 0, ${gold(14, brand.ivory)} 72%)`,
  }

  for (const [name, value] of Object.entries(vars)) root.setProperty(name, value)

  // the phone's own chrome, so the address bar matches the page rather than the shipped default
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', brand.ivory)
}
