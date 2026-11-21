import { useMemo, useState } from 'react'
import type { Country, Language } from '../api'
import { useBrand } from '../theme'
import { Button, Rule, cx } from '../ui'
import { useT } from '../words'

/**
 * Entering the showroom.
 *
 * Two steps and no more: the brand, and then "where are you buying from?" — because the country decides the
 * language the catalogue opens in and the prices behind it. It is deliberately quick; a long animation between a
 * buyer and the collection is a door that sticks.
 */
export function Welcome({ onEnter }: { onEnter: () => void }) {
  const t = useT()
  const brand = useBrand()
  return (
    <main className="relative grid min-h-svh place-items-center overflow-hidden px-6 pt-safe pb-safe">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-1/3 start-[-15%] h-[70vh] w-[70vh] rounded-full bg-gold-soft/70 blur-3xl motion-safe:animate-glow-a" />
        <div className="absolute -bottom-1/4 end-[-10%] h-[55vh] w-[55vh] rounded-full bg-gold-light/30 blur-3xl motion-safe:animate-glow-b" />
      </div>

      <div className="relative max-w-lg text-center motion-safe:animate-rise">
        <p className="num text-[0.7rem] font-medium tracking-[0.42em] text-gold-text uppercase">{brand.tagline}</p>
        <h1 className="font-serif mt-3 text-5xl font-semibold tracking-[0.2em] sm:text-7xl">{brand.wordmark}</h1>
        <Rule className="my-6" />
        <h2 className="font-serif text-xl sm:text-2xl">{t('cat.welcome_title')}</h2>
        <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-fg-2">{t('cat.welcome_lead')}</p>
        <Button className="mt-8" onClick={onEnter}>{t('cat.explore')}</Button>
        <p className="mt-6 text-xs text-fg-2">{t('cat.prices_usd')}</p>
      </div>
    </main>
  )
}

/**
 * Where the buyer is shopping from.
 *
 * Every country here is a row the owner added; this screen knows the name of none of them. Picking one sets the
 * language it opens in, and — because prices differ by country — ends any session opened for another.
 */
export function Countries({ countries, languages, current, onPick, onCancel }: {
  countries: Country[]
  languages: Language[]
  current: string | null
  onPick: (country: Country) => void
  onCancel?: () => void
}) {
  const t = useT()
  const [q, setQ] = useState('')

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return countries
    return countries.filter((c) => [...Object.values(c.name), c.iso2].some((s) => s.toLowerCase().includes(needle)))
  }, [countries, q])

  const nameOf = (c: Country) => c.name.en || Object.values(c.name)[0] || c.iso2
  const languageOf = (c: Country) => languages.find((l) => l.code === c.language)

  return (
    <main className="mx-auto grid min-h-svh max-w-xl content-start gap-6 px-6 py-14 pt-safe pb-safe">
      <header className="text-center motion-safe:animate-rise">
        <h1 className="font-serif text-3xl sm:text-4xl">{t('cat.choose_country')}</h1>
        <Rule className="mt-5" />
      </header>

      {countries.length > 6 && (
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('cat.country_search')}
          aria-label={t('cat.country_search')}
          className="h-12 w-full rounded-full border border-line bg-surface px-5 text-sm outline-none transition focus:border-gold focus:ring-4 focus:ring-gold/20"
        />
      )}

      <ul className="grid gap-2">
        {shown.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onPick(c)}
              aria-current={c.id === current ? 'true' : undefined}
              className={cx(
                'flex w-full items-center gap-4 rounded-2xl border bg-surface px-5 py-4 text-start transition',
                c.id === current ? 'border-gold shadow-soft' : 'border-line hover:border-gold',
              )}
            >
              <span className="num text-xs font-semibold tracking-widest text-gold-text">{c.iso2}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{nameOf(c)}</span>
                <span className="block text-xs text-fg-2">{languageOf(c)?.native ?? c.language}</span>
              </span>
              {c.minOrderCents > 0 && <span className="num text-xs text-fg-2">{t('cat.min_order', { amount: `$${c.minOrderCents / 100}` })}</span>}
            </button>
          </li>
        ))}
      </ul>

      {!shown.length && <p className="text-center text-sm text-fg-2">{t('cat.no_results')}</p>}
      {onCancel && <Button variant="ghost" onClick={onCancel}>{t('cat.back')}</Button>}
    </main>
  )
}
