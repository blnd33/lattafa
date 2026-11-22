import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PackagePlus, ShoppingBag, Tag } from 'lucide-react'
import { ProductImage } from '@/components/ui/Brand'
import { Button } from '@/components/ui/Button'
import { Chips } from '@/components/ui/Controls'
import { SearchInput } from '@/components/ui/Field'
import { pick, useT } from '@/i18n'
import { useUI } from '@/store/ui'
import { unitPrice, type ShopItem } from '../field'
import { useMeta, useShop } from '../hooks'
import { Money, TopBar } from '../ui'
import { AddStockSheet, MyPriceSheet } from './MyStock'

type Filter = 'all' | 'low' | 'men' | 'women' | 'oud'
const LOW = 2

/**
 * The delegate's own van: what they are carrying, what they charge for it, and the way to add more.
 *
 * It starts empty. A size appears once they have stocked it or priced it, so this is their list, not the shop's
 * — the shop's catalogue is only reached through the search when they stock up.
 */
export function StockScreen() {
  const t = useT()
  const lang = useUI((s) => s.lang)
  const nav = useNavigate()
  const { data: items = [] } = useShop()
  const { data: meta } = useMeta()
  const rate = meta?.settings?.currency.rate || 1460
  const usd = meta?.settings?.currency.usdEnabled ?? true
  const [q, setQ] = useState('')
  const [f, setF] = useState<Filter>('all')
  const [adding, setAdding] = useState(false)
  const [pricing, setPricing] = useState<ShopItem | null>(null)

  const rows = useMemo(() => items.filter(({ product: p, variant: v, qty }) => {
    if (f === 'low' && qty > LOW) return false
    if ((f === 'men' || f === 'women') && p.gender !== f) return false
    if (f === 'oud' && p.category !== 'oud' && !p.scentFamilies.includes('oud')) return false
    const s = q.trim().toLowerCase()
    return !s || [p.name.en, p.name.ar, p.name.ku, p.brand, v.sku, v.label].join(' ').toLowerCase().includes(s)
  }), [items, q, f])
  const units = items.reduce((a, r) => a + Math.max(0, r.qty), 0)
  const inStock = items.filter((r) => r.qty > 0).length

  return (
    <div>
      <TopBar title={t('dl.my_van')} subtitle={t('dl.my_van_hint')}>
        <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('dl.search')} />
        <Chips className="mt-2" value={f} onChange={setF} options={(['all', 'low', 'men', 'women', 'oud'] as Filter[]).map((x) => ({ value: x, label: t(`dl.f_${x}`) }))} />
      </TopBar>

      <div className="mx-4 mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-2xl border border-line bg-surface p-3"><p className="text-xs text-fg-2">{t('dl.units')}</p><p className="num text-2xl font-semibold">{units}</p></div>
        <div className="rounded-2xl border border-line bg-surface p-3"><p className="text-xs text-fg-2">{t('dl.sizes_carried')}</p><p className="num text-2xl font-semibold">{inStock}</p></div>
      </div>

      <ul className="mx-4 mt-3 space-y-2">
        {rows.map(({ product: p, variant: v, qty, ownCents }) => (
          <li key={v.id}>
            <button type="button" onClick={() => setPricing({ product: p, variant: v, qty, ownCents })}
              className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface p-2.5 text-start transition active:bg-surface-2">
              <ProductImage product={p} className="size-14 shrink-0 rounded-xl bg-surface-2" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{pick(p.name, lang)}</p>
                <p className="truncate text-xs text-fg-2">
                  {p.brand} · <span className="num">{v.label}</span> · <Money iqd={unitPrice(v, 'wholesale', usd ? 'USD' : 'IQD', rate, ownCents)} currency={usd ? 'USD' : 'IQD'} rate={rate} />
                  {ownCents != null && <span className="ms-1 text-gold-text">· {t('dl.my_price_short')}</span>}
                </p>
              </div>
              <div className="text-end">
                <p className={qty <= 0 ? 'num text-xl font-bold text-danger' : qty <= LOW ? 'num text-xl font-bold text-warn-fg' : 'num text-xl font-bold'}>{Math.max(0, qty)}</p>
                <p className="flex items-center gap-1 text-[11px] text-fg-2"><Tag className="size-3" />{qty <= 0 ? t('dl.sold_out') : t('dl.in_van_short')}</p>
              </div>
            </button>
          </li>
        ))}
        {rows.length === 0 && <li className="rounded-2xl border border-dashed border-line p-6 text-center text-sm text-fg-2">{items.length ? t('dl.no_match') : t('dl.van_empty_phone')}</li>}
      </ul>

      <div className="mx-4 my-4 space-y-2">
        <Button variant="primary" size="lg" block icon={<PackagePlus className="size-5" />} onClick={() => setAdding(true)}>{t('dl.stock_up')}</Button>
        <Button variant="secondary" size="lg" block icon={<ShoppingBag className="size-5" />} onClick={() => nav('/sell')}>{t('dl.q_sale')}</Button>
      </div>

      <AddStockSheet open={adding} onClose={() => setAdding(false)} onDone={() => setAdding(false)} />
      <MyPriceSheet item={pricing} onClose={() => setPricing(null)} onDone={() => setPricing(null)} />
    </div>
  )
}
