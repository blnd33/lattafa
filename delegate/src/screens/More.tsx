import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ChevronRight, Circle, ClipboardList, Tags, LogOut, Moon, RefreshCw, Send, Sun, SunMoon } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Badge, Card, Segmented } from '@/components/ui/Controls'
import { Field, Input, Textarea } from '@/components/ui/Field'
import { useConfirm } from '@/components/ui/Modal'
import { cn } from '@/components/ui/cn'
import { errorMessage, useT } from '@/i18n'
import { fmt, parseAmount } from '@/lib/money'
import { AppError } from '@/services/context'
import { toast } from '@/store/toast'
import { useWaitingOrders } from '../orders'
import { pushState, turnOffPush, turnOnPush, type PushState } from '../push'
import { useUI, type ThemeChoice } from '@/store/ui'
import { useSession } from '../auth'
import { submitClosing, today } from '../field'
import { useAct, useClosings, useFailed, useMeta, useMyDay, usePending } from '../hooks'
import { InstallCard } from '../Install'
import { syncNow } from '../sync'
import { fmtDollars, IQD, LangSwitch, SectionTitle, TopBar, USD } from '../ui'

export function MoreScreen() {
  const t = useT()
  const actor = useSession((s) => s.actor)!
  const signOut = useSession((s) => s.signOut)
  const confirm = useConfirm()
  const { data: meta } = useMeta()
  const { data: pending = 0 } = usePending()
  const theme = useUI((s) => s.theme)
  const setTheme = useUI((s) => s.setTheme)

  const leave = async () => {
    if (pending > 0 && !(await confirm({ title: t('dl.sign_out'), message: t('dl.sign_out_pending', { n: pending }), confirmLabel: t('dl.sign_out') }))) return
    signOut()
  }

  return (
    <div>
      <TopBar title={actor.name} subtitle={`${actor.roleName}${meta?.deviceCode ? ` · ${meta.deviceCode}` : ''}`} />
      <OrdersLink />
      <PricesLink />
      <Closing />
      <SyncCard />
      <SectionTitle>{t('dl.settings')}</SectionTitle>
      <div className="mb-3"><InstallCard /></div>
      <Card className="mx-4 space-y-4">
        <PushRow />
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium">{t('dl.language')}</span><LangSwitch /></div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium">{t('dl.theme')}</span>
          <Segmented<ThemeChoice> size="sm" value={theme} onChange={setTheme} options={[{ value: 'light', label: <Sun className="size-4" aria-label={t('theme.light')} /> }, { value: 'dark', label: <Moon className="size-4" aria-label={t('theme.dark')} /> }, { value: 'system', label: <SunMoon className="size-4" aria-label={t('theme.system')} /> }]} />
        </div>
      </Card>
      <div className="mx-4 my-6"><Button variant="ghost" size="lg" block className="text-danger" icon={<LogOut className="size-5" />} onClick={leave}>{t('dl.sign_out')}</Button></div>
      <p className="px-4 pb-6 text-center text-xs text-fg-2">Developed by <b>Coda Agency</b> — Build What's Next — <span dir="ltr" className="num">+964 750 730 8005</span> — <b>@codatechagency</b></p>
    </div>
  )
}

/** End of day: what the phone recorded, the cash counted, sent for a manager's approval. */
/** Orders shops sent from the menu, with how many are still waiting. */
/** Ring this phone when an order comes in, even with the app closed. */
function PushRow() {
  const t = useT()
  const [state, setState] = useState<PushState | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { void pushState().then(setState) }, [])
  if (state === null || state === 'unsupported') return null
  const flip = async () => {
    setBusy(true)
    try { setState(state === 'on' ? await turnOffPush() : await turnOnPush()) } finally { setBusy(false) }
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{t('dl.push')}</span>
        <span className="block text-xs text-fg-2">{t(state === 'blocked' ? 'dl.push_blocked' : state === 'no-keys' ? 'dl.push_off_shop' : 'dl.push_hint')}</span>
      </span>
      {state !== 'blocked' && state !== 'no-keys' && (
        <Button size="sm" variant={state === 'on' ? 'secondary' : 'primary'} loading={busy} onClick={() => void flip()}>
          {t(state === 'on' ? 'dl.push_off' : 'dl.push_on')}
        </Button>
      )}
    </div>
  )
}

function OrdersLink() {
  const t = useT()
  const nav = useNavigate()
  const { data: waiting = 0 } = useWaitingOrders()
  return (
    <button type="button" onClick={() => nav('/orders')} className="mx-4 mt-4 flex w-[calc(100%-2rem)] items-center gap-3 rounded-3xl border border-line bg-surface p-4 text-start shadow-soft">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-gold-text"><ClipboardList className="size-5" /></span>
      <span className="min-w-0 flex-1 font-semibold">{t('dl.orders')}</span>
      {waiting > 0 && <Badge tone="gold">{waiting}</Badge>}
      <ChevronRight className="size-5 shrink-0 text-fg-2 rtl:rotate-180" />
    </button>
  )
}

/** His own dollar prices, and adding a perfume the shop has not entered yet. */
function PricesLink() {
  const t = useT()
  const nav = useNavigate()
  return (
    <button type="button" onClick={() => nav('/prices')} className="mx-4 mt-3 flex w-[calc(100%-2rem)] items-center gap-3 rounded-3xl border border-line bg-surface p-4 text-start shadow-soft">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-gold-text"><Tags className="size-5" /></span>
      <span className="min-w-0 flex-1 font-semibold">{t('dl.prices')}</span>
      <ChevronRight className="size-5 shrink-0 text-fg-2 rtl:rotate-180" />
    </button>
  )
}

function Closing() {
  const t = useT()
  const { data: day } = useMyDay()
  const { data: closings = [] } = useClosings()
  const { data: pending = 0 } = usePending()
  const { data: meta } = useMeta()
  const [counted, setCounted] = useState('')
  const [countedUSD, setCountedUSD] = useState('')
  const [expenses, setExpenses] = useState('')
  const [note, setNote] = useState('')
  const send = useAct(submitClosing)
  const mine = closings.find((c) => c.day === today())
  // coming back to a closing already sent today: show what was sent, so a correction starts from it
  const [shown, setShown] = useState('')
  if (mine && mine.id !== shown) {
    setShown(mine.id)
    setCounted(String(mine.countedCashIQD)); setCountedUSD(mine.countedCashUSD ? String(mine.countedCashUSD) : '')
    setExpenses(mine.expensesIQD ? String(mine.expensesIQD) : ''); setNote(mine.note)
  }
  const exp = parseAmount(expenses)
  // dinar notes and dollar notes are counted separately; expenses are paid in dinars
  const expected = (day?.cashInHandIQD ?? 0) - exp
  const expectedUSD = day?.cashInHandUSD ?? 0
  const showUSD = (meta?.settings?.currency.usdEnabled ?? true) || expectedUSD > 0
  const checks = [
    { ok: pending === 0, label: t('dl.c_sync') },
    { ok: (day?.visits ?? 0) > 0, label: t('dl.c_visits') },
    { ok: counted.trim() !== '' && (expectedUSD === 0 || countedUSD.trim() !== ''), label: t('dl.c_counted') },
  ]
  const submit = async () => {
    const r = await send({ countedCashIQD: parseAmount(counted), countedCashUSD: parseAmount(countedUSD), expensesIQD: exp, note })
    if (r) toast.success(t(r.status === 'pending' ? 'dl.closing_queued' : 'dl.closing_sent'))
  }

  return (
    <>
      <SectionTitle action={mine && <Badge tone={mine.status === 'approved' ? 'ok' : mine.status === 'rejected' ? 'danger' : 'warn'}>{t(`dl.status_${mine.status}`)}</Badge>}>{t('dl.closing')}</SectionTitle>
      <Card className="mx-4 space-y-4">
        <dl className="grid grid-cols-2 gap-2 text-sm">
          {([['dl.sales_total', day?.salesIQD], ['dl.cash_sales', day?.cashSalesIQD], ['dl.credit_sales', day?.creditSalesIQD], ['dl.collections', day?.collectionsIQD]] as const).map(([k, v]) => (
            <div key={k} className="rounded-2xl bg-surface-2 p-3"><dt className="text-xs text-fg-2">{t(k)}</dt><dd><IQD value={v ?? 0} className="font-semibold" /></dd></div>
          ))}
        </dl>
        <p className="text-sm text-fg-2">{t('dl.units_sold')}: <span className="num font-semibold text-fg">{day?.vanUnits ?? 0}</span> · {t('dl.visits')}: <span className="num font-semibold text-fg">{day?.visits ?? 0}</span></p>
        {mine?.status === 'approved' ? (
          <p className="rounded-2xl bg-ok-bg p-3 text-sm text-ok-fg">{t('dl.closing_approved')}{mine.reviewNote ? ` — ${mine.reviewNote}` : ''}</p>
        ) : (
          <>
            {mine?.status === 'rejected' && <p className="rounded-2xl bg-danger-bg p-3 text-sm text-danger-fg">{t('dl.closing_rejected')}{mine.reviewNote ? ` — ${mine.reviewNote}` : ''}</p>}
            {(mine?.status === 'submitted' || mine?.status === 'pending') && <p className="rounded-2xl bg-surface-2 p-3 text-sm text-fg-2">{t(mine.status === 'pending' ? 'dl.closing_pending' : 'dl.closing_submitted')}</p>}
            <Field label={`${t('dl.expenses')} (${t('dl.iqd')})`}>{(id) => <Input id={id} inputMode="numeric" className="num" value={expenses} onChange={(e) => setExpenses(e.target.value)} />}</Field>
            <div className={cn('grid gap-3', showUSD && 'sm:grid-cols-2')}>
              <CashBox title={t('dl.dinars')} value={counted} onChange={setCounted} expected={expected} />
              {showUSD && <CashBox title={t('dl.dollars')} value={countedUSD} onChange={setCountedUSD} expected={expectedUSD} usd />}
            </div>
            <ul className="space-y-1 text-sm">
              {checks.map((c) => <li key={c.label} className="flex items-center gap-2">{c.ok ? <CheckCircle2 className="size-4 text-success" /> : <Circle className="size-4 text-fg-2" />}{c.label}</li>)}
            </ul>
            <Field label={t('dl.note')}>{(id) => <Textarea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
            <Button variant="primary" size="lg" block loading={send.busy} disabled={!counted.trim()} icon={<Send className="size-5" />} onClick={submit}>{t('dl.send')}</Button>
            <p className="text-xs text-fg-2">{t('dl.closing_hint')}</p>
          </>
        )}
      </Card>
    </>
  )
}

/** One pile of cash at the end of the day: what was counted, what the phone expects, and the difference. */
function CashBox({ title, value, onChange, expected, usd }: { title: string; value: string; onChange: (v: string) => void; expected: number; usd?: boolean }) {
  const t = useT()
  const diff = usd ? Math.round((parseAmount(value) - expected) * 100) / 100 : parseAmount(value) - expected
  const show = (n: number) => (usd ? `$${fmtDollars(n)}` : fmt(n))
  return (
    <div className="space-y-2 rounded-2xl bg-surface-2 p-3">
      <p className="text-sm font-semibold">{title}</p>
      <Field label={t('dl.counted')}>{(id) => <Input id={id} aria-label={`${title} — ${t('dl.counted')}`} inputMode={usd ? 'decimal' : 'numeric'} className="num" value={value} onChange={(e) => onChange(e.target.value)} />}</Field>
      <dl className="space-y-1 text-sm">
        <div className="flex justify-between"><dt className="text-fg-2">{t('dl.exp_cash')}</dt><dd>{usd ? <USD value={expected} className="font-semibold" /> : <IQD value={expected} className="font-semibold" />}</dd></div>
        {value.trim() && (
          <div className={cn('flex justify-between font-semibold', diff < 0 ? 'text-danger' : diff > 0 ? 'text-warn-fg' : 'text-success')}>
            <dt>{t('dl.variance')}</dt><dd className="num">{diff > 0 ? '+' : diff < 0 ? '−' : ''}{show(Math.abs(diff))}</dd>
          </div>
        )}
      </dl>
    </div>
  )
}

function SyncCard() {
  const t = useT()
  const qc = useQueryClient()
  const { data: meta } = useMeta()
  const { data: pending = 0 } = usePending()
  const { data: failed = [] } = useFailed()
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    try {
      const r = await syncNow()
      await qc.invalidateQueries()
      if (r.ok) toast.success(t('sync.done'))
      else toast.error(errorMessage(new AppError(r.reason === 'offline' ? 'offline' : r.reason === 'not_signed_in' ? 'not_signed_in' : 'server_error'), t))
    } finally { setBusy(false) }
  }
  return (
    <>
      <SectionTitle>{t('dl.sync')}</SectionTitle>
      <Card className="mx-4 space-y-3">
        <p className="text-sm">{pending ? t('dl.pending', { n: pending }) : t('dl.synced')} · {meta?.lastPullAt ? t('sync.last', { time: new Date(meta.lastPullAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }) : t('sync.never')}</p>
        <Button variant="secondary" size="lg" block loading={busy} icon={<RefreshCw className="size-5" />} onClick={run}>{t('sync.now')}</Button>
        {failed.length > 0 && <p className="rounded-xl bg-danger-bg p-3 text-sm text-danger-fg">{t('sync.failed', { n: failed.length })} — {t('settings.sync_failed_hint')}</p>}
      </Card>
    </>
  )
}
