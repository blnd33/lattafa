import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowDownToLine, ArrowUpFromLine, Clock, Lock, Minus, Play, Plus, Printer, Wallet } from 'lucide-react'
import { Amt, UsdAmt } from '@/components/ui/Amt'
import { Badge, Card, EmptyState, PageHeader, Spinner, Stat } from '@/components/ui/Controls'
import { Button, IconButton } from '@/components/ui/Button'
import { Field, Input, Textarea } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { cn } from '@/components/ui/cn'
import { useT } from '@/i18n'
import type { Shift } from '@/data/types'
import { fmtDateTime, fmtDuration, fmtTime } from '@/lib/date'
import { IQD_NOTES, USD_NOTES, fmt, parseAmount } from '@/lib/money'
import { addCashMovement, closeShift, computeShiftTotals, openShift } from '@/services/shifts'
import { useAction, useMyShift, useSettings, useShifts } from '@/hooks/queries'
import { useCan } from '@/hooks/useAuth'
import { useUI } from '@/store/ui'
import { ShiftReport, printShiftReport } from './ShiftReport'

export function ShiftPage() {
  const t = useT()
  const { data: shift, isLoading } = useMyShift()
  const { data: past = [] } = useShifts()
  const canOpen = useCan('shifts.open')
  if (isLoading) return <div className="grid h-full place-items-center"><Spinner className="size-9" /></div>
  const history = past.filter((s) => s.status === 'closed')
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <PageHeader title={t('shift.title')} subtitle={shift ? t('shift.open_since', { time: fmtTime(shift.openedAt) }) : t('shift.none_hint')} />
      {shift ? <OpenShiftPanel shift={shift} /> : canOpen ? <OpenForm /> : <EmptyState title={t('noaccess.title')} />}
      <section>
        <h2 className="mb-3 font-serif text-xl font-semibold">{t('shift.history')}</h2>
        <History shifts={history} />
      </section>
    </div>
  )
}

/* ───── open ───── */
function OpenForm() {
  const t = useT()
  const [iqd, setIqd] = useState('')
  const [usd, setUsd] = useState('')
  const { data: settings } = useSettings()
  const open = useAction(openShift, { success: 'shift.opened_ok' })
  return (
    <Card className="mx-auto max-w-lg space-y-4">
      <div className="flex items-center gap-3">
        <span className="grid size-12 place-items-center rounded-2xl bg-gold-soft text-gold-dark dark:bg-gold/20"><Wallet className="size-6" /></span>
        <div><h2 className="font-serif text-xl font-semibold">{t('shift.open_action')}</h2><p className="text-sm text-fg-2">{t('shift.open_hint')}</p></div>
      </div>
      <Field label={t('shift.opening_iqd')}>{(id) => <Input id={id} big inputMode="numeric" value={iqd} placeholder="0" onChange={(e) => setIqd(e.target.value.replace(/[^\d]/g, ''))} className="num" data-autofocus />}</Field>
      {settings?.currency.usdEnabled && <Field label={t('shift.opening_usd')}>{(id) => <Input id={id} big inputMode="decimal" value={usd} placeholder="0" onChange={(e) => setUsd(e.target.value.replace(/[^\d.]/g, ''))} className="num" />}</Field>}
      <Button variant="primary" size="xl" block icon={<Play className="size-5" />} loading={open.busy} onClick={() => open({ openingIQD: parseAmount(iqd), openingUSD: parseAmount(usd) })}>{t('shift.open_action')}</Button>
    </Card>
  )
}

/* ───── running shift ───── */
function OpenShiftPanel({ shift }: { shift: Shift }) {
  const t = useT()
  const lang = useUI((s) => s.lang)
  const { data: settings } = useSettings()
  const canMove = useCan('shifts.cash_movement')
  const canClose = useCan('shifts.close')
  const { data: totals } = useQuery({ queryKey: ['shiftTotals', shift.id, shift.movements.length], queryFn: () => computeShiftTotals(shift), refetchInterval: 20_000 })
  const [move, setMove] = useState<'in' | 'out' | null>(null)
  const [closing, setClosing] = useState(false)
  const [xopen, setXopen] = useState(false)
  if (!totals || !settings) return <Spinner />
  const methods = Object.entries(totals.byMethod).filter(([k]) => !k.startsWith('collection_'))
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat tone="gold" label={t('shift.sales_total')} value={<Amt n={totals.salesIQD} />} sub={`${totals.salesCount} ${t('shift.sales_count').toLowerCase()}`} />
        <Stat label={t('shift.expected_iqd')} value={<Amt n={totals.expectedIQD} />} sub={`${t('shift.opening_float')}: ${fmt(shift.openingIQD)}`} />
        <Stat label={t('shift.expected_usd')} value={<UsdAmt n={totals.expectedUSD} />} sub={`${t('shift.usd_received')}: $${totals.cashUSD}`} />
        <Stat label={t('shift.duration')} value={fmtDuration(Date.now() - shift.openedAt)} sub={fmtDateTime(shift.openedAt)} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Card>
          <h3 className="mb-3 font-semibold">{t('shift.by_method')}</h3>
          {methods.length === 0 ? <p className="py-4 text-sm text-fg-2">{t('shift.no_sales_yet')}</p> : (
            <ul className="space-y-3">
              {methods.map(([k, v]) => (
                <li key={k}>
                  <div className="mb-1 flex justify-between text-sm"><span>{t(`method.${k}`)}</span><Amt n={v} className="font-semibold" /></div>
                  <div className="h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-gradient-to-r from-gold-light to-gold-dark" style={{ width: `${Math.max(4, (v / Math.max(1, totals.salesIQD)) * 100)}%` }} /></div>
                </li>
              ))}
            </ul>
          )}
          {shift.movements.length > 0 && (
            <div className="mt-5 border-t border-line pt-3">
              <h3 className="mb-2 font-semibold">{t('shift.movements')}</h3>
              <ul className="space-y-1.5 text-sm">
                {shift.movements.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3"><span className="flex items-center gap-2 text-fg-2">{m.type === 'in' ? <ArrowDownToLine className="size-4 text-success" /> : <ArrowUpFromLine className="size-4 text-danger" />}<span className="num">{fmtTime(m.createdAt)}</span> {m.reason}</span><Amt n={m.type === 'in' ? m.amountIQD : -m.amountIQD} className={m.type === 'in' ? 'text-success' : 'text-danger'} /></li>
                ))}
              </ul>
            </div>
          )}
        </Card>
        <div className="flex flex-col gap-2.5">
          {canMove && (
            <div className="grid grid-cols-2 gap-2.5">
              <Button size="lg" variant="secondary" icon={<Plus className="size-5" />} onClick={() => setMove('in')}>{t('shift.cash_in')}</Button>
              <Button size="lg" variant="secondary" icon={<Minus className="size-5" />} onClick={() => setMove('out')}>{t('shift.cash_out')}</Button>
            </div>
          )}
          <Button size="lg" variant="secondary" icon={<Printer className="size-5" />} onClick={() => setXopen(true)}>{t('shift.x_report')}</Button>
          {canClose && <Button size="xl" variant="primary" icon={<Lock className="size-5" />} onClick={() => setClosing(true)}>{t('shift.close_action')}</Button>}
        </div>
      </div>
      <MoveModal type={move} onClose={() => setMove(null)} />
      <CloseModal open={closing} onClose={() => setClosing(false)} expectedIQD={totals.expectedIQD} expectedUSD={totals.expectedUSD} usdOn={settings.currency.usdEnabled} />
      <Modal open={xopen} onClose={() => setXopen(false)} title={t('shift.x_report')} size="sm" bodyClassName="bg-surface-2" footer={<Button size="lg" variant="primary" block icon={<Printer className="size-5" />} onClick={() => printShiftReport(shift, totals, settings, lang)}>{t('receipt.print')}</Button>}>
        <div className="mx-auto w-fit shadow-soft"><ShiftReport shift={shift} totals={totals} settings={settings} lang={lang} /></div>
      </Modal>
    </>
  )
}

function MoveModal({ type, onClose }: { type: 'in' | 'out' | null; onClose: () => void }) {
  const t = useT()
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const run = useAction(addCashMovement, { success: 'shift.movement_ok' })
  const submit = async () => { if (type && (await run({ type, amountIQD: parseAmount(amount), reason }))) { setAmount(''); setReason(''); onClose() } }
  return (
    <Modal open={!!type} onClose={onClose} title={type === 'in' ? t('shift.cash_in') : t('shift.cash_out')} size="sm" footer={<Button size="lg" variant="primary" block loading={run.busy} disabled={!(parseAmount(amount) > 0) || !reason.trim()} onClick={submit}>{t('common.save')}</Button>}>
      <div className="space-y-4">
        <Field label={t('common.amount')}>{(id) => <Input id={id} big inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))} className="num" data-autofocus />}</Field>
        <Field label={t('shift.reason')} hint={type === 'out' ? t('shift.reason_out_hint') : undefined}>{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
      </div>
    </Modal>
  )
}

/* ───── close: count the drawer ───── */
function Counter({ notes, counts, onChange, prefix }: { notes: readonly number[]; counts: Record<number, number>; onChange: (n: number, v: number) => void; prefix?: string }) {
  return (
    <ul className="divide-y divide-line">
      {notes.map((n) => (
        <li key={n} className="flex items-center justify-between gap-2 py-1.5">
          <span className="num w-20 text-sm font-semibold">{prefix}{fmt(n)}</span>
          <div className="flex items-center rounded-xl bg-surface-2">
            <IconButton label="−" variant="ghost" onClick={() => onChange(n, Math.max(0, (counts[n] ?? 0) - 1))}><Minus className="size-4" /></IconButton>
            <input aria-label={String(n)} inputMode="numeric" className="num w-12 bg-transparent text-center font-bold outline-none" value={counts[n] ?? 0} onFocus={(e) => e.target.select()} onChange={(e) => onChange(n, parseInt(e.target.value.replace(/\D/g, ''), 10) || 0)} />
            <IconButton label="+" variant="ghost" onClick={() => onChange(n, (counts[n] ?? 0) + 1)}><Plus className="size-4" /></IconButton>
          </div>
          <span className="num w-24 text-end text-sm text-fg-2">{prefix}{fmt(n * (counts[n] ?? 0))}</span>
        </li>
      ))}
    </ul>
  )
}

function CloseModal({ open, onClose, expectedIQD, expectedUSD, usdOn }: { open: boolean; onClose: () => void; expectedIQD: number; expectedUSD: number; usdOn: boolean }) {
  const t = useT()
  const lang = useUI((s) => s.lang)
  const { data: settings } = useSettings()
  const [iqd, setIqd] = useState<Record<number, number>>({})
  const [usd, setUsd] = useState<Record<number, number>>({})
  const [direct, setDirect] = useState('')
  const [tab, setTab] = useState<'count' | 'direct'>('count')
  const [note, setNote] = useState('')
  const [done, setDone] = useState<Shift | null>(null)
  const run = useAction(closeShift)

  const countedIQD = useMemo(() => (tab === 'direct' ? parseAmount(direct) : IQD_NOTES.reduce((a, n) => a + n * (iqd[n] ?? 0), 0)), [tab, direct, iqd])
  const countedUSD = useMemo(() => USD_NOTES.reduce((a, n) => a + n * (usd[n] ?? 0), 0), [usd])
  const variance = countedIQD - expectedIQD
  const usdVar = countedUSD - expectedUSD

  const close = async () => {
    const s = await run({ countedIQD, countedUSD, note })
    if (s) setDone(s)
  }
  const finish = () => { setDone(null); onClose() }

  if (done && settings && done.totals) {
    return (
      <Modal open onClose={finish} title={t('shift.closed_title')} size="sm" bodyClassName="bg-surface-2" footer={<div className="flex gap-2"><Button size="lg" variant="secondary" className="flex-1" onClick={finish}>{t('common.done')}</Button><Button size="lg" variant="primary" className="flex-1" icon={<Printer className="size-5" />} onClick={() => printShiftReport(done, done.totals!, settings, lang)}>{t('receipt.print')}</Button></div>}>
        <div className="mx-auto w-fit shadow-soft"><ShiftReport shift={done} totals={done.totals} settings={settings} lang={lang} /></div>
      </Modal>
    )
  }

  return (
    <Modal open={open} onClose={onClose} title={t('shift.close_action')} size="lg" bodyClassName="p-0" footer={
      <div className="flex items-center justify-between gap-3">
        <div className={cn('rounded-xl px-3 py-2 text-sm font-semibold', variance === 0 && usdVar === 0 ? 'bg-ok-bg text-ok-fg' : 'bg-warn-bg text-warn-fg')}>{t('shift.variance')}: <Amt n={variance} />{usdOn && usdVar !== 0 && <span className="num"> · {usdVar > 0 ? '+' : '−'}${Math.abs(usdVar)}</span>}</div>
        <Button size="lg" variant="primary" loading={run.busy} icon={<Lock className="size-5" />} onClick={close}>{t('shift.close_action')}</Button>
      </div>
    }>
      <div className="grid md:grid-cols-2">
        <div className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-surface-2 p-3"><div className="text-xs text-fg-2">{t('shift.expected_iqd')}</div><Amt n={expectedIQD} className="text-lg font-bold" /></div>
            <div className="rounded-xl bg-gold-soft p-3 dark:bg-gold/15"><div className="text-xs text-fg-2">{t('shift.counted_iqd')}</div><Amt n={countedIQD} className="text-lg font-bold" /></div>
          </div>
          <div role="group" className="inline-flex rounded-xl bg-surface-2 p-1">
            {(['count', 'direct'] as const).map((k) => <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)} className={cn('h-9 rounded-lg px-4 text-sm font-semibold', tab === k ? 'bg-gold text-ink' : 'text-fg-2')}>{t(`shift.tab_${k}`)}</button>)}
          </div>
          {tab === 'count' ? <Counter notes={IQD_NOTES} counts={iqd} onChange={(n, v) => setIqd((c) => ({ ...c, [n]: v }))} /> : (
            <Field label={t('shift.counted_iqd')}>{(id) => <Input id={id} big inputMode="numeric" value={direct} onChange={(e) => setDirect(e.target.value.replace(/[^\d]/g, ''))} className="num" data-autofocus />}</Field>
          )}
        </div>
        <div className="space-y-4 border-t border-line p-5 md:border-s md:border-t-0">
          {usdOn && (
            <>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl bg-surface-2 p-3"><div className="text-xs text-fg-2">{t('shift.expected_usd')}</div><UsdAmt n={expectedUSD} className="text-lg font-bold" /></div>
                <div className="rounded-xl bg-gold-soft p-3 dark:bg-gold/15"><div className="text-xs text-fg-2">{t('shift.counted_usd')}</div><UsdAmt n={countedUSD} className="text-lg font-bold" /></div>
              </div>
              <Counter notes={USD_NOTES} counts={usd} onChange={(n, v) => setUsd((c) => ({ ...c, [n]: v }))} prefix="$" />
            </>
          )}
          <Field label={t('common.note')}>{(id) => <Textarea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        </div>
      </div>
    </Modal>
  )
}

/* ───── history ───── */
function History({ shifts }: { shifts: Shift[] }) {
  const t = useT()
  const lang = useUI((s) => s.lang)
  const { data: settings } = useSettings()
  const [view, setView] = useState<Shift | null>(null)
  if (!shifts.length) return <EmptyState title={t('shift.no_history')} className="py-8" />
  return (
    <>
      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        <ul className="divide-y divide-line">
          {shifts.slice(0, 30).map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => setView(s)} className="flex min-h-16 w-full items-center gap-3 px-4 py-2.5 text-start transition hover:bg-surface-2">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-fg-2"><Clock className="size-5" /></span>
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate font-semibold">{s.userName}</span>
                  <span className="num block truncate text-xs text-fg-2">{fmtDateTime(s.openedAt)} → {s.closedAt ? fmtTime(s.closedAt) : ''}</span>
                </span>
                <span className="hidden text-end sm:block"><Amt n={s.totals?.salesIQD ?? 0} className="font-semibold" /><span className="block text-xs text-fg-2">{s.totals?.salesCount ?? 0} {t('shift.sales_count').toLowerCase()}</span></span>
                <Badge tone={(s.varianceIQD ?? 0) === 0 ? 'ok' : 'warn'}><Amt n={s.varianceIQD ?? 0} unit={false} /></Badge>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <Modal open={!!view} onClose={() => setView(null)} title={t('shift.z_report')} size="sm" bodyClassName="bg-surface-2" footer={view?.totals && settings ? <Button size="lg" variant="primary" block icon={<Printer className="size-5" />} onClick={() => printShiftReport(view, view.totals!, settings, lang)}>{t('receipt.print')}</Button> : undefined}>
        {view?.totals && settings && <div className="mx-auto w-fit shadow-soft"><ShiftReport shift={view} totals={view.totals} settings={settings} lang={lang} /></div>}
      </Modal>
    </>
  )
}
