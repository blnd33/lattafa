import { useMemo, useState } from 'react'
import { Download, FileUp, Percent, Plus, Tag } from 'lucide-react'
import { Amt } from '@/components/ui/Amt'
import { ProductImage } from '@/components/ui/Brand'
import { Badge, Checkbox, EmptyState, PageHeader, Spinner, Switch } from '@/components/ui/Controls'
import { Button } from '@/components/ui/Button'
import { SearchInput, Select } from '@/components/ui/Field'
import { Menu, MenuItem } from '@/components/ui/Menu'
import { pick, useT } from '@/i18n'
import { downloadText } from '@/lib/image'
import { exportCatalogCsv } from '@/services/csv'
import { useCatalogAll } from '@/hooks/queries'
import { useCan } from '@/hooks/useAuth'
import { useUI } from '@/store/ui'
import { ProductEditor } from './ProductEditor'
import { BulkPriceModal, ImportModal, LabelModal } from './ProductTools'
import type { CatalogItem } from '@/services/catalog'

export function ProductsPage() {
  const t = useT()
  const lang = useUI((s) => s.lang)
  const { data: catalog, isLoading } = useCatalogAll()
  const canCreate = useCan('products.create')
  const canPrices = useCan('prices.edit')
  const canImport = useCan('products.import')
  const canFinancial = useCan('reports.financial')
  const [q, setQ] = useState('')
  const [brand, setBrand] = useState('')
  const [cat, setCat] = useState('')
  const [inactive, setInactive] = useState(false)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<CatalogItem | 'new' | null>(null)
  const [labels, setLabels] = useState(false)
  const [bulk, setBulk] = useState(false)
  const [importing, setImporting] = useState(false)

  const brands = useMemo(() => [...new Set((catalog ?? []).map((c) => c.product.brand))].sort(), [catalog])
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (catalog ?? []).filter((c) => {
      if (!inactive && !c.product.active) return false
      if (brand && c.product.brand !== brand) return false
      if (cat && c.product.category !== cat) return false
      if (!s) return true
      return [c.product.name.en, c.product.name.ar, c.product.name.ku, c.product.brand, ...c.variants.flatMap((v) => [v.sku, v.barcode])].join(' ').toLowerCase().includes(s)
    })
  }, [catalog, q, brand, cat, inactive])
  const selectedItems = list.filter((c) => sel.has(c.product.id))
  const toggle = (id: string) => setSel((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const allSelected = list.length > 0 && list.every((c) => sel.has(c.product.id))

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      <PageHeader
        title={t('prod.title')}
        subtitle={t('prod.subtitle', { n: list.length })}
        actions={
          <>
            <Menu title={t('prod.tools')} trigger={({ toggle: tg }) => <Button variant="secondary" size="lg" onClick={tg}>{t('prod.tools')}</Button>}>
              {(close) => (
                <>
                  <MenuItem icon={<Tag className="size-5" />} onClick={() => { close(); setLabels(true) }} hint={selectedItems.length ? String(selectedItems.length) : undefined}>{t('prod.labels')}</MenuItem>
                  {canPrices && <MenuItem icon={<Percent className="size-5" />} onClick={() => { close(); setBulk(true) }}>{t('prod.bulk_price')}</MenuItem>}
                  {canImport && <MenuItem icon={<FileUp className="size-5" />} onClick={() => { close(); setImporting(true) }}>{t('prod.import')}</MenuItem>}
                  {canImport && <MenuItem icon={<Download className="size-5" />} onClick={async () => { close(); downloadText(`lattafa-products-${new Date().toISOString().slice(0, 10)}.csv`, await exportCatalogCsv()) }}>{t('prod.export')}</MenuItem>}
                </>
              )}
            </Menu>
            {canCreate && <Button variant="primary" size="lg" icon={<Plus className="size-5" />} onClick={() => setEditing('new')}>{t('prod.new')}</Button>}
          </>
        }
      />
      <div className="mb-4 grid gap-2.5 md:grid-cols-[1fr_12rem_12rem_auto]">
        <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('prod.search')} />
        <Select value={brand} onChange={(e) => setBrand(e.target.value)} aria-label={t('prod.brand')}><option value="">{t('prod.brand')}: {t('common.all')}</option>{brands.map((b) => <option key={b}>{b}</option>)}</Select>
        <Select value={cat} onChange={(e) => setCat(e.target.value)} aria-label={t('prod.category')}><option value="">{t('prod.category')}: {t('common.all')}</option>{['perfume', 'oud', 'mist', 'oil', 'set', 'home'].map((c) => <option key={c} value={c}>{t(`prod.cat_${c}`)}</option>)}</Select>
        <label className="flex h-11 items-center gap-2.5 rounded-xl bg-surface-2 px-3.5 text-sm font-medium">{t('prod.show_inactive')}<Switch checked={inactive} onChange={setInactive} label={t('prod.show_inactive')} /></label>
      </div>

      {isLoading ? <div className="grid place-items-center py-16"><Spinner className="size-9" /></div> : !list.length ? <EmptyState title={t('prod.none')} hint={t('prod.none_hint')} action={canCreate && <Button variant="primary" icon={<Plus className="size-5" />} onClick={() => setEditing('new')}>{t('prod.new')}</Button>} /> : (
        <>
          <div className="mb-2 flex items-center gap-3 text-sm text-fg-2">
            <Checkbox checked={allSelected} mixed={!allSelected && sel.size > 0} label={t('common.all')} onChange={(v) => setSel(v ? new Set(list.map((c) => c.product.id)) : new Set())} />
            {sel.size > 0 ? <span>{t('prod.selected', { n: sel.size })}</span> : <span>{t('prod.select_hint')}</span>}
          </div>
          <ul className="space-y-2.5">
            {list.map((c) => {
              const prices = c.variants.map((v) => v.retailIQD)
              const stock = c.variants.reduce((a, v) => a + v.stock, 0)
              const low = c.variants.some((v) => v.stock <= v.minStock)
              return (
                <li key={c.product.id} className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-2.5 shadow-soft">
                  <Checkbox checked={sel.has(c.product.id)} label={pick(c.product.name, lang)} onChange={() => toggle(c.product.id)} />
                  <button type="button" onClick={() => setEditing(c)} className="flex min-w-0 flex-1 items-center gap-3 text-start">
                    <ProductImage product={c.product} className="h-16 w-14 shrink-0 rounded-xl" />
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="block truncate font-semibold">{pick(c.product.name, lang)}</span>
                      <span className="block truncate text-xs text-fg-2">{c.product.brand} · {t(`prod.cat_${c.product.category}`)} · {t(`gender.${c.product.gender}`)}</span>
                      <span className="mt-1 flex flex-wrap gap-1.5">
                        {c.variants.map((v) => <Badge key={v.id} tone={v.stock <= v.minStock ? 'warn' : 'neutral'}><span className="num">{v.label}</span></Badge>)}
                        {!c.product.active && <Badge tone="danger">{t('prod.inactive')}</Badge>}
                        {c.product.showOnMenu && <Badge tone="gold">{t('prod.on_menu')}</Badge>}
                      </span>
                    </span>
                    <span className="hidden text-end sm:block">
                      {prices.length > 0 && <Amt n={Math.min(...prices)} className="font-bold" />}
                      {prices.length > 1 && Math.max(...prices) !== Math.min(...prices) && <div className="text-xs text-fg-2">→ <Amt n={Math.max(...prices)} unit={false} /></div>}
                      <div className={`mt-0.5 text-xs ${low ? 'font-semibold text-warn-fg' : 'text-fg-2'}`}>{t('prod.stock')}: <span className="num">{stock}</span></div>
                      {canFinancial && c.variants[0] && <div className="text-xs text-fg-2">{t('prod.cost')}: <Amt n={c.variants[0].costIQD} unit={false} /></div>}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}

      <ProductEditor value={editing} onClose={() => setEditing(null)} />
      <LabelModal open={labels} onClose={() => setLabels(false)} items={selectedItems.length ? selectedItems : list} />
      <BulkPriceModal open={bulk} onClose={() => setBulk(false)} productIds={sel.size ? [...sel] : undefined} />
      <ImportModal open={importing} onClose={() => setImporting(false)} />
    </div>
  )
}
