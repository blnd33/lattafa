import { memo, useState } from 'react'
import { FlaskConical, Plus } from 'lucide-react'
import { ProductImage } from '@/components/ui/Brand'
import { Amt } from '@/components/ui/Amt'
import { cn } from '@/components/ui/cn'
import { EmptyState } from '@/components/ui/Controls'
import { pick, useT } from '@/i18n'
import type { Lang } from '@/data/types'
import type { CatalogItem, CatalogVariant } from '@/services/catalog'

interface CardProps {
  item: CatalogItem
  lang: Lang
  inCart: Record<string, number>
  onAdd: (v: CatalogVariant) => void
  onTester?: (v: CatalogVariant) => void
  allowNegative: boolean
}

const ProductCard = memo(function ProductCard({ item, lang, inCart, onAdd, onTester, allowNegative }: CardProps) {
  const t = useT()
  const [sel, setSel] = useState(0)
  const { product: p, variants } = item
  const v = variants[Math.min(sel, variants.length - 1)]
  const left = v.stock - (inCart[v.id] ?? 0)
  const out = left <= 0 && !allowNegative
  const low = !out && v.stock <= v.minStock
  const qty = inCart[v.id] ?? 0

  return (
    <article className={cn('group relative flex flex-col overflow-hidden rounded-2xl border bg-surface transition', qty ? 'border-gold shadow-[0_0_0_2px_rgba(212,165,72,.25)]' : 'border-line hover:border-gold-light', out && 'opacity-60')}>
      <button type="button" disabled={out} onClick={() => onAdd(v)} className="flex flex-1 flex-col gap-2 p-2.5 text-start disabled:cursor-not-allowed" aria-label={`${t('sell.add')} ${pick(p.name, lang)} ${v.label}`}>
        <div className="relative">
          <ProductImage product={p} className="h-28 rounded-xl sm:h-32" />
          <span className={cn('absolute start-2 top-2 rounded-full border px-2 py-0.5 text-[11px] font-semibold', out ? 'border-danger/30 bg-danger-bg text-danger-fg' : low ? 'border-warning/30 bg-warn-bg text-warn-fg' : 'border-line bg-surface text-fg-2')}>
            {out ? t('sell.out_of_stock') : low ? <>{t('sell.low')} · <span className="num">{Math.max(left, 0)}</span></> : <><span className="num">{Math.max(left, 0)}</span> {t('sell.in_stock')}</>}
          </span>
          {qty > 0 && <span className="num absolute end-2 top-2 grid size-7 place-items-center rounded-full bg-gold text-sm font-bold text-ink shadow">{qty}</span>}
        </div>
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold leading-snug">{pick(p.name, lang)}</div>
          <div className="truncate text-xs text-fg-2">{p.brand} · {p.concentration}</div>
        </div>
      </button>
      <div className="flex flex-col gap-2 px-2.5 pb-2.5">
        {variants.length > 1 && (
          <div className="flex gap-1.5 overflow-x-auto scroll-hide">
            {variants.map((x, i) => (
              <button key={x.id} type="button" aria-pressed={i === sel} onClick={() => setSel(i)} className={cn('num h-9 shrink-0 rounded-lg border px-2.5 text-xs font-semibold transition', i === sel ? 'border-gold bg-gold-soft text-[#6b4e12] dark:bg-gold/20 dark:text-gold-light' : 'border-line text-fg-2 hover:border-gold-light')}>{x.label}</button>
            ))}
          </div>
        )}
        {variants.length === 1 && <div className="num text-xs text-fg-2">{v.label}</div>}
        <div className="flex items-center justify-between gap-2">
          <Amt n={v.retailIQD} className="text-[15px] font-bold" />
          <button type="button" disabled={out} onClick={() => onAdd(v)} aria-label={t('sell.add')} className="grid size-10 place-items-center rounded-xl bg-gold text-ink transition active:scale-90 disabled:opacity-40"><Plus className="size-5" /></button>
        </div>
      </div>
      {onTester && v.stock > 0 && (
        <button type="button" onClick={() => onTester(v)} aria-label={t('sell.mark_tester')} title={t('sell.mark_tester')} className="absolute end-1.5 top-[4.6rem] grid size-8 place-items-center rounded-full bg-surface/90 text-fg-2 opacity-0 shadow transition hover:text-gold-text focus-visible:opacity-100 group-hover:opacity-100 max-md:opacity-100 sm:top-[5.4rem]"><FlaskConical className="size-4" /></button>
      )}
    </article>
  )
})

export function ProductGrid({ items, lang, inCart, onAdd, onTester, allowNegative }: { items: CatalogItem[]; lang: Lang; inCart: Record<string, number>; onAdd: (v: CatalogVariant) => void; onTester?: (v: CatalogVariant) => void; allowNegative: boolean }) {
  const t = useT()
  if (!items.length) return <EmptyState title={t('sell.no_results')} hint={t('sell.no_results_hint')} />
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-[repeat(auto-fill,minmax(11.5rem,1fr))] sm:gap-3">
      {items.map((it) => <ProductCard key={it.product.id} item={it} lang={lang} inCart={inCart} onAdd={onAdd} onTester={onTester} allowNegative={allowNegative} />)}
    </div>
  )
}
