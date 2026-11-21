import { Heart } from 'lucide-react'
import type { Perfume, PriceLine } from '../api'
import { money } from '../api'
import { Bottle, Pill, Stock, cx } from '../ui'
import { useT } from '../words'

/**
 * One perfume in the grid.
 *
 * The price line is the whole point of the catalogue: before a code is entered it reads "Unlock wholesale
 * prices", and there is no figure to find in the page because the server never sent one. Afterwards it is this
 * buyer's own price — theirs, not a list price with a discount drawn on top.
 */
export function Card({ perfume, price, unlocked, favourite, onOpen, onFavourite }: {
  perfume: Perfume
  /** this buyer's price for the cheapest size, when the catalogue is unlocked */
  price: PriceLine | null
  /** whether a code has been entered — which decides what the absence of a price means */
  unlocked?: boolean
  favourite: boolean
  onOpen: () => void
  onFavourite: () => void
}) {
  const t = useT()

  return (
    <article className="group relative flex flex-col">
      <button type="button" onClick={onFavourite} aria-label={t(favourite ? 'cat.favourited' : 'cat.favourite')} aria-pressed={favourite}
        className="absolute end-2 top-2 z-10 grid size-10 place-items-center rounded-full bg-bg/70 text-fg-2 opacity-0 backdrop-blur transition hover:text-fg focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
        <Heart className={cx('size-4.5', favourite && 'fill-gold text-gold')} />
      </button>

      <button type="button" onClick={onOpen} className="flex flex-1 flex-col text-start">
        <span className="relative mb-3 block aspect-4/5 w-full overflow-hidden rounded-card bg-[image:var(--img-bg)] p-5">
          <Bottle perfume={perfume} className="transition-transform duration-500 group-hover:scale-105" />
          {(perfume.isNew || perfume.featured) && (
            <span className="absolute start-3 top-3 flex gap-1.5">
              {perfume.isNew && <Pill>{t('cat.new')}</Pill>}
              {perfume.featured && !perfume.isNew && <Pill tone="quiet">{t('cat.featured')}</Pill>}
            </span>
          )}
        </span>

        <span className="block text-[0.65rem] font-medium tracking-[0.18em] text-fg-2 uppercase">{perfume.brand}</span>
        <span className="mt-0.5 block font-serif text-lg leading-snug">{perfume.name}</span>
        <span className="num mt-0.5 block text-xs text-fg-2">
          {perfume.sizes.map((s) => s.label).join(' · ')}
          {perfume.concentration ? ` · ${perfume.concentration}` : ''}
        </span>

        <span className="mt-2 flex items-center justify-between gap-2">
          <Stock inStock={perfume.inStock} />
          {price
            ? <span className="num font-semibold">{money(price.priceCents)}</span>
            // unlocked and still no price means the shop has not set one for this buyer — not that they need a code
            : <span className="text-xs font-medium text-gold-text">{t(unlocked ? 'cat.ask_us' : 'cat.locked_prices')}</span>}
        </span>
      </button>
    </article>
  )
}
