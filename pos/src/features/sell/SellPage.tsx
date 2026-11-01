import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, RefreshCcw, ShoppingCart, SlidersHorizontal, Wallet } from 'lucide-react'
import { Amt } from '@/components/ui/Amt'
import { Button } from '@/components/ui/Button'
import { Badge, Chips, EmptyState, Spinner, Switch } from '@/components/ui/Controls'
import { Field, SearchInput, Select } from '@/components/ui/Field'
import { Modal, useConfirm } from '@/components/ui/Modal'
import { cn } from '@/components/ui/cn'
import { useApproval } from '@/components/ApprovalProvider'
import { pick, useT } from '@/i18n'
import type { Hold, Sale } from '@/data/types'
import { priceCart, type OrderDiscount } from '@/lib/pricing'
import { hasPerm } from '@/lib/permissions'
import { findByBarcode, type CatalogVariant } from '@/services/catalog'
import { deleteHold, holdCart } from '@/services/holds'
import { markTester } from '@/services/stock'
import { useAction, useCatalog, useHolds, useMyShift, useSettings } from '@/hooks/queries'
import { useActor, useCan } from '@/hooks/useAuth'
import { useDevice } from '@/hooks/useDevice'
import { useScanner } from '@/hooks/useScanner'
import { useCart } from '@/store/cart'
import { useUI } from '@/store/ui'
import { toast } from '@/store/toast'
import { fmtTime } from '@/lib/date'
import { bidiSize } from '@/lib/size'
import { CartPanel } from './CartPanel'
import { CameraScanner, cameraScanSupported } from './CameraScanner'
import { CustomerPicker, DiscountModal, HoldsModal, NoteModal } from './Dialogs'
import { PaymentModal } from './PaymentModal'
import { ProductGrid } from './ProductGrid'
import { ReceiptModal } from './Receipt'
import { CATEGORY_CHIPS, matchesCategory, matchesQuery, type CategoryChip } from './helpers'
import { useCartPricing } from './useCartPricing'

export function SellPage() {
  const t = useT()
  const navigate = useNavigate()
  const lang = useUI((s) => s.lang)
  const device = useDevice()
  const actor = useActor()
  const confirm = useConfirm()
  const ask = useApproval()
  const cart = useCart()
  const pricing = useCartPricing()
  const { data: catalog = [], isLoading } = useCatalog()
  // a bottle on the open bill can disappear from sale (removed on the server, synced in) — take it off the bill
  useEffect(() => {
    if (isLoading) return
    const dropped = useCart.getState().prune(new Set(catalog.flatMap((c) => c.variants.map((v) => v.id))))
    if (dropped) toast.error(t('err.product_unavailable'))
  }, [catalog, isLoading]) // eslint-disable-line react-hooks/exhaustive-deps
  const { data: settings } = useSettings()
  const { data: shift, isLoading: shiftLoading } = useMyShift()
  const { data: holds = [] } = useHolds()
  const canTester = useCan('pos.tester')

  const [cat, setCat] = useState<CategoryChip>('all')
  const [q, setQ] = useState('')
  const [brand, setBrand] = useState('')
  const [family, setFamily] = useState('')
  const [inStock, setInStock] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [cartOpen, setCartOpen] = useState(false)
  const [payOpen, setPayOpen] = useState(false)
  const [custOpen, setCustOpen] = useState(false)
  const [holdsOpen, setHoldsOpen] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const [discount, setDiscount] = useState<{ kind: 'line'; variantId: string } | { kind: 'order' } | null>(null)
  const [receipt, setReceipt] = useState<Sale | null>(null)

  const allowNeg = settings?.sales.allowNegativeStock ?? false
  const inCart = useMemo(() => Object.fromEntries(cart.lines.map((l) => [l.variantId, l.qty])), [cart.lines])
  const brands = useMemo(() => [...new Set(catalog.map((c) => c.product.brand))].sort(), [catalog])
  const families = useMemo(() => [...new Set(catalog.flatMap((c) => c.product.scentFamilies))].sort(), [catalog])

  const items = useMemo(
    () =>
      catalog.filter(
        (c) =>
          matchesCategory(c.product, cat) &&
          (!brand || c.product.brand === brand) &&
          (!family || c.product.scentFamilies.includes(family)) &&
          (!inStock || c.variants.some((v) => v.stock > 0)) &&
          matchesQuery(c.product, c.variants, q),
      ),
    [catalog, cat, brand, family, inStock, q],
  )

  /* ───── adding things to the bill ───── */
  const addVariant = useCallback((v: CatalogVariant) => {
    const have = useCart.getState().lines.find((l) => l.variantId === v.id)?.qty ?? 0
    if (!allowNeg && have + 1 > v.stock) { toast.error(t('sell.only_n_left', { n: v.stock })); return }
    useCart.getState().add(v.id)
  }, [allowNeg, t])

  const handleCode = useCallback(async (code: string) => {
    const hit = await findByBarcode(code)
    if (!hit) { toast.error(t('sell.barcode_not_found', { code })); return false }
    addVariant(hit.variant)
    toast.success(`${pick(hit.product.name, useUI.getState().lang)} ${bidiSize(hit.variant.label)}`)
    return true
  }, [addVariant, t])

  useScanner((code) => { void handleCode(code) }, { enabled: !!shift || !settings?.sales.requireShift })

  const onSearchEnter = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || !q.trim()) return
    // exact barcode/SKU typed by hand → straight into the bill
    const ok = await findByBarcode(q)
    if (ok) { addVariant(ok.variant); setQ(''); return }
    if (items.length === 1 && items[0].variants.length === 1) { addVariant(items[0].variants[0]); setQ('') }
  }

  /* ───── discounts (with supervisor approval when above the user's limit) ───── */
  const limit = actor?.limits.maxDiscountPct ?? 0
  const canExceed = !!actor && hasPerm(actor.permissions, 'sales.discount.above_limit')
  const effective = (line?: { variantId: string; pct: number }, order?: OrderDiscount | null) =>
    priceCart({
      lines: pricing.lines.map((l) => ({ key: l.variantId, unitPriceIQD: l.unit, qty: l.qty, discountPct: line?.variantId === l.variantId ? line.pct : l.discountPct })),
      orderDiscount: order === undefined ? cart.orderDiscount : order,
      rounding: 0,
    }).effectiveDiscountPct

  const approveIfNeeded = async (pct: number): Promise<boolean> => {
    if (pct <= limit + 1e-9 || canExceed) return true
    const who = await ask('sales.discount.above_limit', t('sell.needs_approval', { n: limit }))
    if (!who) return false
    cart.setApprovedBy(who)
    return true
  }

  const applyDiscount = async (d: OrderDiscount | null) => {
    if (!discount) return
    if (discount.kind === 'line') {
      const pct = d?.type === 'pct' ? d.value : 0
      if (!(await approveIfNeeded(effective({ variantId: discount.variantId, pct })))) return
      cart.setLineDiscount(discount.variantId, pct)
    } else {
      if (!(await approveIfNeeded(effective(undefined, d)))) return
      cart.setOrderDiscount(d)
    }
  }

  /* ───── hold / resume / clear ───── */
  const doHold = useAction(holdCart, { success: 'sell.held_ok' })
  const doDeleteHold = useAction(deleteHold)
  const doTester = useAction(markTester, { success: 'sell.tester_ok' })

  const snapshot = () => ({ lines: cart.lines, customerId: cart.customerId, orderDiscount: cart.orderDiscount, giftWrap: cart.giftWrap, note: cart.note })
  const hold = async () => {
    const label = pricing.customer?.name || `${t('sell.held_bill')} ${fmtTime(Date.now())}`
    if (await doHold({ ...snapshot(), label })) { cart.clear(); setCartOpen(false) }
  }
  const resume = async (h: Hold) => {
    if (cart.lines.length) await doHold({ ...snapshot(), label: pricing.customer?.name || `${t('sell.held_bill')} ${fmtTime(Date.now())}` }) // swap: park the current bill first
    cart.load({ lines: h.lines, customerId: h.customerId, orderDiscount: h.orderDiscount, giftWrap: h.giftWrap, note: h.note })
    await doDeleteHold(h.id)
    setHoldsOpen(false)
  }
  const clear = async () => {
    if (await confirm({ title: t('sell.clear_title'), message: t('sell.clear_msg'), confirmLabel: t('sell.clear'), danger: true })) cart.clear()
  }
  const holdTotal = (h: Hold) =>
    priceCart({
      lines: h.lines.flatMap((l) => { const r = pricing.index.get(l.variantId); return r ? [{ key: l.variantId, unitPriceIQD: r.variant.retailIQD, qty: l.qty, discountPct: l.discountPct }] : [] }),
      orderDiscount: h.orderDiscount, giftWrapIQD: h.giftWrap ? settings?.sales.giftWrapFeeIQD : 0, taxPct: settings?.tax.pct, rounding: settings?.currency.rounding,
    }).total
  const nameOf = (id: string) => { const r = pricing.index.get(id); return r ? pick(r.product.name, lang) : '?' }

  const askTester = async (v: CatalogVariant) => {
    const r = pricing.index.get(v.id)
    if (await confirm({ title: t('sell.tester_title'), message: t('sell.tester_msg', { name: r ? pick(r.product.name, lang) : v.sku, size: bidiSize(v.label) }), confirmLabel: t('sell.mark_tester') })) await doTester(v.id, 1, 'tester')
  }

  const paid = (sale: Sale) => { cart.clear(); setPayOpen(false); setCartOpen(false); setReceipt(sale) }

  /* ───── gates ───── */
  if (isLoading || shiftLoading) return <div className="grid h-full place-items-center"><Spinner className="size-10" /></div>
  if (settings?.sales.requireShift && !shift) {
    return (
      <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
        <span className="grid size-20 place-items-center rounded-full bg-gold-soft text-gold-dark dark:bg-gold/20"><Wallet className="size-9" /></span>
        <h1 className="font-serif text-2xl font-semibold">{t('sell.shift_required')}</h1>
        <p className="text-sm text-fg-2">{t('sell.shift_required_hint')}</p>
        <Button variant="primary" size="xl" onClick={() => navigate('/shift')}>{t('shift.open_action')}</Button>
      </div>
    )
  }

  const activeFilters = [brand, family, inStock].filter(Boolean).length
  const persistentCart = device === 'desktop'
  const cartPanel = (onClose?: () => void) => (
    <CartPanel
      pricing={pricing} holdCount={holds.length} className="h-full"
      onPay={() => setPayOpen(true)} onHold={hold} onHolds={() => setHoldsOpen(true)} onClear={clear}
      onCustomer={() => setCustOpen(true)} onLineDiscount={(variantId) => setDiscount({ kind: 'line', variantId })}
      onOrderDiscount={() => setDiscount({ kind: 'order' })} onNote={() => setNoteOpen(true)} onClose={onClose}
    />
  )

  return (
    <div className={cn('h-full', persistentCart && 'grid grid-cols-[minmax(0,1fr)_25rem] xl:grid-cols-[minmax(0,1fr)_27rem]')}>
      <div className="flex h-full min-h-0 min-w-0 flex-col">
        <div className="shrink-0 space-y-2.5 px-3 pb-2 pt-3 md:px-4 md:pt-4">
          <div className="flex gap-2">
            <SearchInput big={device !== 'phone'} className="flex-1" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onSearchEnter} placeholder={t('sell.search_ph')} aria-label={t('sell.search_ph')} data-scan-target="true" />
            {cameraScanSupported() && <Button variant="dark" className={cn('w-14 px-0', device !== 'phone' ? 'h-14' : 'h-11')} aria-label={t('scan.title')} onClick={() => setScanOpen(true)}><Camera className="size-6" /></Button>}
            <Button variant="secondary" className={cn('relative', device !== 'phone' ? 'h-14 w-14 px-0' : 'h-11 w-11 px-0')} aria-label={t('sell.filters')} onClick={() => setFiltersOpen(true)}>
              <SlidersHorizontal className="size-5" />
              {activeFilters > 0 && <span className="num absolute -end-1 -top-1 grid size-5 place-items-center rounded-full bg-gold text-[11px] font-bold text-ink">{activeFilters}</span>}
            </Button>
          </div>
          <Chips value={cat} onChange={setCat} options={CATEGORY_CHIPS.map((c) => ({ value: c, label: t(`cat.${c}`) }))} />
          {cart.returnCredit && (
            <div className="flex items-center justify-between gap-3 rounded-xl bg-gold-soft px-3.5 py-2.5 text-sm dark:bg-gold/15">
              <span className="flex items-center gap-2 font-medium"><RefreshCcw className="size-4 text-gold-dark" />{t('sell.exchange_credit')}: <Amt n={cart.returnCredit.amountIQD} className="font-bold" /></span>
              <button type="button" onClick={() => cart.setReturnCredit(null)} className="text-xs font-semibold text-danger">{t('common.remove')}</button>
            </div>
          )}
        </div>
        <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3 md:px-4', !persistentCart && cart.lines.length > 0 && 'pb-24')}>
          {catalog.length === 0 ? <EmptyState title={t('sell.empty_catalog')} hint={t('sell.empty_catalog_hint')} /> : <ProductGrid items={items} lang={lang} inCart={inCart} onAdd={addVariant} onTester={canTester ? askTester : undefined} allowNegative={allowNeg} />}
        </div>
      </div>

      {persistentCart && <div className="min-h-0 border-s border-line">{cartPanel()}</div>}

      {!persistentCart && (
        <>
          {cart.lines.length > 0 && (
            <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] max-md:bottom-[calc(4rem+env(safe-area-inset-bottom))] max-md:pb-3">
              <button type="button" onClick={() => setCartOpen(true)} className="pointer-events-auto mx-auto flex h-16 w-full max-w-xl items-center gap-3 rounded-2xl bg-gradient-to-b from-gold to-gold-dark px-4 text-ink shadow-[0_12px_30px_rgba(184,137,47,.45)] transition active:scale-[.99]">
                <span className="relative grid size-11 place-items-center rounded-xl bg-ink/10"><ShoppingCart className="size-6" /><span className="num absolute -end-1 -top-1 grid size-5 place-items-center rounded-full bg-ink text-[11px] font-bold text-gold">{pricing.units}</span></span>
                <span className="flex-1 text-start text-sm font-semibold">{t('sell.view_cart')}</span>
                <Amt n={pricing.priced.total} className="text-lg font-bold" />
              </button>
            </div>
          )}
          <Modal open={cartOpen} onClose={() => setCartOpen(false)} side={device === 'tablet'} bodyClassName="p-0 overflow-hidden" className={device === 'tablet' ? 'h-dvh' : 'h-[92dvh]'}>
            {cartPanel(() => setCartOpen(false))}
          </Modal>
        </>
      )}

      <PaymentModal open={payOpen} onClose={() => setPayOpen(false)} pricing={pricing} onDone={paid} />
      <ReceiptModal sale={receipt} onClose={() => setReceipt(null)} />
      <CustomerPicker open={custOpen} onClose={() => setCustOpen(false)} selectedId={cart.customerId} onPick={(id) => cart.setCustomer(id)} />
      <HoldsModal open={holdsOpen} onClose={() => setHoldsOpen(false)} holds={holds} nameOf={nameOf} totalOf={holdTotal} onResume={resume} onDelete={(h) => void doDeleteHold(h.id)} />
      <NoteModal open={noteOpen} onClose={() => setNoteOpen(false)} />
      <CameraScanner open={scanOpen} onClose={() => setScanOpen(false)} onScan={async (code) => { if (await handleCode(code)) setScanOpen(false) }} />
      <DiscountModal
        open={!!discount}
        onClose={() => setDiscount(null)}
        title={discount?.kind === 'line' ? t('sell.line_discount') : t('sell.order_discount')}
        initial={discount?.kind === 'line' ? (() => { const l = cart.lines.find((x) => x.variantId === discount.variantId); return l && l.discountPct ? { type: 'pct' as const, value: l.discountPct } : null })() : cart.orderDiscount}
        allowFixed={discount?.kind === 'order'}
        limitPct={limit}
        canExceed={canExceed}
        onApply={applyDiscount}
      />
      <Modal open={filtersOpen} onClose={() => setFiltersOpen(false)} title={t('sell.filters')} size="sm" footer={<div className="flex gap-2"><Button size="lg" variant="secondary" className="flex-1" onClick={() => { setBrand(''); setFamily(''); setInStock(false) }}>{t('common.reset')}</Button><Button size="lg" variant="primary" className="flex-1" onClick={() => setFiltersOpen(false)}>{t('common.done')}</Button></div>}>
        <div className="space-y-4">
          <Field label={t('prod.brand')}>{(id) => <Select id={id} value={brand} onChange={(e) => setBrand(e.target.value)}><option value="">{t('common.all')}</option>{brands.map((b) => <option key={b}>{b}</option>)}</Select>}</Field>
          <Field label={t('prod.scent_family')}>{(id) => <Select id={id} value={family} onChange={(e) => setFamily(e.target.value)}><option value="">{t('common.all')}</option>{families.map((f) => <option key={f} value={f}>{t(`family.${f}`)}</option>)}</Select>}</Field>
          <div className="flex items-center justify-between rounded-xl bg-surface-2 p-3.5"><span className="text-sm font-medium">{t('sell.in_stock_only')}</span><Switch checked={inStock} onChange={setInStock} label={t('sell.in_stock_only')} /></div>
          <Badge tone="neutral"><span className="num">{items.length}</span> {t('sell.results')}</Badge>
        </div>
      </Modal>
    </div>
  )
}
