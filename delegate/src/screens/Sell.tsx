import { useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Check, CheckCircle2, ChevronRight, LocateFixed, MapPin, Plus, Printer, ShoppingBag, Store, Trash2, UserPlus, X } from 'lucide-react'
import { ProductImage } from '@/components/ui/Brand'
import { Button } from '@/components/ui/Button'
import { Badge, Chips, Segmented } from '@/components/ui/Controls'
import { Field, Input, SearchInput } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { cn } from '@/components/ui/cn'
import type { Customer, Lang, Sale } from '@/data/types'
import { pick, useT } from '@/i18n'
import { fmt, parseAmount } from '@/lib/money'
import { useUI } from '@/store/ui'
import { useSession } from '../auth'
import { addCustomer, completeSale, defaultPriceList, distanceKm, getPosition, priceDelegateCart, unitPrice, type Currency, type Position, type PriceList, type ShopItem } from '../field'
import { useAct, useCart, useCustomers, useMeta, useShop } from '../hooks'
import { fmtDollars, IQD, Money, TopBar, USD } from '../ui'

type Filter = 'all' | 'men' | 'women' | 'unisex' | 'oud'

/** The bill's currency and rate, as the shop set them (dollars unless the shop turned them off). */
function useBillMoney() {
  const cart = useCart()
  const { data: meta } = useMeta()
  const rate = meta?.settings?.currency.rate || 1460
  const usdOn = meta?.settings?.currency.usdEnabled ?? true
  const cur: Currency = usdOn ? cart.currency : 'IQD'
  const money = (iqd: number, cls?: string, big?: boolean) => <Money iqd={iqd} currency={cur} rate={rate} className={cls} big={big} />
  return { rate, usdOn, cur, money }
}

/** The bill's totals, recalculated as it changes (the last ones stay on screen meanwhile, so nothing blinks). */
function useTotals() {
  const cart = useCart()
  const { cur, rate } = useBillMoney()
  return useQuery({
    queryKey: ['dl-cart', cart.lines, cart.priceList, cart.discountPct, cart.payment, cart.paidNow, cur, rate],
    queryFn: () => priceDelegateCart(cart),
    placeholderData: keepPreviousData,
  }).data
}

/**
 * Selling, like the shop's POS: tap the perfumes (the shop's own stock, prices in dollars), check the bill, then say
 * where the sale happened — the shop, picked or added on the spot, and the phone's GPS — and how it was paid.
 */
export function SellScreen() {
  const t = useT()
  const lang = useUI((s) => s.lang)
  const cart = useCart()
  const { data: items = [] } = useShop()
  const { rate, cur, money } = useBillMoney()
  const [q, setQ] = useState('')
  const [f, setF] = useState<Filter>('all')
  const [billOpen, setBillOpen] = useState(false)
  const [checkout, setCheckout] = useState(false)
  const [done, setDone] = useState<Sale | null>(null)
  const totals = useTotals()
  const stock = useMemo(() => new Map(items.map((r) => [r.variant.id, r])), [items])
  const count = cart.lines.reduce((a, l) => a + l.qty, 0)

  // the bill drops what the shop no longer has (a sync, another sale on this phone)
  useEffect(() => {
    if (!items.length) return
    for (const l of cart.lines) {
      const left = Math.max(0, stock.get(l.variantId)?.qty ?? 0)
      if (l.qty > left) cart.setQty(l.variantId, left)
    }
  }, [items]) // eslint-disable-line react-hooks/exhaustive-deps

  const shown = items.filter(({ product: p, variant: v }) => {
    if ((f === 'men' || f === 'women' || f === 'unisex') && p.gender !== f) return false
    if (f === 'oud' && p.category !== 'oud' && !p.scentFamilies.includes('oud')) return false
    const s = q.trim().toLowerCase()
    return !s || [p.name.en, p.name.ar, p.name.ku, p.brand, v.sku, v.barcode, v.label].join(' ').toLowerCase().includes(s)
  })

  const next = () => { setBillOpen(false); setCheckout(true) }

  return (
    <div className="pb-24 lg:pb-6">
      <TopBar title={t('dl.new_sale')} subtitle={cur === 'USD' ? t('dl.rate', { rate: fmt(rate) }) : undefined} />

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start lg:gap-5 lg:px-4">
        <section aria-label={t('dl.shop_stock')}>
          <div className="space-y-2 px-4 pt-3 lg:px-0">
            <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('dl.search')} />
            <Chips value={f} onChange={setF} options={(['all', 'men', 'women', 'unisex', 'oud'] as Filter[]).map((x) => ({ value: x, label: t(`dl.f_${x}`) }))} />
          </div>
          <ul className="mt-2 grid grid-cols-2 gap-2.5 px-4 sm:grid-cols-3 lg:px-0 xl:grid-cols-4">
            {shown.map((r) => (
              <li key={r.variant.id}>
                <ProductCard item={r} inBill={cart.lines.find((l) => l.variantId === r.variant.id)?.qty ?? 0}
                  price={money(unitPrice(r.variant, cart.priceList, cur, rate), 'text-sm font-semibold text-gold-text')} onAdd={() => cart.add(r.variant.id, r.qty)} />
              </li>
            ))}
            {shown.length === 0 && (
              <li className="col-span-full rounded-2xl border border-dashed border-line p-6 text-center text-sm text-fg-2">{items.length ? t('dl.no_match') : t('dl.shop_empty')}</li>
            )}
          </ul>
        </section>

        {/* big screens: the bill stays beside the perfumes, like the POS */}
        <aside className="hidden lg:sticky lg:top-24 lg:mt-3 lg:block">
          <div className="rounded-3xl border border-line bg-surface p-4 shadow-soft">
            <h2 className="mb-3 font-serif text-lg font-semibold">{t('dl.bill')}</h2>
            <BillBody stock={stock} lang={lang} />
            {cart.lines.length > 0 && <Button variant="primary" size="xl" block className="mt-4" icon={<MapPin className="size-5" />} onClick={next}>{t('dl.next_where')}</Button>}
          </div>
        </aside>
      </div>

      {/* phones: the bill waits in a bar above the menu */}
      {cart.lines.length > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(4rem+1px+env(safe-area-inset-bottom))] z-20 px-3 pb-2 lg:hidden">
          <button type="button" onClick={() => setBillOpen(true)}
            className="mx-auto flex min-h-14 w-full max-w-xl items-center gap-3 rounded-2xl bg-gradient-to-b from-gold-light to-gold px-4 font-semibold text-ink shadow-pop active:scale-[.99]">
            <span className="num grid size-8 place-items-center rounded-full bg-ink/90 text-sm text-gold-light">{count}</span>
            <span className="flex-1 text-start">{t('dl.bill')}</span>
            {totals && <Money iqd={totals.priced.total} currency={cur} rate={rate} className="text-lg" />}
            <ChevronRight className="size-5 rtl:rotate-180" />
          </button>
        </div>
      )}

      {billOpen && (
        <Modal open onClose={() => setBillOpen(false)} title={t('dl.bill')} size="lg"
          footer={<Button variant="primary" size="xl" block icon={<MapPin className="size-5" />} disabled={!cart.lines.length} onClick={next}>{t('dl.next_where')}</Button>}>
          <BillBody stock={stock} lang={lang} />
        </Modal>
      )}
      {checkout && <CheckoutSheet onClose={() => setCheckout(false)} onDone={(s) => { setCheckout(false); setDone(s) }} />}
      {done && <ReceiptSheet sale={done} onClose={() => setDone(null)} />}
    </div>
  )
}

/** One size on the selling grid: the photo, the price on this bill, how many the shop has; a tap adds one. */
function ProductCard({ item: { product: p, variant: v, qty }, inBill, price, onAdd }: { item: ShopItem; inBill: number; price: React.ReactNode; onAdd: () => void }) {
  const t = useT()
  const lang = useUI((s) => s.lang)
  const out = qty <= 0
  return (
    <button type="button" disabled={inBill >= qty} onClick={onAdd} aria-label={`${pick(p.name, lang)} ${v.label}`}
      className={cn('relative flex h-full w-full flex-col overflow-hidden rounded-2xl border bg-surface text-start shadow-soft transition active:scale-[.98] disabled:active:scale-100',
        inBill > 0 ? 'border-gold' : 'border-line', inBill >= qty && 'opacity-60')}>
      <ProductImage product={p} className="aspect-square w-full bg-gradient-to-b from-surface-2 to-surface" />
      {inBill > 0 && <span className="num absolute end-2 top-2 grid size-8 place-items-center rounded-full bg-gold text-sm font-bold text-ink shadow">{inBill}</span>}
      <div className="flex flex-1 flex-col p-2.5">
        <p className="line-clamp-2 text-sm font-semibold leading-snug">{pick(p.name, lang)}</p>
        <p className="mt-0.5 text-xs text-fg-2"><span className="num">{v.label}</span> · {out ? <span className="font-semibold text-danger">{t('dl.sold_out')}</span> : <span className={qty <= 2 ? 'font-semibold text-warn-fg' : undefined}>{t('dl.in_shop', { n: qty })}</span>}</p>
        <div className="mt-auto flex items-center justify-between pt-1.5">{price}{!out && <Plus className="size-5 text-gold-text" />}</div>
      </div>
    </button>
  )
}

/** The lines, discount and totals — the same on the side panel and in the phone's bill sheet. */
function BillBody({ stock, lang }: { stock: Map<string, ShopItem>; lang: Lang }) {
  const t = useT()
  const actor = useSession((s) => s.actor)!
  const cart = useCart()
  const { usdOn, cur, rate, money } = useBillMoney()
  const p = useTotals()
  const setCurrency = (c: Currency) => cart.set({ currency: c, paidNow: 0 })

  if (!cart.lines.length) {
    return <p className="flex items-center gap-2 rounded-2xl bg-surface-2 p-4 text-sm text-fg-2"><ShoppingBag className="size-5 shrink-0" />{t('dl.bill_empty')}</p>
  }
  return (
    <div className="space-y-3">
      <ul className="divide-y divide-line">
        {cart.lines.map((l) => {
          const r = stock.get(l.variantId)
          if (!r) return null
          const unit = unitPrice(r.variant, cart.priceList, cur, rate)
          return (
            <li key={l.variantId} className="flex items-center gap-2.5 py-2.5">
              <ProductImage product={r.product} className="size-12 shrink-0 rounded-xl bg-surface-2" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{pick(r.product.name, lang)} <span className="num text-fg-2">{r.variant.label}</span></p>
                <p className="text-xs text-fg-2">{money(unit)} × <span className="num">{l.qty}</span> = {money(unit * l.qty, 'font-semibold text-fg')}</p>
                {l.qty >= r.qty && <p className="text-[11px] font-semibold text-warn-fg">{t('dl.max_shop', { n: r.qty })}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button type="button" aria-label={l.qty > 1 ? '−' : t('common.remove')} onClick={() => cart.setQty(l.variantId, l.qty - 1)}
                  className={cn('grid size-10 place-items-center rounded-xl bg-surface-2 text-lg font-bold', l.qty === 1 && 'text-danger')}>{l.qty > 1 ? '−' : <Trash2 className="size-4" />}</button>
                <span className="num w-7 text-center font-semibold" aria-live="polite">{l.qty}</span>
                <button type="button" aria-label="+" disabled={l.qty >= r.qty} onClick={() => cart.setQty(l.variantId, l.qty + 1)}
                  className="grid size-10 place-items-center rounded-xl bg-surface-2 text-lg font-bold disabled:opacity-35">+</button>
              </div>
            </li>
          )
        })}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{t('dl.discount')}</span>
        <div className="flex gap-1.5">
          {[0, 2, 5, 10].filter((d) => d <= actor.limits.maxDiscountPct).map((d) => (
            <button key={d} type="button" aria-pressed={cart.discountPct === d} onClick={() => cart.set({ discountPct: d })}
              className={cn('min-h-9 rounded-full border px-3 text-sm font-semibold', cart.discountPct === d ? 'border-gold bg-gold-soft text-gold-text dark:bg-gold/15' : 'border-line')}>{d}%</button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{t('dl.plist')}</span>
        <Segmented<PriceList> size="sm" value={cart.priceList} onChange={(v) => cart.set({ priceList: v })} options={[{ value: 'wholesale', label: t('dl.wholesale') }, { value: 'retail', label: t('dl.retail') }]} />
      </div>
      {usdOn && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium">{t('dl.currency')}</span>
          <Segmented<Currency> size="sm" value={cur} onChange={setCurrency} options={[{ value: 'USD', label: t('dl.cur_usd') }, { value: 'IQD', label: t('dl.cur_iqd') }]} />
        </div>
      )}

      {p && (
        <dl className="space-y-1.5 rounded-2xl bg-surface-2 p-3 text-sm">
          <div className="flex justify-between"><dt className="text-fg-2">{t('dl.subtotal')}</dt><dd>{money(p.priced.subtotal)}</dd></div>
          {p.priced.orderDiscount > 0 && <div className="flex justify-between"><dt className="text-fg-2">{t('dl.discount')} ({cart.discountPct}%)</dt><dd className="text-danger">−{money(p.priced.orderDiscount)}</dd></div>}
          {/* in dollars, a dinar or two at an odd rate is less than a cent: not worth a line */}
          {Math.abs(p.priced.rounding) >= (cur === 'USD' ? rate / 100 : 1) && <div className="flex justify-between"><dt className="text-fg-2">{t('dl.rounding')}</dt><dd>{money(p.priced.rounding)}</dd></div>}
          <div className="flex justify-between border-t border-line pt-2 text-lg font-semibold"><dt>{t('dl.total')}</dt><dd>{money(p.priced.total, undefined, true)}</dd></div>
          {cur === 'USD' && <div className="flex justify-between text-xs text-fg-2"><dt>{t('dl.in_dinars')}</dt><dd><IQD value={p.priced.total} /></dd></div>}
        </dl>
      )}
    </div>
  )
}

/**
 * "Where did you sell?" — the shop (nearest first when the phone knows where it is), or a new one added right here,
 * then how it was paid. The phone's GPS spot is saved with the sale, so the report can show it on a map.
 */
function CheckoutSheet({ onClose, onDone }: { onClose: () => void; onDone: (s: Sale) => void }) {
  const t = useT()
  const cart = useCart()
  const { data: customers = [] } = useCustomers()
  const { cur, rate, money } = useBillMoney()
  const p = useTotals()
  const [pos, setPos] = useState<Position | null | 'loading'>('loading')
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [walkIn, setWalkIn] = useState(false)
  // "paid now" is kept as typed text, so "12.5" can be typed in dollars
  const [paidText, setPaidText] = useState(() => (cart.paidNow ? String(cart.paidNow) : ''))
  const sell = useAct(completeSale)
  useEffect(() => { void getPosition(8000).then(setPos) }, [])

  const here = pos && pos !== 'loading' ? pos : null
  const customer = customers.find((c) => c.id === cart.customerId)
  const shops = useMemo(() => {
    const s = q.trim().toLowerCase()
    return customers
      .filter((c) => !s || [c.name, c.city, c.phone].join(' ').toLowerCase().includes(s))
      .map((c) => ({ c, km: here && c.lat != null && c.lng != null ? distanceKm(here, { lat: c.lat, lng: c.lng }) : null }))
      .sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity) || a.c.name.localeCompare(b.c.name))
      .slice(0, 30)
  }, [customers, q, here])

  const choose = (c: Customer) => { setWalkIn(false); cart.set({ customerId: c.id, priceList: defaultPriceList(c.type) }) }
  const chooseWalkIn = () => { setWalkIn(true); cart.set({ customerId: null, payment: 'cash' }) }
  const placeOk = !!customer || (walkIn && cart.note.trim().length > 0)
  const finish = async () => {
    const s = await sell(cart, here)
    if (s) { cart.clear(); onDone(s) }
  }

  return (
    <Modal open onClose={onClose} title={t('dl.where')} size="lg"
      footer={(
        <div className="space-y-2">
          {!placeOk && <p className="text-center text-sm text-fg-2">{walkIn ? t('dl.place_required') : t('dl.pick_shop')}</p>}
          <Button variant="primary" size="xl" block loading={sell.busy} disabled={!placeOk || !p} icon={<CheckCircle2 className="size-5" />} onClick={finish}>
            {p ? t('dl.finish', { total: cur === 'USD' ? `$${fmtDollars(p.priced.total / rate)}` : `${fmt(p.priced.total)} ${t('dl.iqd')}` }) : t('dl.complete')}
          </Button>
        </div>
      )}>
      <div className="space-y-4">
        <p tabIndex={-1} data-autofocus className={cn('flex items-center gap-2 rounded-xl p-3 text-sm outline-none', here ? 'bg-ok-bg text-ok-fg' : 'bg-surface-2 text-fg-2')}>
          <LocateFixed className="size-4 shrink-0" />
          {pos === 'loading' ? t('dl.locating') : here ? t('dl.loc_saved', { m: here.accuracyM }) : t('dl.loc_none')}
        </p>

        {customer ? (
          <div className="flex items-center gap-3 rounded-2xl border-2 border-gold bg-gold-soft/40 p-3 dark:bg-gold/10">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-gold text-ink"><Store className="size-5" /></span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{customer.name}</p>
              <p className="truncate text-xs text-fg-2">{customer.city || '—'} · {t('dl.balance')}: <IQD value={customer.balanceIQD} /></p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => cart.set({ customerId: null })}>{t('dl.change_shop')}</Button>
          </div>
        ) : adding ? (
          <NewShopForm position={here} onCancel={() => setAdding(false)} onAdded={(c) => { setAdding(false); choose(c) }} />
        ) : (
          <div className="space-y-2">
            <div className="flex gap-2">
              <div className="flex-1"><SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('dl.search_shops')} /></div>
              <Button variant="secondary" icon={<UserPlus className="size-5" />} onClick={() => setAdding(true)}>{t('dl.new_shop')}</Button>
            </div>
            <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-2xl border border-line" aria-label={t('dl.search_shops')}>
              {shops.map(({ c, km }) => (
                <li key={c.id}>
                  <button type="button" onClick={() => choose(c)} className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-start hover:bg-surface-2">
                    <Store className="size-5 shrink-0 text-gold-text" />
                    <span className="min-w-0 flex-1"><span className="block truncate font-medium">{c.name}</span><span className="block truncate text-xs text-fg-2">{c.city || '—'}{km != null && ` · ${km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} ${t('dl.km')}`}`}</span></span>
                    {c.balanceIQD > 0 && <Badge tone="warn">{t('dl.owes')}</Badge>}
                  </button>
                </li>
              ))}
              {shops.length === 0 && <li className="p-4 text-center text-sm text-fg-2">{customers.length ? t('dl.no_match') : t('dl.no_shops')}</li>}
            </ul>
            <button type="button" aria-pressed={walkIn} onClick={chooseWalkIn}
              className={cn('flex min-h-12 w-full items-center gap-2 rounded-2xl border px-3 text-sm font-medium', walkIn ? 'border-gold bg-gold-soft/40 dark:bg-gold/10' : 'border-dashed border-line text-fg-2')}>
              {walkIn ? <Check className="size-4 text-gold-text" /> : <X className="size-4" />}{t('dl.no_shop')}
            </button>
          </div>
        )}

        {(customer || walkIn) && (
          <Field label={walkIn && !customer ? t('dl.place_where') : t('dl.place_note')}>{(id) => (
            <Input id={id} value={cart.note} onChange={(e) => cart.set({ note: e.target.value })} placeholder={t('dl.place_ph')} />
          )}</Field>
        )}

        {p && (customer || walkIn) && (
          <div>
            <div className="mb-2 flex items-baseline justify-between"><p className="text-sm font-medium">{t('dl.payment')}</p><span className="text-sm">{t('dl.total')}: {money(p.priced.total, 'font-semibold')}</span></div>
            <Segmented size="md" className="w-full" value={cart.payment} onChange={(v) => cart.set({ payment: v })}
              options={[{ value: 'cash', label: t('dl.cash') }, { value: 'debt', label: t('dl.debt'), disabled: !customer }, { value: 'partial', label: t('dl.partial'), disabled: !customer }]} />
            {cart.payment === 'partial' && (
              <Field label={`${t('dl.paid_now')} (${cur === 'USD' ? '$' : t('dl.iqd')})`} className="mt-3">{(id) => (
                <Input id={id} inputMode={cur === 'USD' ? 'decimal' : 'numeric'} className="num" value={cur === 'USD' ? paidText : cart.paidNow ? fmt(cart.paidNow) : ''}
                  onChange={(e) => { setPaidText(e.target.value); cart.set({ paidNow: parseAmount(e.target.value) }) }} />
              )}</Field>
            )}
            {cart.payment !== 'cash' && customer && (
              <dl className="mt-3 space-y-1 rounded-2xl bg-surface-2 p-3 text-sm">
                <div className="flex justify-between"><dt className="text-fg-2">{t('dl.paid_now')}</dt><dd>{cur === 'USD' ? <USD value={p.paidUSD} /> : <IQD value={p.paid} />}</dd></div>
                <div className="flex justify-between"><dt className="text-fg-2">{t('dl.due')}</dt><dd><IQD value={p.due} />{cur === 'USD' && p.due > 0 && <span className="text-xs text-fg-2"> ≈ <USD value={p.due / rate} /></span>}</dd></div>
                <div className={cn('flex justify-between font-semibold', customer.balanceIQD + p.due > customer.creditLimitIQD && 'text-danger')}>
                  <dt>{t('dl.new_bal')}</dt><dd><IQD value={customer.balanceIQD + p.due} /></dd>
                </div>
              </dl>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

/** A shop met for the first time: name, area and phone — saved with the spot where the delegate is standing. */
function NewShopForm({ position, onCancel, onAdded }: { position: Position | null; onCancel: () => void; onAdded: (c: Customer) => void }) {
  const t = useT()
  const [f, setF] = useState({ name: '', city: '', phone: '' })
  const run = useAct(addCustomer, 'dl.cus_added')
  const save = async () => {
    const c = await run({ name: f.name, phone: f.phone, type: 'shop', city: f.city, notes: '', position })
    if (c) onAdded(c)
  }
  return (
    <div className="space-y-3 rounded-2xl border border-line p-3">
      <p className="flex items-center gap-2 font-semibold"><UserPlus className="size-5 text-gold-text" />{t('dl.new_shop')}</p>
      <Field label={t('dl.cus_name')}>{(id) => <Input id={id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
      <Field label={t('dl.cus_city')}>{(id) => <Input id={id} value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} />}</Field>
      <Field label={t('dl.cus_phone')}>{(id) => <Input id={id} type="tel" dir="ltr" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />}</Field>
      <div className="flex gap-2">
        <Button variant="ghost" className="flex-1" onClick={onCancel}>{t('common.cancel')}</Button>
        <Button variant="primary" className="flex-1" loading={run.busy} disabled={!f.name.trim()} onClick={save}>{t('common.save')}</Button>
      </div>
    </div>
  )
}

/** After a sale: the receipt, ready to print (any printer the phone can reach) or show the customer. */
export function ReceiptSheet({ sale, onClose }: { sale: Sale; onClose: () => void }) {
  const t = useT()
  const lang = useUI((s) => s.lang)
  const { data: meta } = useMeta()
  const { data: customers = [] } = useCustomers()
  const store = meta?.settings?.store
  const shop = customers.find((c) => c.id === sale.customerId)
  // a dollar bill is printed in dollars (what is left on account stays in dinars)
  const usd = sale.currency === 'USD' && sale.exchangeRate > 0
  const rate = sale.exchangeRate
  const amount = (iqd: number) => (usd ? `$${fmtDollars(iqd / rate)}` : fmt(iqd))
  const paidUSD = sale.payments.filter((x) => x.method === 'cash_usd').reduce((a, x) => a + x.tendered, 0)
  return (
    <Modal open onClose={onClose} title={t('dl.sale_done')} printArea
      footer={<div className="flex gap-2"><Button variant="secondary" size="lg" className="flex-1" icon={<Printer className="size-5" />} onClick={() => window.print()}>{t('dl.print')}</Button><Button variant="primary" size="lg" className="flex-1" onClick={onClose}>{t('dl.new_sale')}</Button></div>}>
      <div className="mx-auto max-w-xs space-y-2 text-sm">
        <div className="text-center">
          <p className="font-serif text-lg font-semibold">{store?.name ?? 'Lattafa'}</p>
          {store?.phone && <p className="num text-xs text-fg-2" dir="ltr">{store.phone}</p>}
          <p className="num mt-1 text-xs text-fg-2">{sale.number} · {new Date(sale.createdAt).toLocaleString()}</p>
          {(sale.customerName || sale.note) && (
            <p className="mt-1 flex items-center justify-center gap-1 text-xs"><Store className="size-3.5" />{[sale.customerName, shop?.city, sale.note].filter(Boolean).join(' · ')}</p>
          )}
        </div>
        <ul className="divide-y divide-dashed divide-line border-y border-dashed border-line">
          {sale.items.map((it) => (
            <li key={it.variantId} className="flex justify-between gap-2 py-1.5">
              <span>{pick(it.name, lang)} <span className="num">{it.label}</span> <span className="num text-fg-2">×{it.qty}</span></span>
              <span className="num">{amount(it.unitPriceIQD * it.qty)}</span>
            </li>
          ))}
        </ul>
        {sale.orderDiscountIQD > 0 && <div className="flex justify-between"><span>{t('dl.discount')}</span><span className="num">−{amount(sale.orderDiscountIQD)}</span></div>}
        {Math.abs(sale.roundingIQD) >= (usd ? rate / 100 : 1) && <div className="flex justify-between"><span>{t('dl.rounding')}</span><span className="num">{amount(sale.roundingIQD)}</span></div>}
        <div className="flex justify-between text-base font-semibold"><span>{t('dl.total')}</span>{usd ? <USD value={sale.totalIQD / rate} /> : <IQD value={sale.totalIQD} />}</div>
        <div className="flex justify-between"><span>{t('dl.paid_now')}</span><span className="num">{usd ? `$${fmtDollars(paidUSD)}` : fmt(sale.paidIQD)}</span></div>
        {sale.dueIQD > 0 && <div className="flex justify-between"><span>{t('dl.due')}</span><IQD value={sale.dueIQD} /></div>}
        {usd && <p className="num text-center text-xs text-fg-2">{t('dl.rate', { rate: fmt(rate) })}</p>}
        <p className="pt-2 text-center text-xs text-fg-2">{sale.userName} · {t('dl.app')}</p>
        <div className="flex flex-wrap justify-center gap-1.5">
          <Badge tone="gold">{t('dl.saved_offline')}</Badge>
          {sale.lat != null && <Badge tone="ok"><MapPin className="me-1 inline size-3" />{t('dl.place_saved')}</Badge>}
        </div>
      </div>
    </Modal>
  )
}
