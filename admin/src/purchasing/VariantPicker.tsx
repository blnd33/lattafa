import { useMemo, useState } from 'react'
import { ProductImage } from '@/components/ui/Brand'
import { SearchInput } from '@/components/ui/Field'
import type { CatalogItem, CatalogVariant } from '@/services/catalog'
import type { Product } from '@/data/types'
import { useCatalog } from '@/hooks/queries'
import { pick, useT } from '@/i18n'
import { useUI } from '@/store/ui'

export interface Picked { product: Product; variant: CatalogVariant }

/** Find a size by name (any language), brand, SKU or barcode. A scanned barcode adds it straight away. */
export function VariantPicker({ onPick }: { onPick: (p: Picked) => void }) {
  const t = useT()
  const lang = useUI((s) => s.lang)
  const { data: catalog = [] } = useCatalog()
  const [q, setQ] = useState('')
  const all = useMemo(() => catalog.flatMap((c: CatalogItem) => c.variants.map((variant) => ({ product: c.product, variant }))), [catalog])
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return []
    return all.filter(({ product: p, variant: v }) =>
      [p.name.en, p.name.ar, p.name.ku, p.brand, v.sku, v.barcode, v.label].some((x) => x?.toLowerCase().includes(s))).slice(0, 8)
  }, [all, q])
  const take = (p: Picked) => { onPick(p); setQ('') }
  return (
    <div className="relative">
      <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('po.search')} aria-label={t('po.add_item')}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          e.preventDefault()
          const exact = all.find(({ variant: v }) => v.barcode === q.trim() || v.sku.toLowerCase() === q.trim().toLowerCase())
          if (exact) take(exact)
          else if (hits.length === 1) take(hits[0])
        }} />
      {q.trim() && (
        <ul role="listbox" aria-label={t('po.add_item')} className="absolute inset-x-0 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-lg">
          {!hits.length ? <li className="px-3 py-3 text-sm text-fg-2">{t('po.no_match')}</li> : hits.map((h) => (
            <li key={h.variant.id} role="option" aria-selected={false}>
              <button type="button" onClick={() => take(h)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-start hover:bg-surface-2">
                <ProductImage product={h.product} className="size-10 shrink-0 rounded-lg bg-surface-2" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{pick(h.product.name, lang)} <span className="text-fg-2">· {h.variant.label}</span></span>
                  <span className="num block text-xs text-fg-2">{h.variant.sku}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
