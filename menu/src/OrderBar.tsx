import { useState } from 'react'
import { Check, Minus, Plus, ShoppingBag, X } from 'lucide-react'
import { cn } from '@/components/ui/cn'
import { useMenuT } from './i18n'
import { basket, basketItems, placeOrder, useBasket } from './order'
import type { MenuProduct } from './api'

/** "− 2 +" next to a size, on the product sheet. */
export function AddSize({ variantId, disabled }: { variantId: string; disabled?: boolean }) {
  const t = useMenuT()
  useBasket()
  const qty = basket.qtyOf(variantId)
  if (disabled) return null
  if (qty === 0) {
    return (
      <button type="button" onClick={() => basket.add(variantId)}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-2xl border border-gold/60 px-3 text-sm font-semibold text-gold-light transition hover:bg-gold/15">
        <Plus className="size-4" />{t('add')}
      </button>
    )
  }
  return (
    <div className="inline-flex min-h-11 items-center gap-1 rounded-2xl border border-gold bg-gold/15 px-1.5">
      <button type="button" aria-label={t('remove')} onClick={() => basket.add(variantId, -1)} className="grid size-9 place-items-center rounded-xl text-gold-light hover:bg-gold/20"><Minus className="size-4" /></button>
      <span className="num min-w-6 text-center text-sm font-semibold text-gold-light">{qty}</span>
      <button type="button" aria-label={t('add')} onClick={() => basket.add(variantId)} className="grid size-9 place-items-center rounded-xl text-gold-light hover:bg-gold/20"><Plus className="size-4" /></button>
    </div>
  )
}

/** The bar along the bottom once something is chosen, and the form behind it. */
export function OrderBar({ products, lang }: { products: MenuProduct[]; lang: string }) {
  const t = useMenuT()
  useBasket()
  const [open, setOpen] = useState(false)
  const [sent, setSent] = useState<number | null>(null)
  const units = basket.units()
  const items = basketItems(products)
  if (!units && sent === null) return null
  return (
    <>
      {units > 0 && !open && sent === null && (
        <div className="fixed inset-x-0 bottom-0 z-40 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button type="button" onClick={() => setOpen(true)}
            className="mx-auto flex min-h-14 w-full max-w-md items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-b from-gold-light to-gold px-5 font-semibold text-ink shadow-lg hover:brightness-105">
            <ShoppingBag className="size-5" />{t('basket_n', { n: units })}
          </button>
        </div>
      )}
      {(open || sent !== null) && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/70 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={t('basket')}>
          <div dir={lang === 'en' ? 'ltr' : 'rtl'} className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-xl sm:rounded-3xl">
            {sent !== null
              ? <Sent number={sent} onClose={() => { setSent(null); setOpen(false) }} />
              : <Form items={items} onClose={() => setOpen(false)} onSent={setSent} />}
          </div>
        </div>
      )}
    </>
  )
}

function Sent({ number, onClose }: { number: number; onClose: () => void }) {
  const t = useMenuT()
  return (
    <div className="py-4 text-center">
      <span className="mx-auto mb-3 grid size-14 place-items-center rounded-full bg-gold/20 text-gold-light"><Check className="size-7" /></span>
      <h2 className="font-serif text-2xl font-semibold">{t('sent_title')}</h2>
      <p className="mt-2 text-sm text-fg-2">{t('sent_body', { n: number })}</p>
      <button type="button" onClick={onClose} className="mt-5 min-h-12 w-full rounded-2xl bg-gradient-to-b from-gold-light to-gold font-semibold text-ink">{t('sent_done')}</button>
    </div>
  )
}

function Form({ items, onClose, onSent }: { items: ReturnType<typeof basketItems>; onClose: () => void; onSent: (n: number) => void }) {
  const t = useMenuT()
  const [shopName, setShopName] = useState('')
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const field = 'mt-1 min-h-12 w-full rounded-2xl border border-line bg-surface-2 px-3.5 text-base outline-none focus:border-gold'

  const send = async () => {
    if (shopName.trim().length < 2) return setError(t('need_name'))
    if (phone.replace(/\D/g, '').length < 6) return setError(t('need_phone'))
    setBusy(true); setError('')
    try {
      onSent(await placeOrder({ shopName, phone, note }))
    } catch (e) {
      const m = e instanceof Error ? e.message : ''
      setError(t(m === 'busy' ? 'order_busy' : m === 'gone' ? 'order_gone' : 'order_failed'))
    } finally { setBusy(false) }
  }

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-serif text-xl font-semibold">{t('basket')}</h2>
        <button type="button" aria-label={t('close')} onClick={onClose} className="grid size-10 place-items-center rounded-xl text-fg-2 hover:bg-surface-2"><X className="size-5" /></button>
      </div>

      {items.length === 0 ? <p className="py-6 text-center text-sm text-fg-2">{t('empty_basket')}</p> : (
        <ul className="mb-4 divide-y divide-line rounded-2xl border border-line">
          {items.map(({ product, size, qty }) => (
            <li key={size.id} className="flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{product.name.en || product.name.ar}</p>
                <p className="num text-xs text-fg-2">{size.label}</p>
              </div>
              <div className="inline-flex items-center gap-1">
                <button type="button" aria-label={t('remove')} onClick={() => basket.add(size.id, -1)} className="grid size-9 place-items-center rounded-xl bg-surface-2"><Minus className="size-4" /></button>
                <span className="num min-w-7 text-center text-sm font-semibold">{qty}</span>
                <button type="button" aria-label={t('add')} onClick={() => basket.add(size.id)} className="grid size-9 place-items-center rounded-xl bg-surface-2"><Plus className="size-4" /></button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <label className="block text-sm font-medium">{t('shop_name')}
        <input className={field} value={shopName} onChange={(e) => setShopName(e.target.value)} placeholder={t('shop_name_ph')} autoComplete="organization" />
      </label>
      <label className="mt-3 block text-sm font-medium">{t('your_phone')}
        <input className={cn(field, 'num')} dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t('your_phone_ph')} autoComplete="tel" />
      </label>
      <label className="mt-3 block text-sm font-medium">{t('order_note')}
        <textarea className={cn(field, 'min-h-20 py-2.5')} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('order_note_ph')} rows={2} />
      </label>

      {error && <p role="alert" className="mt-3 rounded-xl bg-danger-bg px-3 py-2.5 text-sm text-danger-fg">{error}</p>}
      <button type="button" disabled={busy || items.length === 0} onClick={() => void send()}
        className="mt-4 min-h-14 w-full rounded-2xl bg-gradient-to-b from-gold-light to-gold font-semibold text-ink disabled:opacity-60">
        {t('send_order')}
      </button>
    </>
  )
}
