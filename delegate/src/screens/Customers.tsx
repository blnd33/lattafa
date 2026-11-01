import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { HandCoins, LocateFixed, MapPin, Navigation, Phone, ShoppingBag, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Badge, Chips, Segmented } from '@/components/ui/Controls'
import { Field, Input, SearchInput, Select, Textarea } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import type { Customer, CustomerType, PaymentMethod } from '@/data/types'
import { useT } from '@/i18n'
import { fmt, parseAmount } from '@/lib/money'
import { addCustomer, checkIn, collect, defaultPriceList, distanceKm, getPosition, type Position } from '../field'
import type { VisitOutcome } from '../data'
import { useAct, useCart, useCustomers, useMeta } from '../hooks'
import { fmtDollars, IQD, TopBar, USD } from '../ui'

type View = 'all' | 'owing' | 'near'
const status = (c: Customer) => (c.balanceIQD <= 0 ? 'settled' : c.balanceIQD > c.creditLimitIQD ? 'over' : 'owes')

export function CustomersScreen() {
  const t = useT()
  const [params, setParams] = useSearchParams()
  const { data: customers = [] } = useCustomers()
  const [q, setQ] = useState('')
  const [view, setView] = useState<View>(params.get('owing') ? 'owing' : 'all')
  const [pos, setPos] = useState<Position | null>(null)
  const [adding, setAdding] = useState(false)
  const openId = params.get('id')
  const open = customers.find((c) => c.id === openId)

  useEffect(() => { if (view === 'near' && !pos) void getPosition(8000).then(setPos) }, [view, pos])

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return customers
      .filter((c) => (view !== 'owing' || c.balanceIQD > 0) && (!s || [c.name, c.phone, c.city].join(' ').toLowerCase().includes(s)))
      .map((c) => ({ c, km: pos && c.lat != null && c.lng != null ? distanceKm(pos, { lat: c.lat, lng: c.lng }) : null }))
      .sort((a, b) => (view === 'near' ? (a.km ?? Infinity) - (b.km ?? Infinity) : view === 'owing' ? b.c.balanceIQD - a.c.balanceIQD : 0))
  }, [customers, q, view, pos])

  return (
    <div>
      <TopBar title={t('dl.customers')}>
        <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('dl.search_customers')} />
        <Chips className="mt-2" value={view} onChange={setView} options={[{ value: 'all', label: t('dl.f_all') }, { value: 'owing', label: t('dl.owing') }, { value: 'near', label: t('dl.nearest') }]} />
      </TopBar>
      {view === 'near' && !pos && <p className="mx-4 mt-3 flex items-center gap-2 text-sm text-fg-2"><LocateFixed className="size-4" />{t('dl.locating')}</p>}
      <ul className="mx-4 mt-3 divide-y divide-line overflow-hidden rounded-3xl border border-line bg-surface">
        {rows.map(({ c, km }) => (
          <li key={c.id}>
            <button type="button" onClick={() => setParams({ id: c.id })} className="flex w-full items-center gap-3 p-3.5 text-start">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{c.name}</p>
                <p className="truncate text-xs text-fg-2">{[c.city, c.phone].filter(Boolean).join(' · ') || '—'}{km != null && ` · ${km.toFixed(1)} ${t('dl.km')}`}</p>
              </div>
              {status(c) === 'settled' ? <Badge tone="ok">{t('dl.settled')}</Badge> : (
                <span className="text-end"><Badge tone={status(c) === 'over' ? 'danger' : 'warn'}>{status(c) === 'over' ? t('dl.over') : t('dl.owes')}</Badge><br /><IQD value={c.balanceIQD} className="text-sm font-semibold" /></span>
              )}
            </button>
          </li>
        ))}
        {rows.length === 0 && <li className="p-6 text-center text-sm text-fg-2">{t('dl.no_customers')}</li>}
      </ul>
      <div className="mx-4 mt-4"><Button variant="secondary" size="lg" block icon={<UserPlus className="size-5" />} onClick={() => setAdding(true)}>{t('dl.add_cus')}</Button></div>
      {open && <CustomerSheet customer={open} onClose={() => setParams({})} />}
      {adding && <AddCustomerSheet onClose={() => setAdding(false)} />}
    </div>
  )
}

function CustomerSheet({ customer: c, onClose }: { customer: Customer; onClose: () => void }) {
  const t = useT()
  const nav = useNavigate()
  const cart = useCart()
  const [mode, setMode] = useState<'info' | 'collect' | 'visit'>('info')
  const directions = c.lat != null && c.lng != null ? `https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}` : null
  const sellHere = () => { cart.set({ customerId: c.id, priceList: defaultPriceList(c.type) }); nav('/sell') }
  return (
    <Modal open onClose={onClose} title={c.name}>
      {mode === 'info' && (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-2xl bg-surface-2 p-3"><dt className="text-xs text-fg-2">{t('dl.balance')}</dt><dd><IQD value={c.balanceIQD} className="text-lg font-semibold" /></dd></div>
            <div className="rounded-2xl bg-surface-2 p-3"><dt className="text-xs text-fg-2">{t('dl.limit')}</dt><dd><IQD value={c.creditLimitIQD} className="text-lg font-semibold" /></dd></div>
          </dl>
          <p className="text-sm text-fg-2">{t(`cust.type_${c.type}`)}{c.city ? ` · ${c.city}` : ''}{c.notes ? ` · ${c.notes}` : ''}</p>
          <div className="grid grid-cols-2 gap-2">
            {c.phone && <a href={`tel:${c.phone.replace(/\s/g, '')}`} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-surface-2 font-semibold"><Phone className="size-5" />{t('dl.call')}</a>}
            {directions && <a href={directions} target="_blank" rel="noopener noreferrer" className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-surface-2 font-semibold"><Navigation className="size-5" />{t('dl.directions')}</a>}
          </div>
          <div className="grid gap-2">
            <Button variant="primary" size="lg" icon={<ShoppingBag className="size-5" />} onClick={sellHere}>{t('dl.q_sale')}</Button>
            <Button variant="secondary" size="lg" icon={<HandCoins className="size-5" />} disabled={c.balanceIQD <= 0} onClick={() => setMode('collect')}>{t('dl.q_collect')}</Button>
            <Button variant="secondary" size="lg" icon={<MapPin className="size-5" />} onClick={() => setMode('visit')}>{t('dl.q_visit')}</Button>
          </div>
        </div>
      )}
      {mode === 'collect' && <CollectForm customer={c} onDone={onClose} />}
      {mode === 'visit' && <VisitForm customerId={c.id} onDone={onClose} />}
    </Modal>
  )
}

function CollectForm({ customer: c, onDone }: { customer: Customer; onDone: () => void }) {
  const t = useT()
  const { data: meta } = useMeta()
  const rate = meta?.settings?.currency.rate || 1460
  const usdOn = meta?.settings?.currency.usdEnabled ?? true
  // start in the currency the delegate sells in (dollars, unless they switched the bill to dinars)
  const preferUSD = useCart((s) => s.currency) === 'USD' && usdOn
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod>(preferUSD ? 'cash_usd' : 'cash_iqd')
  const [note, setNote] = useState('')
  const run = useAct(collect, 'dl.collected_ok')
  const usd = method === 'cash_usd'
  const value = parseAmount(amount)
  const methods: PaymentMethod[] = usdOn ? ['cash_usd', 'cash_iqd', 'fib', 'zain'] : ['cash_iqd', 'fib', 'zain']
  // quick amounts: the whole debt and half of it, in the chosen currency
  const quick = usd
    ? [c.balanceIQD / rate, c.balanceIQD / rate / 2].map((v) => Math.round(v * 100) / 100)
    : [c.balanceIQD, Math.round(c.balanceIQD / 2)]
  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-2">{t('dl.balance')}: <IQD value={c.balanceIQD} className="font-semibold text-fg" />{usdOn && c.balanceIQD > 0 && <> ≈ <USD value={c.balanceIQD / rate} /></>}</p>
      <Segmented value={method} onChange={(m) => { setMethod(m); setAmount('') }} options={methods.map((m) => ({ value: m, label: t(`method.${m}`) }))} />
      <Field label={`${t('dl.amount')} (${usd ? '$' : t('dl.iqd')})`} hint={usd && value > 0 ? <>= <IQD value={Math.round(value * rate)} /> · {t('dl.rate', { rate: fmt(rate) })}</> : undefined}>
        {(id) => <Input id={id} big inputMode={usd ? 'decimal' : 'numeric'} className="num" value={amount} onChange={(e) => setAmount(e.target.value)} data-autofocus />}
      </Field>
      <div className="flex gap-2">{quick.filter((v, i, a) => v > 0 && a.indexOf(v) === i).map((v) => <button key={v} type="button" onClick={() => setAmount(usd ? String(v) : fmt(v))} className="num min-h-10 rounded-full border border-line px-3 text-sm">{usd ? `$${fmtDollars(v)}` : fmt(v)}</button>)}</div>
      <Field label={t('dl.note')}>{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      <Button variant="primary" size="xl" block loading={run.busy} disabled={!(value > 0)} onClick={async () => { if (await run(c.id, value, method, note)) onDone() }}>{t('dl.q_collect')}</Button>
    </div>
  )
}

function VisitForm({ customerId, onDone }: { customerId: string | null; onDone: () => void }) {
  const t = useT()
  const [outcome, setOutcome] = useState<VisitOutcome>('visit')
  const [note, setNote] = useState('')
  const run = useAct(checkIn, 'dl.visit_ok')
  return (
    <div className="space-y-4">
      <p className="flex items-center gap-2 text-sm text-fg-2"><LocateFixed className="size-4" />{t('dl.visit_gps')}</p>
      <div className="grid grid-cols-2 gap-2">
        {(['visit', 'no_sale', 'closed'] as VisitOutcome[]).map((o) => (
          <button key={o} type="button" aria-pressed={outcome === o} onClick={() => setOutcome(o)}
            className={`min-h-12 rounded-xl border px-3 text-sm font-semibold ${outcome === o ? 'border-gold bg-gold-soft text-gold-text dark:bg-gold/15' : 'border-line'}`}>{t(`dl.outcome_${o}`)}</button>
        ))}
      </div>
      <Field label={t('dl.note')}>{(id) => <Textarea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      <Button variant="primary" size="xl" block loading={run.busy} onClick={async () => { if (await run(customerId, outcome, note)) onDone() }}>{t('dl.q_visit')}</Button>
    </div>
  )
}

/** Check in from the home screen: pick the shop (or none — e.g. a new area). */
export function CheckInSheet({ customerId, onClose }: { customerId: string | null; onClose: () => void }) {
  const t = useT()
  const { data: customers = [] } = useCustomers()
  const [id, setId] = useState(customerId ?? '')
  return (
    <Modal open onClose={onClose} title={t('dl.q_visit')}>
      <div className="space-y-4">
        <Field label={t('dl.customer')}>{(fid) => (
          <Select id={fid} value={id} onChange={(e) => setId(e.target.value)}>
            <option value="">{t('dl.no_customer')}</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        )}</Field>
        <VisitForm customerId={id || null} onDone={onClose} />
      </div>
    </Modal>
  )
}

function AddCustomerSheet({ onClose }: { onClose: () => void }) {
  const t = useT()
  const [f, setF] = useState({ name: '', phone: '', type: 'shop' as CustomerType, city: '', notes: '' })
  const [pos, setPos] = useState<Position | null | 'loading'>('loading')
  useEffect(() => { void getPosition(10000).then(setPos) }, [])
  const run = useAct(addCustomer, 'dl.cus_added')
  return (
    <Modal open onClose={onClose} title={t('dl.add_cus')}
      footer={<Button variant="primary" size="lg" block loading={run.busy} disabled={!f.name.trim()} onClick={async () => { if (await run({ ...f, position: pos === 'loading' ? null : pos })) onClose() }}>{t('common.save')}</Button>}>
      <div className="space-y-3">
        <Field label={t('dl.cus_name')}>{(id) => <Input id={id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-autofocus />}</Field>
        <Field label={t('dl.cus_phone')}>{(id) => <Input id={id} type="tel" dir="ltr" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />}</Field>
        <Field label={t('dl.cus_type')}>{(id) => <Select id={id} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as CustomerType })}>{(['shop', 'wholesale', 'retail'] as CustomerType[]).map((x) => <option key={x} value={x}>{t(`cust.type_${x}`)}</option>)}</Select>}</Field>
        <Field label={t('dl.cus_city')}>{(id) => <Input id={id} value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} />}</Field>
        <Field label={t('dl.note')}>{(id) => <Input id={id} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />}</Field>
        <p className="flex items-center gap-2 rounded-xl bg-surface-2 p-3 text-sm">
          <LocateFixed className="size-4 shrink-0" />
          {pos === 'loading' ? t('dl.locating') : pos ? t('dl.gps_ok', { m: pos.accuracyM }) : t('dl.gps_none')}
        </p>
      </div>
    </Modal>
  )
}
