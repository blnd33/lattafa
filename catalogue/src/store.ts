import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * What the catalogue remembers about one visitor, in their own browser.
 *
 * Kept under `lattafa-catalogue`, apart from the staff apps on the same domain: a buyer's country and language
 * must not be changed by what a till happened to save. `dir` and `htmlLang` are in here because `index.html`
 * reads them before the first paint, so an Arabic catalogue does not flash left-to-right on its way in.
 *
 * The session token is the one thing here that matters: it is what a valid access code opened, and it is the
 * only reason any price is ever fetched. Changing country throws it away — prices differ by country, so a
 * session belongs to the country it was opened for.
 */
export interface CatalogueState {
  countryId: string | null
  language: string
  dir: 'ltr' | 'rtl'
  htmlLang: string
  /** opened by an access code; null = browsing without prices */
  token: string | null
  favourites: string[]
  /** what is in the order so far, as variantId → bottles */
  basket: Record<string, number>
  /** true once the visitor has been past the welcome screen */
  entered: boolean

  setCountry: (countryId: string, language: string, rtl: boolean) => void
  setLanguage: (language: string, rtl: boolean) => void
  enter: () => void
  signIn: (token: string) => void
  signOut: () => void
  toggleFavourite: (productId: string) => void
  setQty: (variantId: string, qty: number) => void
  clearBasket: () => void
}

/** Kurdish Sorani is `ckb` to a browser; the rest are their own codes. */
export const htmlLangOf = (code: string): string => (code === 'ku' ? 'ckb' : code)

export const useCatalogue = create<CatalogueState>()(
  persist(
    (set) => ({
      countryId: null,
      language: 'en',
      dir: 'ltr',
      htmlLang: 'en',
      token: null,
      favourites: [],
      basket: {},
      entered: false,

      setCountry: (countryId, language, rtl) => set((s) => ({
        countryId,
        language,
        dir: rtl ? 'rtl' : 'ltr',
        htmlLang: htmlLangOf(language),
        // a session was opened for one country's prices; it does not follow the visitor to another
        token: s.countryId && s.countryId !== countryId ? null : s.token,
        basket: s.countryId && s.countryId !== countryId ? {} : s.basket,
      })),

      setLanguage: (language, rtl) => set({ language, dir: rtl ? 'rtl' : 'ltr', htmlLang: htmlLangOf(language) }),
      enter: () => set({ entered: true }),
      signIn: (token) => set({ token }),
      signOut: () => set({ token: null, basket: {} }),

      toggleFavourite: (productId) => set((s) => ({
        favourites: s.favourites.includes(productId) ? s.favourites.filter((id) => id !== productId) : [...s.favourites, productId],
      })),

      setQty: (variantId, qty) => set((s) => {
        const basket = { ...s.basket }
        if (qty > 0) basket[variantId] = qty
        else delete basket[variantId]
        return { basket }
      }),

      clearBasket: () => set({ basket: {} }),
    }),
    { name: 'lattafa-catalogue' },
  ),
)

/** Bottles in the order, for the header. */
export const basketUnits = (basket: Record<string, number>): number => Object.values(basket).reduce((n, q) => n + q, 0)
