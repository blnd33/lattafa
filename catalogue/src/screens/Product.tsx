import { useEffect, useState } from 'react'
import { ArrowLeft, Heart } from 'lucide-react'
import type { Perfume, PriceLine, Size } from '../api'
import { money } from '../api'
import { Bottle, Button, Pill, Quantity, Rule, SectionTitle, cx } from '../ui'
import { genderKey, kindKey, useT } from '../words'
import { Card } from './Card'

/**
 * One perfume, in full.
 *
 * A size with no agreed price cannot be ordered — the quantity control is simply not there, and the row says so.
 * That is the same rule the server enforces when an order is checked; here it only saves the buyer from building
 * a basket that would be refused.
 *
 * Fragrance notes are often missing on a perfume the shop has only just entered. Each pyramid row appears only if
 * it has something in it, so a half-filled product reads like a quiet page rather than a broken one.
 */
export function Product({ perfume, prices, related, favourite, basket, unlocked, onBack, onFavourite, onQty, onOpen, onUnlock }: {
  perfume: Perfume
  prices: Map<string, PriceLine> | null
  related: Perfume[]
  favourite: boolean
  basket: Record<string, number>
  unlocked: boolean
  onBack: () => void
  onFavourite: () => void
  onQty: (variantId: string, qty: number) => void
  onOpen: (p: Perfume) => void
  onUnlock: () => void
}) {
  const t = useT()
  const priceOf = (s: Size) => prices?.get(s.variantId) ?? null

  // the shop's own photograph first, then the catalogue's; with none, the drawn bottle stands in and says so
  const photographs = perfume.images?.length ? perfume.images : perfume.image ? [perfume.image] : []
  const [picked, setPicked] = useState(0)
  const index = picked < photographs.length ? picked : 0
  const shown = photographs[index] ?? null
  useEffect(() => { setPicked(0) }, [perfume.id])

  const pyramid: [string, string[]][] = [
    ['cat.notes_top', perfume.notes?.top ?? []],
    ['cat.notes_heart', perfume.notes?.heart ?? []],
    ['cat.notes_base', perfume.notes?.base ?? []],
  ]
  const hasNotes = pyramid.some(([, list]) => list.length > 0)

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <Button variant="ghost" onClick={onBack} className="!px-0"><ArrowLeft className="size-4 rtl:rotate-180" />{t('cat.back')}</Button>

      <div className="mt-4 grid gap-10 lg:grid-cols-2">
        {/* the bottle, and any further photographs the catalogue has been given */}
        <div className="lg:sticky lg:top-24 lg:self-start">
          <div className="relative aspect-square overflow-hidden rounded-card bg-[image:var(--img-bg)] p-10">
            {shown ? <img src={shown} alt={perfume.name} loading="eager" decoding="async" className="size-full object-contain" /> : <Bottle perfume={perfume} eager />}
            <span className="absolute start-4 top-4 flex gap-1.5">
              {perfume.isNew && <Pill>{t('cat.new')}</Pill>}
              {perfume.featured && <Pill tone="quiet">{t('cat.featured')}</Pill>}
            </span>
          </div>

          {photographs.length > 1 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {photographs.map((src, i) => (
                <li key={src}>
                  <button type="button" onClick={() => setPicked(i)} aria-label={t('cat.photograph_n', { n: i + 1 })} aria-current={i === index ? 'true' : undefined}
                    className={cx('size-16 overflow-hidden rounded-xl border bg-[image:var(--img-bg)] transition', i === index ? 'border-gold' : 'border-line hover:border-gold')}>
                    <img src={src} alt="" loading="lazy" decoding="async" className="size-full object-contain p-1" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* what it is, and how to order it */}
        <div>
          <p className="text-[0.65rem] font-medium tracking-[0.2em] text-fg-2 uppercase">{perfume.brand}</p>
          <h1 className="font-serif mt-1 text-3xl leading-tight sm:text-4xl">{perfume.name}</h1>

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-fg-2">
            {perfume.category && <span>· {t(kindKey(perfume.category))}</span>}
            {perfume.gender && <span>· {t(genderKey(perfume.gender))}</span>}
            {perfume.concentration && <span>· {perfume.concentration}</span>}
          </div>

          <div className="mt-4 flex items-center gap-2">
            <Button variant="quiet" onClick={onFavourite}>
              <Heart className={cx('size-4', favourite && 'fill-gold text-gold')} />
              {t(favourite ? 'cat.favourited' : 'cat.favourite')}
            </Button>
          </div>

          {perfume.description && <p className="mt-6 text-sm leading-relaxed text-fg-2">{perfume.description}</p>}

          {/* the sizes */}
          <section className="mt-8">
            <h2 className="mb-3 text-xs font-semibold tracking-[0.14em] text-fg-2 uppercase">{t('cat.sizes')}</h2>
            <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
              {perfume.sizes.map((s) => {
                const price = priceOf(s)
                const qty = basket[s.variantId] ?? 0
                const orderable = !!price
                return (
                  <li key={s.variantId} className="flex flex-wrap items-center gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <p className="num font-medium">{s.label}</p>
                      <p className="num mt-0.5 text-xs text-fg-2">{s.sku}</p>
                      {(s.minQty > 0 || s.step > 1) && (
                        <p className="num mt-1 text-xs text-gold-text">
                          {s.minQty > 0 && t('cat.min_qty', { qty: s.minQty })}
                          {s.minQty > 0 && s.step > 1 ? ' ' : ''}
                          {s.step > 1 && t('cat.qty_step', { step: s.step })}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-4">
                      {price ? <span className="num text-lg font-semibold">{money(price.priceCents)}</span>
                        : <span className="text-xs font-medium text-gold-text">{t(unlocked ? 'cat.err_unpriced' : 'cat.locked_prices', { sku: s.sku })}</span>}

                      {orderable ? <Quantity qty={qty} minQty={s.minQty} step={s.step} onChange={(n) => onQty(s.variantId, n)} /> : null}
                    </div>
                  </li>
                )
              })}
            </ul>
            {!unlocked && (
              <div className="mt-4 rounded-card border border-gold/40 bg-gold-soft/50 p-4 text-center">
                <p className="text-sm text-fg">{t('cat.unlock_to_order')}</p>
                <Button className="mt-3" onClick={onUnlock}>{t('cat.locked_prices')}</Button>
              </div>
            )}
          </section>

          {/* the pyramid */}
          {hasNotes && (
            <section className="mt-8">
              <h2 className="mb-3 text-xs font-semibold tracking-[0.14em] text-fg-2 uppercase">{t('cat.notes')}</h2>
              <dl className="grid gap-3">
                {pyramid.filter(([, list]) => list.length > 0).map(([key, list]) => (
                  <div key={key} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line pb-3 last:border-0">
                    <dt className="w-24 shrink-0 text-xs text-fg-2">{t(key)}</dt>
                    <dd className="min-w-0 flex-1 text-sm">{list.join(' · ')}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {/* the rest of what the shop knows */}
          <dl className="mt-8 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
            {perfume.longevity > 0 && <Fact label={t('cat.longevity')} value={<Dots n={perfume.longevity} />} />}
            {perfume.sillage > 0 && <Fact label={t('cat.sillage')} value={<Dots n={perfume.sillage} />} />}
            {!!perfume.scentFamilies?.length && <Fact label={t('cat.families')} value={perfume.scentFamilies.join(', ')} />}
          </dl>
        </div>
      </div>

      {!!related.length && (
        <section className="mt-16 border-t border-line pt-10">
          <Rule className="mb-6" />
          <SectionTitle title={t('cat.related')} />
          <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
            {related.map((p) => (
              <Card key={p.id} perfume={p} price={prices?.get(p.sizes[0]?.variantId ?? '') ?? null} unlocked={unlocked} favourite={false} onOpen={() => onOpen(p)} onFavourite={() => undefined} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-fg-2">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  )
}

function Dots({ n }: { n: number }) {
  return (
    <span className="flex gap-1" aria-label={String(n)}>
      {[1, 2, 3, 4, 5].map((i) => <span key={i} className={cx('size-1.5 rounded-full', i <= n ? 'bg-gold' : 'bg-line')} />)}
    </span>
  )
}
