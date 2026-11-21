import { ArrowRight } from 'lucide-react'
import type { Collection, CollectionRow, Look, Perfume, PriceLine } from '../api'
import { useBrand } from '../theme'
import { Button, Rule, SectionTitle, cx } from '../ui'
import { kindKey, useP, useT } from '../words'
import { Card } from './Card'

/**
 * The front of the showroom, laid out the way the owner arranged it.
 *
 * `look.sections` is the page: the sections switched on, in their order, and nothing else. So moving collections
 * above featured in the admin panel moves it here, and switching one off removes it rather than emptying it.
 *
 * Everything shown is the shop's own material — its perfumes, its kinds, its collections, its words. Where the
 * owner has written nothing, the catalogue falls back to its own translated wording; it never invents a campaign
 * or passes a stand-in photograph off as Lattafa stock.
 */
export function Home({ collection, look, prices, favourites, session, onOpen, onFavourite, onBrowse, onKind, onCollection, onUnlock }: {
  collection: Collection
  look: Look
  prices: Map<string, PriceLine> | null
  favourites: string[]
  session: boolean
  onOpen: (p: Perfume) => void
  onFavourite: (p: Perfume) => void
  onBrowse: () => void
  onKind: (kind: string) => void
  onCollection: (c: CollectionRow) => void
  onUnlock: () => void
}) {
  const t = useT()
  const p1 = useP()
  const brand = useBrand()
  const { products, categories } = collection
  const collections = collection.collections ?? []

  const cheapest = (p: Perfume): PriceLine | null => {
    if (!prices) return null
    const found = p.sizes.map((s) => prices.get(s.variantId)).filter(Boolean) as PriceLine[]
    return found.length ? found.reduce((a, b) => (a.priceCents <= b.priceCents ? a : b)) : null
  }

  const row = (title: string, list: Perfume[]) => !list.length ? null : (
    <section className="mx-auto max-w-6xl px-4 py-10">
      <SectionTitle title={title} action={<Button variant="ghost" onClick={onBrowse}>{t('cat.view_all')} <ArrowRight className="size-4 rtl:rotate-180" /></Button>} />
      <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
        {list.map((p) => (
          <Card key={p.id} perfume={p} price={cheapest(p)} unlocked={session} favourite={favourites.includes(p.id)} onOpen={() => onOpen(p)} onFavourite={() => onFavourite(p)} />
        ))}
      </div>
    </section>
  )

  /** Every section the catalogue knows how to draw, by the key the appearance screen uses. */
  const section = (key: string) => {
    switch (key) {
      case 'hero':
        return (
          <section key={key} className="relative overflow-hidden border-b border-line">
            {look.hero ? (
              <>
                <img src={look.hero} alt="" aria-hidden className="absolute inset-0 size-full object-cover" />
                <div aria-hidden className="absolute inset-0 bg-ink/55" />
              </>
            ) : (
              <div aria-hidden className="pointer-events-none absolute inset-0">
                <div className="absolute -top-1/2 start-[-10%] h-[60vh] w-[60vh] rounded-full bg-gold-soft/60 blur-3xl motion-safe:animate-glow-a" />
                <div className="absolute -bottom-1/3 end-[-5%] h-[45vh] w-[45vh] rounded-full bg-gold-light/25 blur-3xl motion-safe:animate-glow-b" />
              </div>
            )}

            <div className={cx('relative mx-auto max-w-4xl px-4 py-16 text-center sm:py-24', look.hero && 'text-white')}>
              <p className={cx('num text-[0.7rem] font-medium tracking-[0.42em] uppercase', look.hero ? 'text-gold-light' : 'text-gold-text')}>
                {p1('cat.perfumes_n', products.length)}
              </p>
              <h1 className="font-serif mt-4 text-4xl leading-tight sm:text-6xl">{look.headline || t('cat.welcome_title')}</h1>
              <p className={cx('mx-auto mt-5 max-w-xl text-sm leading-relaxed sm:text-base', look.hero ? 'text-white/85' : 'text-fg-2')}>
                {look.lead || t('cat.welcome_lead')}
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <Button onClick={onBrowse} className={look.hero ? 'bg-white !text-ink hover:bg-gold-soft' : undefined}>{t('cat.explore')}</Button>
                {!session && <Button variant="quiet" onClick={onUnlock} className={look.hero ? 'border-white/40 !bg-white/10 !text-white hover:border-white' : undefined}>{t('cat.locked_prices')}</Button>}
              </div>
            </div>
          </section>
        )

      case 'kinds':
        return categories.length < 2 ? null : (
          <section key={key} className="mx-auto max-w-6xl px-4 py-12">
            <SectionTitle title={t('cat.shop_by_kind')} />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {categories.map(({ key: kind, count }) => (
                <button key={kind} type="button" onClick={() => onKind(kind)}
                  className="group flex flex-col items-start gap-1 rounded-card border border-line bg-surface p-4 text-start transition hover:border-gold hover:shadow-soft">
                  <span className="font-serif text-base">{t(kindKey(kind))}</span>
                  <span className="num text-xs text-fg-2">{p1('cat.perfumes_n', count)}</span>
                </button>
              ))}
            </div>
          </section>
        )

      case 'collections':
        return !collections.length ? null : (
          <section key={key} className="mx-auto max-w-6xl px-4 py-12">
            <SectionTitle title={t('cat.collections')} />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {collections.map((c) => (
                <button key={c.id} type="button" onClick={() => onCollection(c)}
                  className="group overflow-hidden rounded-card border border-line bg-surface text-start transition hover:border-gold hover:shadow-soft">
                  <span className="block h-36 overflow-hidden bg-surface-2">
                    {c.image
                      ? <img src={c.image} alt="" loading="lazy" decoding="async" className="size-full object-cover transition duration-500 group-hover:scale-105" />
                      : <span aria-hidden className="grid size-full place-items-center"><Rule /></span>}
                  </span>
                  <span className="block p-4">
                    <span className="font-serif block text-lg">{c.name}</span>
                    {c.description && <span className="mt-1 block text-sm leading-relaxed text-fg-2">{c.description}</span>}
                    <span className="num mt-2 block text-xs text-gold-text">{p1('cat.perfumes_n', c.products.length)}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )

      case 'featured':
        return <div key={key}>{row(t('cat.featured'), products.filter((p) => p.featured).slice(0, 8))}</div>

      case 'new':
        return <div key={key}>{row(t('cat.new_arrivals'), products.filter((p) => p.isNew).slice(0, 8))}</div>

      case 'story':
        return (
          <section key={key} className="border-y border-line bg-surface-2/60">
            <div className="mx-auto max-w-3xl px-4 py-16 text-center">
              <Rule />
              <h2 className="font-serif mt-5 text-2xl sm:text-3xl">{t('cat.story_title')}</h2>
              <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-fg-2">{t('cat.story_body')}</p>
              {brand.tagline && <p className="num mt-5 text-[0.7rem] tracking-[0.36em] text-gold-text uppercase">{brand.tagline}</p>}
            </div>
          </section>
        )

      case 'how':
        return (
          <section key={key} className="mx-auto max-w-5xl px-4 py-16">
            <SectionTitle title={t('cat.how_title')} />
            <ol className="grid gap-5 sm:grid-cols-3">
              {['cat.how_1', 'cat.how_2', 'cat.how_3'].map((word, i) => (
                <li key={word} className="rounded-card border border-line bg-surface p-5">
                  <span className="num font-serif text-3xl text-gold">{i + 1}</span>
                  <p className="mt-2 text-sm leading-relaxed text-fg-2">{t(word)}</p>
                </li>
              ))}
            </ol>
            {!session && (
              <div className="mt-8 text-center">
                <Button onClick={onUnlock}>{t('cat.locked_prices')}</Button>
              </div>
            )}
          </section>
        )

      default:
        // a section this build does not know: the server already drops those, and a blank is better than a guess
        return null
    }
  }

  return <>{look.sections.map((s) => section(s.key))}</>
}
