import { useMemo, useState } from 'react'
import { PackagePlus, Search, Tag } from 'lucide-react'
import { ProductImage } from '@/components/ui/Brand'
import { Button } from '@/components/ui/Button'
import { Input, SearchInput } from '@/components/ui/Field'
import { pick, useT } from '@/i18n'
import { useUI } from '@/store/ui'
import { ddb } from '../data'
import { addStock, setMyPrice } from '../field'
import { useAct, useMeta } from '../hooks'
import { Modal } from '@/components/ui/Modal'
import type { Product, Variant } from '@/data/types'

/**
 * Stocking up, and pricing what you carry.
 *
 * Adding stock works with no signal: the van goes up straight away and the movement is queued like a sale.
 * Setting a price does not, because the next sync replaces the phone's prices with the server's — a price typed
 * on a dead connection would quietly vanish, so the delegate is told to try again instead.
 */
export function AddStockSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const t = useT()
  const lang = useUI((s) => s.lang)
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<{ variant: Variant; product: Product } | null>(null)
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')
  const [all, setAll] = useState<{ variant: Variant; product: Product }[]>([])

  // the whole shop catalogue, because a delegate stocks up on things they are not carrying yet
  const load = async () => {
    if (all.length) return
    const [products, variants] = await Promise.all([ddb.products.toArray(), ddb.variants.toArray()])
    const pm = new Map(products.filter((p) => p.active).map((p) => [p.id, p]))
    setAll(variants.filter((v) => v.active && !v.isTester && pm.has(v.productId)).map((v) => ({ variant: v, product: pm.get(v.productId)! })))
  }

  const hits = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return []
    return all.filter(({ product: p, variant: v }) =>
      [p.name.en, p.name.ar, p.name.ku, p.brand, v.sku, v.barcode, v.label].some((x) => x?.toLowerCase().includes(s))).slice(0, 8)
  }, [all, q])

  const save = useAct(async () => {
    if (!picked) return
    await addStock(picked.variant.id, Number(qty), note)
    setPicked(null); setQty(''); setNote(''); setQ('')
    onDone()
    onClose()
  }, t('dl.stock_added'))

  return (
    <Modal open={open} onClose={onClose} title={t('dl.stock_up')} size="lg">
      <div className="space-y-3" onFocus={() => void load()}>
        <p className="text-sm text-fg-2">{t('dl.stock_up_hint')}</p>

        {!picked ? (
          <>
            <SearchInput value={q} onChange={(e) => { setQ(e.target.value); void load() }} placeholder={t('dl.search')} autoFocus />
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
              {hits.map(({ product: p, variant: v }) => (
                <li key={v.id}>
                  <button type="button" onClick={() => setPicked({ variant: v, product: p })}
                    className="flex w-full items-center gap-3 p-2.5 text-start transition active:bg-surface-2">
                    <ProductImage product={p} className="size-11 shrink-0 rounded-xl bg-surface-2" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{pick(p.name, lang)}</span>
                      <span className="num block truncate text-xs text-fg-2">{p.brand} · {v.label} · {v.sku}</span>
                    </span>
                  </button>
                </li>
              ))}
              {q.trim() && !hits.length && <li className="p-5 text-center text-sm text-fg-2">{t('dl.no_match')}</li>}
              {!q.trim() && <li className="flex items-center justify-center gap-2 p-5 text-center text-sm text-fg-2"><Search className="size-4" />{t('dl.search_to_add')}</li>}
            </ul>
          </>
        ) : (
          <>
            <div className="flex items-center gap-3 rounded-2xl border border-gold bg-surface p-2.5">
              <ProductImage product={picked.product} className="size-12 shrink-0 rounded-xl bg-surface-2" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{pick(picked.product.name, lang)}</p>
                <p className="num truncate text-xs text-fg-2">{picked.variant.label}</p>
              </div>
              <Button variant="ghost" onClick={() => setPicked(null)}>{t('dl.change')}</Button>
            </div>

            <Input type="number" inputMode="numeric" min={1} value={qty} onChange={(e) => setQty(e.target.value)}
              aria-label={t('dl.how_many')} placeholder={t('dl.how_many')} autoFocus big />
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('dl.where_from')} aria-label={t('dl.where_from')} />

            <Button variant="primary" size="lg" block icon={<PackagePlus className="size-5" />}
              disabled={!(Number(qty) > 0) || save.busy} onClick={() => void save()}>
              {t('dl.add_to_van', { n: Math.max(0, Math.trunc(Number(qty) || 0)) })}
            </Button>
          </>
        )}
      </div>
    </Modal>
  )
}

/** Setting what this delegate charges for one size. Blank goes back to the shop's own dollar price. */
export function MyPriceSheet({ item, onClose, onDone }: {
  item: { variant: Variant; product: Product; ownCents: number | null } | null
  onClose: () => void
  onDone: () => void
}) {
  const t = useT()
  const lang = useUI((s) => s.lang)
  const { data: meta } = useMeta()
  const [text, setText] = useState(item?.ownCents != null ? (item.ownCents / 100).toFixed(2) : '')

  const shopCents = item?.variant.wholesaleUSDCents ?? 0
  const save = useAct(async () => {
    if (!item) return
    const clean = text.replace(/[^\d.]/g, '')
    await setMyPrice(item.variant.id, clean === '' ? null : Math.round(Number(clean) * 100))
    onDone()
    onClose()
  }, t('dl.price_saved'))

  if (!item) return null

  return (
    <Modal open onClose={onClose} title={pick(item.product.name, lang)} size="lg">
      <div className="space-y-3">
        <p className="text-sm text-fg-2">{t('dl.my_price_hint')}</p>

        <Input type="text" inputMode="decimal" dir="ltr" value={text} onChange={(e) => setText(e.target.value)}
          aria-label={t('dl.my_price')} placeholder={shopCents > 0 ? (shopCents / 100).toFixed(2) : '0.00'} big />

        <p className="num text-xs text-fg-2">
          {shopCents > 0
            ? t('dl.shop_price_is', { amount: `$${(shopCents / 100).toFixed(2)}` })
            : t('dl.shop_has_no_price', { rate: String(meta?.settings?.currency.rate ?? 1460) })}
        </p>

        <Button variant="primary" size="lg" block icon={<Tag className="size-5" />} disabled={save.busy} onClick={() => void save()}>
          {text.trim() === '' ? t('dl.use_shop_price') : t('common.save')}
        </Button>
      </div>
    </Modal>
  )
}
