import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Ban, Undo2 } from 'lucide-react'
import { Amt } from '@/components/ui/Amt'
import { Badge, EmptyState, PageHeader, Segmented, Spinner } from '@/components/ui/Controls'
import { Button } from '@/components/ui/Button'
import { Field, Input, SearchInput, Select } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { useApproval } from '@/components/ApprovalProvider'
import { useT } from '@/i18n'
import { APP } from '@/data/app'
import type { Sale, SaleStatus } from '@/data/types'
import { fmtDateTime } from '@/lib/date'
import { endOfDay, startOfDay } from '@/services/reports'
import { listReturns } from '@/services/returns'
import { findSaleByNumber, listSales, voidSale } from '@/services/sales'
import { useAction, useUsers } from '@/hooks/queries'
import { useCan } from '@/hooks/useAuth'
import { useScanner } from '@/hooks/useScanner'
import { toast } from '@/store/toast'
import { ReceiptModal } from '@/features/sell/Receipt'
import { ReturnModal } from './ReturnModal'

type Range = 'today' | '7d' | '30d' | 'all'
const DAY = 86_400_000

const STATUS_TONE: Record<SaleStatus, 'ok' | 'danger' | 'warn' | 'neutral'> = { completed: 'ok', voided: 'danger', partially_returned: 'warn', returned: 'neutral' }

export function SalesPage() {
  const t = useT()
  const seeAll = useCan('sales.view_all')
  const [tab, setTab] = useState<'sales' | 'returns'>('sales')
  const [range, setRange] = useState<Range>('today')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<'' | SaleStatus>('')
  const [userId, setUserId] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const { data: users } = useUsers()

  const filter = useMemo(() => ({
    from: range === 'today' ? startOfDay() : range === '7d' ? startOfDay(Date.now() - 6 * DAY) : range === '30d' ? startOfDay(Date.now() - 29 * DAY) : undefined,
    to: range === 'all' ? undefined : endOfDay(),
    q, status: status || undefined, userId: userId || undefined,
  }), [range, q, status, userId])
  const { data: sales, isLoading } = useQuery({ queryKey: ['sales', filter], queryFn: () => listSales(filter) })
  const { data: returns } = useQuery({ queryKey: ['returns'], queryFn: () => listReturns(), enabled: tab === 'returns' })

  // scanning a receipt's barcode jumps straight to that sale
  const onScan = useCallback(async (code: string) => {
    const s = await findSaleByNumber(code).catch(() => undefined)
    if (s) setOpenId(s.id); else toast.error(t('sales.not_found', { code }))
  }, [t])
  useScanner((c) => { void onScan(c) })

  const openSale = sales?.find((s) => s.id === openId) ?? null

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      <PageHeader title={t('sales.title')} subtitle={t('sales.subtitle')} actions={<Segmented value={tab} onChange={setTab} options={[{ value: 'sales', label: t('sales.tab_sales') }, { value: 'returns', label: t('sales.tab_returns') }]} />} />

      {tab === 'sales' ? (
        <>
          <div className="mb-4 grid gap-2.5 md:grid-cols-[1fr_auto_auto_auto]">
            <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('sales.search_ph')} data-scan-target="true" />
            <Segmented value={range} onChange={setRange} options={(['today', '7d', '30d', 'all'] as Range[]).map((r) => ({ value: r, label: t(`sales.range_${r}`) }))} />
            <Select value={status} onChange={(e) => setStatus(e.target.value as '' | SaleStatus)} aria-label={t('sales.status')}>
              <option value="">{t('sales.all_statuses')}</option>
              {(['completed', 'partially_returned', 'returned', 'voided'] as SaleStatus[]).map((s) => <option key={s} value={s}>{t(`sales.status_${s}`)}</option>)}
            </Select>
            {seeAll && (
              <Select value={userId} onChange={(e) => setUserId(e.target.value)} aria-label={t('sales.cashier')}>
                <option value="">{t('sales.all_cashiers')}</option>
                {(users ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            )}
          </div>

          {isLoading ? <div className="grid place-items-center py-16"><Spinner className="size-9" /></div> : !sales?.length ? <EmptyState title={t('sales.empty')} hint={t('sales.empty_hint')} /> : (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-fg-2">
                <Badge tone="gold"><span className="num">{sales.length}</span> {t('sales.count')}</Badge>
                <span>{t('sales.sum')}: <Amt n={sales.filter((s) => s.status !== 'voided').reduce((a, s) => a + s.totalIQD, 0)} className="font-semibold text-fg" /></span>
              </div>
              {/* table ≥ md */}
              <div className="hidden overflow-hidden rounded-2xl border border-line bg-surface md:block">
                <table className="w-full text-sm">
                  <thead className="bg-surface-2 text-xs uppercase tracking-wide text-fg-2 rtl:tracking-normal">
                    <tr><th className="px-4 py-3 text-start">{t('sales.col_number')}</th><th className="px-4 py-3 text-start">{t('sales.col_time')}</th><th className="px-4 py-3 text-start">{t('sales.cashier')}</th><th className="px-4 py-3 text-start">{t('sales.col_customer')}</th><th className="px-4 py-3 text-end">{t('sales.col_total')}</th><th className="px-4 py-3 text-start">{t('sales.status')}</th></tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {sales.map((s) => (
                      <tr key={s.id} onClick={() => setOpenId(s.id)} className="cursor-pointer transition hover:bg-surface-2">
                        <td className="num px-4 py-3 font-semibold">{s.number}</td>
                        <td className="num px-4 py-3 text-fg-2">{fmtDateTime(s.createdAt)}</td>
                        <td className="px-4 py-3">{s.userName}</td>
                        <td className="px-4 py-3 text-fg-2">{s.customerName || t('sell.walk_in')}</td>
                        <td className="px-4 py-3 text-end"><Amt n={s.totalIQD} className="font-semibold" /></td>
                        <td className="px-4 py-3"><Badge tone={STATUS_TONE[s.status]}>{t(`sales.status_${s.status}`)}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* cards < md */}
              <ul className="space-y-2.5 md:hidden">
                {sales.map((s) => (
                  <li key={s.id}>
                    <button type="button" onClick={() => setOpenId(s.id)} className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface p-3.5 text-start transition active:bg-surface-2">
                      <div className="min-w-0 flex-1 leading-tight">
                        <div className="num font-semibold">{s.number}</div>
                        <div className="num truncate text-xs text-fg-2">{fmtDateTime(s.createdAt)}</div>
                        <div className="truncate text-xs text-fg-2">{s.userName} · {s.customerName || t('sell.walk_in')}</div>
                      </div>
                      <div className="flex flex-col items-end gap-1"><Amt n={s.totalIQD} className="font-bold" /><Badge tone={STATUS_TONE[s.status]}>{t(`sales.status_${s.status}`)}</Badge></div>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      ) : !returns?.length ? <EmptyState title={t('sales.no_returns')} /> : (
        <ul className="space-y-2.5">
          {returns.map((r) => (
            <li key={r.id} className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3.5">
              <span className="grid size-11 place-items-center rounded-xl bg-surface-2 text-gold-text"><Undo2 className="size-5" /></span>
              <div className="min-w-0 flex-1 leading-tight"><div className="num font-semibold">{r.number}</div><div className="num truncate text-xs text-fg-2">{fmtDateTime(r.createdAt)} · {r.saleNumber} · {r.userName}</div></div>
              <div className="text-end"><Amt n={r.refundIQD} className="font-bold" /><div className="text-xs text-fg-2">{t(`ret.method_${r.refundMethod}`)}</div></div>
            </li>
          ))}
        </ul>
      )}

      <SaleDetail sale={openSale} onClose={() => setOpenId(null)} />
    </div>
  )
}

/** Receipt view + the actions available on a past sale. */
/** A bill with its actions (void, return). Also opened from the admin panel, which has no till drawer: no returns there. */
export function SaleDetail({ sale, onClose }: { sale: Sale | null; onClose: () => void }) {
  const t = useT()
  const ask = useApproval()
  const canReturn = useCan('returns.create') && APP !== 'admin'
  const canVoid = useCan('sales.void')
  const [returning, setReturning] = useState(false)
  const [voiding, setVoiding] = useState(false)
  const [reason, setReason] = useState('')
  const run = useAction(voidSale, { success: 'sales.voided_ok' })

  if (!sale) return null
  const canAct = sale.status === 'completed' || sale.status === 'partially_returned'
  const doVoid = async () => {
    let approvedBy: { id: string; name: string } | null = null
    if (!canVoid) { approvedBy = await ask('sales.void', t('sales.void_approval')); if (!approvedBy) return }
    if (await run(sale.id, reason, approvedBy)) { setVoiding(false); setReason(''); onClose() }
  }
  return (
    <>
      <ReceiptModal
        sale={returning || voiding ? null : sale}
        mode="view"
        onClose={onClose}
        actions={canAct && (
          <>
            {sale.status === 'completed' && <Button size="lg" variant="secondary" icon={<Ban className="size-5" />} className="text-danger" onClick={() => setVoiding(true)}>{t('sales.void')}</Button>}
            {canReturn && <Button size="lg" variant="secondary" icon={<Undo2 className="size-5" />} onClick={() => setReturning(true)}>{t('ret.title')}</Button>}
          </>
        )}
      />
      {returning && <ReturnModal sale={sale} onClose={() => setReturning(false)} onDone={onClose} />}
      <Modal open={voiding} onClose={() => setVoiding(false)} title={`${t('sales.void')} · ${sale.number}`} size="sm" footer={<Button size="lg" variant="danger" block icon={<Ban className="size-5" />} loading={run.busy} disabled={!reason.trim()} onClick={doVoid}>{t('sales.void_confirm')}</Button>}>
        <div className="space-y-3">
          <p className="text-sm text-fg-2">{t('sales.void_hint')}</p>
          <Field label={t('sales.void_reason')}>{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} data-autofocus />}</Field>
        </div>
      </Modal>
    </>
  )
}
