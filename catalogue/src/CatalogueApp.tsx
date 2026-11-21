import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  CatalogueError, getCollection, getOpen, getPrices, getSession, lock as lockSession,
  type Brand, type Collection, type Country, type FooterInfo, type Open, type Perfume, type PriceLine, type Session,
} from './api'
import { Basket } from './Basket'
import { Header, type View } from './Header'
import { Browse, NO_FILTERS, type Filters } from './screens/Browse'
import { Card } from './screens/Card'
import { Home } from './screens/Home'
import { Product } from './screens/Product'
import { Countries, Welcome } from './screens/Welcome'
import { basketUnits, useCatalogue } from './store'
import { BrandContext, DEFAULT_BRAND, DEFAULT_LOOK, applyBrand, useBrand } from './theme'
import { Button, Empty } from './ui'
import { Unlock } from './Unlock'
import { WordsContext, useT } from './words'

/**
 * The Lattafa wholesale catalogue.
 *
 * Two kinds of data, kept apart on purpose. The collection and the catalogue's own words are public and carry no
 * figure at all. Prices arrive separately, only once an access code has opened a session, and are joined to the
 * perfumes here in the browser — so "no code, no prices" is not a filter anyone has to remember to apply.
 */
export function CatalogueApp() {
  const state = useCatalogue()
  const [open, setOpen] = useState<Open | null>(null)
  const [collection, setCollection] = useState<Collection | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [prices, setPrices] = useState<PriceLine[] | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  const [view, setView] = useState<View>('home')
  const [showing, setShowing] = useState<Perfume | null>(null)
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [picking, setPicking] = useState(false)
  const [unlocking, setUnlocking] = useState(false)
  const [basketOpen, setBasketOpen] = useState(false)

  /* ── what the catalogue is, in this language ── */
  useEffect(() => {
    let alive = true
    getOpen(state.language)
      .then((o) => { if (alive) { setOpen(o); setFailed(null) } })
      .catch((e) => { if (alive) setFailed(e instanceof CatalogueError ? e.code : 'unknown') })
    return () => { alive = false }
  }, [state.language])

  /* ── the collection, once a country has been chosen ── */
  useEffect(() => {
    if (!state.countryId) return
    let alive = true
    getCollection(state.language)
      .then((c) => { if (alive) setCollection(c) })
      .catch((e) => { if (alive) setFailed(e instanceof CatalogueError ? e.code : 'unknown') })
    return () => { alive = false }
  }, [state.countryId, state.language])

  /* ── and this buyer's own prices, if a code opened a session ── */
  const loadPrices = useCallback(async (token: string) => {
    try {
      const [who, list] = await Promise.all([getSession(token), getPrices(token)])
      setSession(who)
      setPrices(list.lines)
    } catch (e) {
      // a session that has run out, been withdrawn, or belongs to a business put on hold: quietly back to browsing
      if (e instanceof CatalogueError && e.code === 'not_unlocked') {
        useCatalogue.getState().signOut()
        setSession(null)
        setPrices(null)
      }
    }
  }, [])

  useEffect(() => {
    if (!state.token) { setSession(null); setPrices(null); return }
    void loadPrices(state.token)
  }, [state.token, loadPrices])

  /* ── the page's own language and direction ── */
  useEffect(() => {
    document.documentElement.dir = state.dir
    document.documentElement.lang = state.htmlLang
  }, [state.dir, state.htmlLang])

  /* ── and the owner's three colours, over the whole page ── */
  const brand = open?.look?.brand ?? DEFAULT_BRAND
  useEffect(() => { applyBrand(brand) }, [brand])

  const priceBy = useMemo(() => (prices ? new Map(prices.map((p) => [p.variantId, p])) : null), [prices])
  const country = useMemo(() => open?.countries.find((c) => c.id === state.countryId) ?? null, [open, state.countryId])

  const pickCountry = (c: Country) => {
    const language = open?.languages.find((l) => l.code === c.language)
    state.setCountry(c.id, language?.code ?? state.language, language?.rtl ?? false)
    setPicking(false)
    setCollection(null)
  }

  const show = (p: Perfume) => { setShowing(p); window.scrollTo({ top: 0 }) }
  const goto = (v: View) => { setShowing(null); setView(v); window.scrollTo({ top: 0 }) }

  /* ── what to put on screen ── */

  if (failed && !open) return <Trouble words={{}} code={failed} onRetry={() => location.reload()} />
  if (!open) return <Booting />

  const words = open.words
  const look = open.look ?? DEFAULT_LOOK

  // the welcome screen, then "where are you buying from?" — both before anything else is loaded
  if (!state.entered) {
    return <Wrap words={words} brand={brand}><Welcome onEnter={state.enter} /></Wrap>
  }
  if (!state.countryId || picking) {
    return (
      <Wrap words={words} brand={brand}>
        <Countries
          countries={open.countries}
          languages={open.languages}
          current={state.countryId}
          onPick={pickCountry}
          onCancel={state.countryId ? () => setPicking(false) : undefined}
        />
      </Wrap>
    )
  }

  return (
    <Wrap words={words} brand={brand}>
      <div className="flex min-h-svh flex-col bg-bg text-fg">
        <Header
          view={view}
          session={session}
          country={country}
          languages={open.languages}
          units={basketUnits(state.basket)}
          favourites={state.favourites.length}
          search={search}
          onView={goto}
          onSearch={setSearch}
          onUnlock={() => setUnlocking(true)}
          onBasket={() => setBasketOpen(true)}
          onCountry={() => setPicking(true)}
          onLanguage={(code, rtl) => state.setLanguage(code, rtl)}
        />

        <main id="main" className="flex-1 ps-safe pe-safe">
          {!collection ? <Booting />
            : showing ? (
              <Product
                perfume={showing}
                prices={priceBy}
                related={collection.products.filter((p) => p.id !== showing.id && p.category === showing.category).slice(0, 4)}
                favourite={state.favourites.includes(showing.id)}
                basket={state.basket}
                unlocked={!!session}
                onBack={() => setShowing(null)}
                onFavourite={() => state.toggleFavourite(showing.id)}
                onQty={state.setQty}
                onOpen={show}
                onUnlock={() => setUnlocking(true)}
              />
            )
              : view === 'home' ? (
                <Home
                  collection={collection}
                  look={look}
                  prices={priceBy}
                  favourites={state.favourites}
                  session={!!session}
                  onOpen={show}
                  onFavourite={(p) => state.toggleFavourite(p.id)}
                  onBrowse={() => { setFilters(NO_FILTERS); goto('browse') }}
                  onKind={(kind) => { setFilters({ ...NO_FILTERS, kind }); goto('browse') }}
                  onCollection={(c) => { setFilters({ ...NO_FILTERS, collection: c.id }); goto('browse') }}
                  onUnlock={() => setUnlocking(true)}
                />
              )
                : view === 'favourites' ? (
                  <Favourites
                    collection={collection}
                    prices={priceBy}
                    favourites={state.favourites}
                    onOpen={show}
                    onFavourite={(p) => state.toggleFavourite(p.id)}
                    onBrowse={() => goto('browse')}
                  />
                )
                  : (
                    <Browse
                      collection={collection}
                      prices={priceBy}
                      favourites={state.favourites}
                      search={search}
                      filters={filters}
                      onFilters={setFilters}
                      onOpen={show}
                      onFavourite={(p) => state.toggleFavourite(p.id)}
                      onClearSearch={() => setSearch('')}
                    />
                  )}
        </main>

        <Footer info={look.footer} provisional={brand.provisional} />

        <Unlock
          open={unlocking}
          session={session}
          country={country}
          onClose={() => setUnlocking(false)}
          onSignedIn={(token, who) => { state.signIn(token); setSession(who); setUnlocking(false); void loadPrices(token) }}
          onSignOut={() => {
            const token = state.token
            state.signOut()
            setSession(null)
            setPrices(null)
            setUnlocking(false)
            if (token) void lockSession(token).catch(() => undefined)
          }}
        />

        <Basket
          open={basketOpen}
          token={state.token}
          session={session}
          whatsapp={open.whatsapp ?? ''}
          basket={state.basket}
          perfumes={collection?.products ?? []}
          onClose={() => setBasketOpen(false)}
          onQty={state.setQty}
          onClear={state.clearBasket}
          onPlaced={() => { if (state.token) void loadPrices(state.token) }}
        />
      </div>
    </Wrap>
  )
}

/** The catalogue's two pieces of shared context: the server's words, and the owner's colours and wordmark. */
function Wrap({ words, brand, children }: { words: Record<string, string>; brand: Brand; children: ReactNode }) {
  return (
    <WordsContext.Provider value={words}>
      <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>
    </WordsContext.Provider>
  )
}

function Favourites({ collection, prices, favourites, onOpen, onFavourite, onBrowse }: {
  collection: Collection
  prices: Map<string, PriceLine> | null
  favourites: string[]
  onOpen: (p: Perfume) => void
  onFavourite: (p: Perfume) => void
  onBrowse: () => void
}) {
  const t = useT()
  const mine = collection.products.filter((p) => favourites.includes(p.id))

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="font-serif mb-6 text-2xl sm:text-3xl">{t('cat.favourites')}</h1>
      {!mine.length ? (
        <Empty title={t('cat.favourites_empty')} hint={t('cat.favourites_empty_hint')} action={<Button variant="quiet" onClick={onBrowse}>{t('cat.explore')}</Button>} />
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
          {mine.map((p) => (
            <Card key={p.id} perfume={p}
              price={prices ? p.sizes.map((s) => prices.get(s.variantId)).filter(Boolean).sort((a, b) => a!.priceCents - b!.priceCents)[0] ?? null : null}
              unlocked={!!prices} favourite onOpen={() => onOpen(p)} onFavourite={() => onFavourite(p)} />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * The foot of the page: how to reach the house, in the owner's own words.
 *
 * Every line is one the owner filled in, so an empty field is simply absent rather than a blank label. While the
 * look is marked provisional the footer says so — the colours and wordmark are this system's house theme, not
 * Lattafa's own brand kit, and the catalogue is not going to imply otherwise.
 */
function Footer({ info, provisional }: { info: FooterInfo; provisional: boolean }) {
  const t = useT()
  const brand = useBrand()
  const links: { key: string; label: string; href: string }[] = [
    info.email && { key: 'email', label: info.email, href: `mailto:${info.email}` },
    info.phone && { key: 'phone', label: info.phone, href: `tel:${info.phone.replace(/[^0-9+]/g, '')}` },
    info.instagram && { key: 'instagram', label: info.instagram.replace(/^@/, '@'), href: `https://instagram.com/${info.instagram.replace(/^@/, '')}` },
    info.website && { key: 'website', label: info.website.replace(/^https?:\/\//, ''), href: /^https?:\/\//.test(info.website) ? info.website : `https://${info.website}` },
  ].filter(Boolean) as { key: string; label: string; href: string }[]

  return (
    <footer className="border-t border-line bg-surface-2/50">
      <div className="mx-auto max-w-6xl px-4 py-10 text-center ps-safe pe-safe pb-safe">
        <p className="font-serif text-xl tracking-[0.18em]">{brand.wordmark}</p>
        {brand.tagline && <p className="num mt-1 text-[0.65rem] tracking-[0.34em] text-fg-2 uppercase">{brand.tagline}</p>}

        {links.length > 0 && (
          <ul className="mt-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">
            {links.map((l) => (
              <li key={l.key}>
                <a href={l.href} target={l.key === 'email' || l.key === 'phone' ? undefined : '_blank'} rel="noopener noreferrer"
                  className="text-fg-2 transition hover:text-gold-text">{l.label}</a>
              </li>
            ))}
          </ul>
        )}

        {info.note && <p className="mx-auto mt-5 max-w-xl text-sm leading-relaxed text-fg-2">{info.note}</p>}
        <p className="mt-4 text-xs text-fg-2">{t('cat.prices_usd')}</p>
        {provisional && <p className="mx-auto mt-3 max-w-md text-[0.7rem] leading-relaxed text-fg-2/80">{t('cat.look_provisional')}</p>}

        <p className="mt-6 text-xs text-fg-2">
          Developed by{' '}
          <a href="https://coda-agency.net/" target="_blank" rel="noopener noreferrer" className="font-semibold text-gold-text hover:underline">Coda Agency</a>
          {' '}— Build What&apos;s Next
        </p>
      </div>
    </footer>
  )
}

function Booting() {
  return <div className="grid min-h-svh place-items-center"><span role="status" aria-label="Loading" className="inline-block size-9 animate-spin rounded-full border-2 border-gold/30 border-t-gold" /></div>
}

function Trouble({ words, code, onRetry }: { words: Record<string, string>; code: string; onRetry: () => void }) {
  return (
    <WordsContext.Provider value={words}>
      <div className="grid min-h-svh place-items-center px-6 text-center">
        <div>
          <p className="font-serif text-2xl tracking-[0.18em]">{DEFAULT_BRAND.wordmark}</p>
          <p className="mt-4 text-sm text-fg-2">{words[`cat.err_${code}`] ?? words['cat.err_offline'] ?? 'We could not reach Lattafa. Please try again.'}</p>
          <Button className="mt-6" onClick={onRetry}>{words['cat.retry'] ?? 'Try again'}</Button>
        </div>
      </div>
    </WordsContext.Provider>
  )
}
