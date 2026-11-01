import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShoppingBag } from 'lucide-react'
import { ProductImage } from '@/components/ui/Brand'
import { Button } from '@/components/ui/Button'
import { Chips } from '@/components/ui/Controls'
import { SearchInput } from '@/components/ui/Field'
import { pick, useT } from '@/i18n'
import { useUI } from '@/store/ui'
import { unitPrice } from '../field'
import { useMeta, useShop } from '../hooks'
import { Money, TopBar } from '../ui'

type Filter = 'all' | 'low' | 'men' | 'women' | 'oud'
const LOW = 2

/** What the shop has, as of the last sync — the delegate sells from it, so this is what can go on a bill. */
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
      <TopBar title={t('dl.shop_stock')} subtitle={t('dl.shop_stock_hint')}>
        <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('dl.search')} />
        <Chips className="mt-2" value={f} onChange={setF} options={(['all', 'low', 'men', 'women', 'oud'] as Filter[]).map((x) => ({ value: x, label: t(`dl.f_${x}`) }))} />
      </TopBar>

      <div className="mx-4 mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-2xl border border-line bg-surface p-3"><p className="text-xs text-fg-2">{t('dl.units')}</p><p className="num text-2xl font-semibold">{units}</p></div>
        <div className="rounded-2xl border border-line bg-surface p-3"><p className="text-xs text-fg-2">{t('dl.sizes_in_stock')}</p><p className="num text-2xl font-semibold">{inStock}</p></div>
      </div>

      <ul className="mx-4 mt-3 space-y-2">
        {rows.map(({ product: p, variant: v, qty }) => (
          <li key={v.id} className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-2.5">
            <ProductImage product={p} className="size-14 shrink-0 rounded-xl bg-surface-2" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{pick(p.name, lang)}</p>
              <p className="truncate text-xs text-fg-2">{p.brand} · <span className="num">{v.label}</span> · <Money iqd={unitPrice(v, 'wholesale', usd ? 'USD' : 'IQD', rate)} currency={usd ? 'USD' : 'IQD'} rate={rate} /></p>
            </div>
            <div className="text-end">
              <p className={qty <= 0 ? 'num text-xl font-bold text-danger' : qty <= LOW ? 'num text-xl font-bold text-warn-fg' : 'num text-xl font-bold'}>{Math.max(0, qty)}</p>
              <p className="text-[11px] text-fg-2">{qty <= 0 ? t('dl.sold_out') : t('dl.in_shop_short')}</p>
            </div>
          </li>
        ))}
        {rows.length === 0 && <li className="rounded-2xl border border-dashed border-line p-6 text-center text-sm text-fg-2">{items.length ? t('dl.no_match') : t('dl.shop_empty')}</li>}
      </ul>

      <div className="mx-4 my-4"><Button variant="primary" size="lg" block icon={<ShoppingBag className="size-5" />} onClick={() => nav('/sell')}>{t('dl.q_sale')}</Button></div>
    </div>
  )
}
