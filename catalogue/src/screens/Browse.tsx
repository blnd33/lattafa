import { useMemo, useState } from 'react'
import { SlidersHorizontal, X } from 'lucide-react'
import type { Collection, Perfume, PriceLine } from '../api'
import { Button, Empty, cx } from '../ui'
import { genderKey, kindKey, useT } from '../words'
import { Card } from './Card'

export interface Filters {
  kind: string
  brand: string
  gender: string
  inStockOnly: boolean
  /** the id of one of the owner's collections, when the buyer came in through it */
  collection: string
}

export const NO_FILTERS: Filters = { kind: '', brand: '', gender: '', inStockOnly: false, collection: '' }

/** Everything the search box and the filters leave standing. */
export function sift(products: Perfume[], search: string, f: Filters, inCollection?: Set<string> | null): Perfume[] {
  const needle = search.trim().toLowerCase()
  return products.filter((p) => {
    if (inCollection && !inCollection.has(p.id)) return false
    if (f.kind && p.category !== f.kind) return false
    if (f.brand && p.brand !== f.brand) return false
    if (f.gender && p.gender !== f.gender) return false
    if (f.inStockOnly && !p.inStock) return false
    if (!needle) return true
    // what a buyer would type: a name, a house, a note, or the code off the box
    return [p.name, p.brand, p.concentration, ...p.scentFamilies, ...p.notes.top, ...p.notes.heart, ...p.notes.base]
      .some((s) => s?.toLowerCase().includes(needle))
      || p.sizes.some((s) => s.sku.toLowerCase().includes(needle))
  })
}

/**
 * The whole collection, with the ways through it.
 *
 * On a phone the filters are a sheet rather than a rail — the brief is firm that this has to be comfortable on a
 * small touchscreen, and a grid squeezed beside a sidebar is not.
 */
export function Browse({ collection, prices, favourites, search, filters, onFilters, onOpen, onFavourite, onClearSearch }: {
  collection: Collection
  prices: Map<string, PriceLine> | null
  favourites: string[]
  search: string
  filters: Filters
  onFilters: (f: Filters) => void
  onOpen: (p: Perfume) => void
  onFavourite: (p: Perfume) => void
  onClearSearch: () => void
}) {
  const t = useT()
  const [sheet, setSheet] = useState(false)

  // a collection the buyer arrived through narrows the grid to its perfumes, and names the page after it
  const groupings = collection.collections ?? []
  const chosen = useMemo(() => groupings.find((c) => c.id === filters.collection) ?? null, [groupings, filters.collection])
  const inCollection = useMemo(() => (chosen ? new Set(chosen.products) : null), [chosen])

  const shown = useMemo(() => sift(collection.products, search, filters, inCollection), [collection.products, search, filters, inCollection])
  const genders = useMemo(() => [...new Set(collection.products.map((p) => p.gender))].filter(Boolean), [collection.products])
  const dirty = search.trim() !== '' || filters.kind || filters.brand || filters.gender || filters.inStockOnly || filters.collection

  const cheapest = (p: Perfume): PriceLine | null => {
    if (!prices) return null
    const found = p.sizes.map((s) => prices.get(s.variantId)).filter(Boolean) as PriceLine[]
    return found.length ? found.reduce((a, b) => (a.priceCents <= b.priceCents ? a : b)) : null
  }

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => onFilters({ ...filters, [k]: v })

  const choices = (
    <div className="grid gap-5">
      {groupings.length > 0 && (
        <Group label={t('cat.collections')} value={filters.collection} onPick={(v) => set('collection', v)}
          options={groupings.map((c) => ({ value: c.id, label: c.name }))} anyLabel={t('cat.any')} />
      )}
      <Group label={t('cat.kind')} value={filters.kind} onPick={(v) => set('kind', v)}
        options={collection.categories.map((c) => ({ value: c.key, label: t(kindKey(c.key)) }))} anyLabel={t('cat.any')} />
      {genders.length > 1 && (
        <Group label={t('cat.gender')} value={filters.gender} onPick={(v) => set('gender', v)}
          options={genders.map((g) => ({ value: g, label: t(genderKey(g)) }))} anyLabel={t('cat.any')} />
      )}
      {collection.brands.length > 1 && (
        <Group label={t('cat.brand')} value={filters.brand} onPick={(v) => set('brand', v)}
          options={collection.brands.map((b) => ({ value: b, label: b }))} anyLabel={t('cat.any')} />
      )}
      <div>
        <p className="mb-2 text-xs font-semibold tracking-[0.14em] text-fg-2 uppercase">{t('cat.availability')}</p>
        <button type="button" onClick={() => set('inStockOnly', !filters.inStockOnly)} aria-pressed={filters.inStockOnly}
          className={cx('rounded-full border px-4 py-2 text-sm transition', filters.inStockOnly ? 'border-gold bg-gold-soft text-gold-text' : 'border-line hover:border-gold')}>
          {t('cat.in_stock_only')}
        </button>
      </div>
    </div>
  )

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl sm:text-3xl">{chosen ? chosen.name : filters.kind ? t(kindKey(filters.kind)) : t('cat.all_perfumes')}</h1>
          {chosen?.description && <p className="mt-1 max-w-xl text-sm leading-relaxed text-fg-2">{chosen.description}</p>}
          <p className="num mt-1 text-xs text-fg-2">{t('cat.showing_n', { n: shown.length, total: inCollection ? inCollection.size : collection.products.length })}</p>
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <Button variant="ghost" onClick={() => { onFilters(NO_FILTERS); onClearSearch() }}>
              <X className="size-4" />{t('cat.clear')}
            </Button>
          )}
          <Button variant="quiet" onClick={() => setSheet((x) => !x)} className="lg:hidden">
            <SlidersHorizontal className="size-4" />{t('cat.filters')}
          </Button>
        </div>
      </div>

      {search.trim() && (
        <p className="mb-5 text-sm text-fg-2">
          {t('cat.search')}: <span className="font-medium text-fg">{search}</span>
        </p>
      )}

      <div className="flex gap-10">
        <aside className="hidden w-52 shrink-0 lg:block">
          <div className="sticky top-24">{choices}</div>
        </aside>

        <div className="min-w-0 flex-1">
          {sheet && <div className="mb-6 rounded-card border border-line bg-surface p-5 lg:hidden">{choices}</div>}

          {!shown.length ? (
            <Empty
              title={t('cat.no_results')}
              hint={t('cat.no_results_hint')}
              action={dirty ? <Button variant="quiet" onClick={() => { onFilters(NO_FILTERS); onClearSearch() }}>{t('cat.clear')}</Button> : undefined}
            />
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3">
              {shown.map((p) => (
                <Card key={p.id} perfume={p} price={cheapest(p)} unlocked={!!prices} favourite={favourites.includes(p.id)} onOpen={() => onOpen(p)} onFavourite={() => onFavourite(p)} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Group({ label, value, options, anyLabel, onPick }: {
  label: string
  value: string
  options: { value: string; label: string }[]
  anyLabel: string
  onPick: (v: string) => void
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold tracking-[0.14em] text-fg-2 uppercase">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {[{ value: '', label: anyLabel }, ...options].map((o) => (
          <button key={o.value || 'any'} type="button" onClick={() => onPick(o.value)} aria-pressed={value === o.value}
            className={cx(
              'rounded-full border px-3 py-1.5 text-sm transition',
              value === o.value ? 'border-gold bg-gold-soft text-gold-text' : 'border-line text-fg-2 hover:border-gold hover:text-fg',
            )}>{o.label}</button>
        ))}
      </div>
    </div>
  )
}
