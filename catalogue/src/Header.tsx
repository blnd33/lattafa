import { useState } from 'react'
import { Heart, Lock, Menu, Search, ShoppingBag, Unlock as UnlockIcon, X } from 'lucide-react'
import type { Country, Language, Session } from './api'
import { useBrand } from './theme'
import { cx } from './ui'
import { useT } from './words'

export type View = 'home' | 'browse' | 'favourites'

/**
 * The bar across the top: who we are, how to find a perfume, where the buyer is shopping from, and the two
 * things they are collecting — saved perfumes and the order itself.
 *
 * When nobody has unlocked the catalogue the right-hand button reads "Unlock wholesale prices", which is the
 * whole invitation. Once a code has been entered it becomes the business's own name, so a buyer can always see
 * whose prices they are looking at.
 */
export function Header({ view, session, country, languages, units, favourites, onView, onSearch, search, onUnlock, onBasket, onCountry, onLanguage }: {
  view: View
  session: Session | null
  country: Country | null
  languages: Language[]
  units: number
  favourites: number
  onView: (v: View) => void
  onSearch: (q: string) => void
  search: string
  onUnlock: () => void
  onBasket: () => void
  onCountry: () => void
  onLanguage: (code: string, rtl: boolean) => void
}) {
  const t = useT()
  const brand = useBrand()
  const [open, setOpen] = useState(false)
  const [searching, setSearching] = useState(false)

  const go = (v: View) => { onView(v); setOpen(false) }
  const nav: [View, string][] = [['home', 'cat.home'], ['browse', 'cat.all_perfumes']]

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur pt-safe ps-safe pe-safe">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 sm:gap-4">
        <button type="button" onClick={() => setOpen((x) => !x)} aria-label={t('cat.menu')} aria-expanded={open}
          className="grid size-11 shrink-0 place-items-center rounded-full text-fg-2 transition hover:text-fg md:hidden">
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>

        <button type="button" onClick={() => go('home')} className="font-serif text-xl font-semibold tracking-[0.18em] sm:text-2xl">{brand.wordmark}</button>

        <nav aria-label={t('cat.menu')} className="ms-4 hidden gap-1 md:flex">
          {nav.map(([v, key]) => (
            <button key={v} type="button" onClick={() => go(v)} aria-current={view === v ? 'page' : undefined}
              className={cx('rounded-full px-3 py-2 text-sm transition', view === v ? 'text-fg' : 'text-fg-2 hover:text-fg')}>
              {t(key)}
              {view === v && <span className="mx-auto mt-1 block h-px w-4 bg-gold" />}
            </button>
          ))}
        </nav>

        <div className="flex-1" />

        {searching ? (
          <input
            autoFocus
            type="search"
            value={search}
            onChange={(e) => { onSearch(e.target.value); if (e.target.value) onView('browse') }}
            onBlur={() => !search && setSearching(false)}
            placeholder={t('cat.search')}
            aria-label={t('cat.search')}
            className="h-10 w-40 rounded-full border border-line bg-surface px-4 text-sm outline-none transition focus:border-gold focus:ring-4 focus:ring-gold/20 sm:w-56"
          />
        ) : (
          <button type="button" onClick={() => setSearching(true)} aria-label={t('cat.search')}
            className="grid size-11 place-items-center rounded-full text-fg-2 transition hover:text-fg"><Search className="size-5" /></button>
        )}

        {country && (
          <button type="button" onClick={onCountry} aria-label={t('cat.change_country')}
            className="num hidden h-9 items-center rounded-full border border-line px-3 text-xs font-semibold tracking-widest text-fg-2 transition hover:border-gold hover:text-fg sm:inline-flex">
            {country.iso2}
          </button>
        )}

        <button type="button" onClick={() => go('favourites')} aria-label={t('cat.favourites')}
          className="relative grid size-11 place-items-center rounded-full text-fg-2 transition hover:text-fg">
          <Heart className={cx('size-5', view === 'favourites' && 'fill-gold text-gold')} />
          {favourites > 0 && <Count n={favourites} />}
        </button>

        <button type="button" onClick={onBasket} aria-label={t('cat.your_order')}
          className="relative grid size-11 place-items-center rounded-full text-fg-2 transition hover:text-fg">
          <ShoppingBag className="size-5" />
          {units > 0 && <Count n={units} />}
        </button>

        <button type="button" onClick={onUnlock}
          className={cx(
            'hidden h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold transition sm:inline-flex',
            session ? 'border border-line text-fg hover:border-gold' : 'bg-ink text-white hover:bg-charcoal',
          )}>
          {session ? <UnlockIcon className="size-4 text-gold" /> : <Lock className="size-4" />}
          <span className="max-w-32 truncate">{session ? session.business : t('cat.locked_prices')}</span>
        </button>
      </div>

      {open && (
        <div className="border-t border-line px-4 py-3 md:hidden">
          <nav aria-label={t('cat.menu')} className="grid gap-1">
            {nav.map(([v, key]) => (
              <button key={v} type="button" onClick={() => go(v)}
                className={cx('rounded-xl px-3 py-2.5 text-start text-sm', view === v ? 'bg-surface-2 font-medium' : 'text-fg-2')}>{t(key)}</button>
            ))}
            <button type="button" onClick={() => { onCountry(); setOpen(false) }} className="rounded-xl px-3 py-2.5 text-start text-sm text-fg-2">
              {t('cat.change_country')}{country ? ` · ${country.iso2}` : ''}
            </button>
            <button type="button" onClick={() => { onUnlock(); setOpen(false) }} className="rounded-xl px-3 py-2.5 text-start text-sm font-medium">
              {session ? session.business : t('cat.locked_prices')}
            </button>
          </nav>
          {languages.length > 1 && (
            <div className="mt-2 flex flex-wrap gap-1.5 border-t border-line pt-3">
              {languages.map((l) => (
                <button key={l.code} type="button" onClick={() => { onLanguage(l.code, l.rtl); setOpen(false) }}
                  className="rounded-full border border-line px-3 py-1.5 text-xs">{l.native}</button>
              ))}
            </div>
          )}
        </div>
      )}
    </header>
  )
}

function Count({ n }: { n: number }) {
  return (
    <span className="num absolute -end-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full bg-gold px-1 text-[0.65rem] font-bold text-ink">
      {n > 99 ? '99+' : n}
    </span>
  )
}
