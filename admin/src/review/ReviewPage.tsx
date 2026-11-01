import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCheck, Receipt } from 'lucide-react'
import { RequireAny } from '@/features/NoAccess'
import { SaleDetail } from '@/features/sales/SalesPage'
import { Amt } from '@/components/ui/Amt'
import { Button } from '@/components/ui/Button'
import { Badge, Card, EmptyState, PageHeader, Spinner } from '@/components/ui/Controls'
import { Field, Input } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import type { Sale } from '@/data/types'
import { useAction } from '@/hooks/queries'
import { useT } from '@/i18n'
import { fmtDateTime } from '@/lib/date'
import { api } from '@/services/api'
import { plural } from '../lib'

/** A sale as GET /sales/review sends it: the bill plus why it was flagged. */
export interface FlaggedSale extends Sale {
  flags: string[]
  needsReview: boolean
  reviewedAt: number | null
  reviewedBy: string | null
  reviewNote: string
}

export const listFlagged = async () => (await api<{ sales: FlaggedSale[] }>('GET', '/sales/review')).sales
export const markChecked = async (id: string, note: string) => (await api<{ sale: FlaggedSale }>('POST', `/sales/${id}/reviewed`, { note })).sale

export function ReviewPage() {
  return <RequireAny perms={['sales.view_all']}><Review /></RequireAny>
}

function Review() {
  const t = useT()
  const q = useQuery({ queryKey: ['review'], queryFn: listFlagged })
  const [open, setOpen] = useState<FlaggedSale | null>(null)
  const [checking, setChecking] = useState<FlaggedSale | null>(null)
  const sales = q.data ?? []
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <PageHeader title={t('ap.nav_review')} subtitle={t('ap.rev_sub')} />
      {q.isLoading ? <div className="grid h-60 place-items-center"><Spinner className="size-9" /></div> : !sales.length ? (
        <Card><EmptyState title={t('ap.rev_none')} /></Card>
      ) : (
        <>
          <p className="text-sm font-medium text-fg-2">{plural(t, sales.length, 'ap.rev_1', 'ap.rev_n')}</p>
          <ul className="space-y-3">
            {sales.map((s) => (
              <li key={s.id}>
                <Card className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="num font-semibold">{s.number}</span>
                        <Badge tone={s.channel === 'delegate' ? 'gold' : 'neutral'}>{t(`ap.channel_${s.channel === 'delegate' ? 'delegate' : 'store'}`)}</Badge>
                      </div>
                      <div className="mt-0.5 text-sm text-fg-2"><span className="num">{fmtDateTime(s.createdAt)}</span> · {s.userName}{s.customerName ? ` · ${s.customerName}` : ''}</div>
                    </div>
                    <Amt n={s.totalIQD} className="text-lg font-semibold" />
                  </div>
                  <ul className="space-y-2">
                    {s.flags.map((f) => (
                      <li key={f} className="flex items-start gap-2.5 rounded-xl bg-warn-bg px-3 py-2.5 text-warn-fg">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                        <div className="min-w-0">
                          <div className="text-sm font-semibold">{t(`flag.${f}`)}</div>
                          <div className="text-xs opacity-90">{t(`flag.${f}_hint`)}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button variant="secondary" icon={<Receipt className="size-5" />} onClick={() => setOpen(s)}>{t('ap.rev_open')}</Button>
                    <Button variant="primary" icon={<CheckCheck className="size-5" />} onClick={() => setChecking(s)}>{t('ap.rev_mark')}</Button>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
      <SaleDetail sale={open} onClose={() => setOpen(null)} />
      {checking && <CheckModal sale={checking} onClose={() => setChecking(null)} />}
    </div>
  )
}

function CheckModal({ sale, onClose }: { sale: FlaggedSale; onClose: () => void }) {
  const t = useT()
  const [note, setNote] = useState('')
  const run = useAction(markChecked, { success: 'ap.rev_done' })
  const submit = async () => { if (await run(sale.id, note)) onClose() }
  return (
    <Modal open onClose={onClose} title={`${t('ap.rev_mark')} · ${sale.number}`} size="sm"
      footer={<Button size="lg" variant="primary" block loading={run.busy} icon={<CheckCheck className="size-5" />} onClick={submit}>{t('ap.rev_mark')}</Button>}>
      <Field label={t('ap.rev_note')} hint={t('ap.rev_note_hint')}>{(id) => <Input id={id} value={note} maxLength={255} onChange={(e) => setNote(e.target.value)} data-autofocus />}</Field>
    </Modal>
  )
}
