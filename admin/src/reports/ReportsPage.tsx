import { useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, FileSpreadsheet, Printer } from 'lucide-react'
import { usePrint } from '@/components/PrintHost'
import { Button } from '@/components/ui/Button'
import { Card, Chips, EmptyState, PageHeader, Spinner } from '@/components/ui/Controls'
import { Input, Select } from '@/components/ui/Field'
import { cn } from '@/components/ui/cn'
import { useAction, useSettings } from '@/hooks/queries'
import { useCan } from '@/hooks/useAuth'
import { errorMessage, useT } from '@/i18n'
import { fromInputDate, toInputDate } from '@/lib/date'
import { hasPerm } from '@/lib/permissions'
import { useSession } from '@/store/session'
import { toast } from '@/store/toast'
import { useUI } from '@/store/ui'
import { GROUPS, presetRange, REPORTS, runReport, setCommission, type Column, type Preset, type ReportDef, type ReportId, type Row } from './api'
import { CellContent, downloadXlsx, Period, PrintableReport, type ExportCtx } from './export'
import { cellText, isNumeric, sortRows } from './format'

const PRESETS: Preset[] = ['today', 'yesterday', '7', '30', '90', 'month', 'last_month', 'year', 'custom']

/** Admin panel → Reports: pick a report and a period; read it here, or take it away as Excel or PDF. */
export function ReportsPage() {
  const t = useT()
  const actor = useSession((s) => s.actor)
  const mine = useMemo(() => REPORTS.filter((r) => !!actor && hasPerm(actor.permissions, r.perm)), [actor])
  const [id, setId] = useState<ReportId | null>(mine[0]?.id ?? null)
  const def = mine.find((r) => r.id === id) ?? mine[0]
  if (!def) return <div className="p-6"><EmptyState title={t('noaccess.title')} hint={t('noaccess.hint')} /></div>
  return (
    <div className="mx-auto max-w-[1400px] p-4 md:p-6">
      <PageHeader title={t('rx.title')} subtitle={t('rx.subtitle')} />
      <div className="grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
        {/* the list (a dropdown on small screens) */}
        <div className="lg:hidden">
          <Select aria-label={t('rx.pick')} value={def.id} onChange={(e) => setId(e.target.value as ReportId)}>
            {GROUPS.map((g) => <optgroup key={g} label={t(`rx.g_${g}`)}>{mine.filter((r) => r.group === g).map((r) => <option key={r.id} value={r.id}>{t(`rx.r_${r.id}`)}</option>)}</optgroup>)}
          </Select>
        </div>
        <nav aria-label={t('rx.title')} className="hidden lg:block">
          {GROUPS.map((g) => {
            const list = mine.filter((r) => r.group === g)
            if (!list.length) return null
            return (
              <div key={g} className="mb-4">
                <div className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[.14em] text-fg-2 rtl:tracking-normal">{t(`rx.g_${g}`)}</div>
                {list.map((r) => (
                  <button key={r.id} type="button" onClick={() => setId(r.id)} aria-current={r.id === def.id ? 'page' : undefined}
                    className={cn('flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-start text-sm transition', r.id === def.id ? 'bg-gold-soft font-semibold text-gold-text dark:bg-gold/15' : 'text-fg hover:bg-surface-2')}>
                    <r.icon className="size-4 shrink-0" />{t(`rx.r_${r.id}`)}
                  </button>
                ))}
              </div>
            )
          })}
        </nav>
        <ReportView key={def.id} def={def} />
      </div>
    </div>
  )
}

/** One report: the period picker, the table, and taking it away as Excel or PDF. Also used by the Delegates section. */
export function ReportView({ def }: { def: ReportDef }) {
  const t = useT()
  const lang = useUI((s) => s.lang)
  const actor = useSession((s) => s.actor)
  const { data: settings } = useSettings()
  const canExport = useCan('reports.export')
  const canRate = useCan('delegates.manage')
  const print = usePrint((s) => s.print)
  const [preset, setPreset] = useState<Preset>(def.preset)
  const [custom, setCustom] = useState(() => { const [a, b] = presetRange(def.preset); return { from: toInputDate(a), to: toInputDate(b) } })
  const [from, to] = preset === 'custom' ? [fromInputDate(custom.from), fromInputDate(custom.to, true)] : presetRange(preset)
  const q = useQuery({ queryKey: ['report', def.id, def.asOf ? 0 : from, def.asOf ? 0 : to], queryFn: () => runReport(def.id, from, to), placeholderData: keepPreviousData })
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null)
  const r = q.data?.type === def.id ? q.data : undefined
  const rows = useMemo(() => {
    if (!r || !sort) return r?.rows ?? []
    const c = r.columns.find((x) => x.key === sort.key)
    return c ? sortRows(r.rows, c, sort.dir, t, lang) : r.rows
  }, [r, sort, t, lang])
  const ctx: ExportCtx = { t, lang, shop: settings?.store.name ?? 'Lattafa', by: actor?.name ?? '', def }
  const [busy, setBusy] = useState(false)
  const excel = async () => {
    if (!r) return
    setBusy(true)
    try { await downloadXlsx(r, ctx) } catch (e) { toast.error(errorMessage(e, t)) } finally { setBusy(false) }
  }
  const pdf = () => { if (r) { toast.info(t('rx.pdf_hint')); print(<PrintableReport r={{ ...r, rows }} ctx={ctx} />, 'a4') } }
  const toggleSort = (c: Column) => setSort((s) => (s?.key === c.key ? (s.dir === -1 ? { key: c.key, dir: 1 } : null) : { key: c.key, dir: isNumeric(c) ? -1 : 1 }))

  return (
    <section aria-labelledby="report-title" className="min-w-0 space-y-4">
      <div>
        <h2 id="report-title" className="font-serif text-2xl font-semibold">{t(`rx.r_${def.id}`)}</h2>
        <p className="mt-1 max-w-3xl text-sm text-fg-2">{t(`rx.d_${def.id}`)}</p>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        {def.asOf ? <p className="text-sm font-medium text-fg-2">{r ? <Period r={r} ctx={ctx} /> : t('rx.as_of')}</p> : (
          <div className="flex flex-wrap items-end gap-2">
            <Chips className="flex-wrap" value={preset} onChange={setPreset} options={PRESETS.map((p) => ({ value: p, label: t(`rx.p_${p}`) }))} />
            {preset === 'custom' && (
              <div className="flex items-center gap-2">
                <Input type="date" aria-label={t('rx.from')} className="num !w-40" value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))} />
                <span className="text-fg-2">–</span>
                <Input type="date" aria-label={t('rx.to')} className="num !w-40" value={custom.to} min={custom.from} max={toInputDate(Date.now())} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))} />
              </div>
            )}
          </div>
        )}
        {canExport && (
          <div className="flex gap-2">
            <Button variant="secondary" icon={<FileSpreadsheet className="size-5" />} loading={busy} disabled={!r} onClick={excel}>{t('rx.excel')}</Button>
            <Button variant="secondary" icon={<Printer className="size-5" />} disabled={!r} onClick={pdf}>{t('rx.pdf')}</Button>
          </div>
        )}
      </div>

      {q.isError ? <Card><EmptyState title={errorMessage(q.error, t)} /></Card> : !r ? <div className="grid h-60 place-items-center"><Spinner className="size-9" /></div> : (
        <>
          {!def.asOf && <p className="text-xs text-fg-2"><Period r={r} ctx={ctx} /></p>}
          {r.summary.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {r.summary.map((s) => (
                <div key={s.label} className="rounded-2xl border border-line bg-surface p-4 shadow-soft">
                  <div className="text-xs text-fg-2">{t(s.label)}</div>
                  <div className={cn('num mt-1 font-serif text-2xl font-semibold', s.value < 0 && 'text-danger')}>
                    {cellText({ key: 'v', label: s.label, type: s.type }, { v: s.value }, t, lang)}{s.type === 'iqd' && <small className="ms-1 text-xs font-medium text-fg-2">{t('unit.iqd')}</small>}
                  </div>
                </div>
              ))}
            </div>
          )}
          <Card pad={false} className={cn('overflow-hidden', q.isFetching && 'opacity-70')}>
            {!rows.length ? <EmptyState title={t('rx.no_rows')} className="py-12" /> : (
              <div className="max-h-[70vh] overflow-auto">
                <table className="w-full min-w-max border-collapse text-sm">
                  <thead className="sticky top-0 z-10 bg-surface-2">
                    <tr>
                      {r.columns.map((c) => {
                        const on = sort?.key === c.key
                        return (
                          <th key={c.key} scope="col" aria-sort={on ? (sort!.dir === 1 ? 'ascending' : 'descending') : 'none'} className={cn('whitespace-nowrap px-3 py-2.5 font-semibold', isNumeric(c) ? 'text-end' : 'text-start')}>
                            <button type="button" onClick={() => toggleSort(c)} className="inline-flex items-center gap-1 hover:text-gold-text">
                              {/* the arrow sits on the outer side: before a number column's label, after a text column's */}
                              {on && isNumeric(c) && (sort!.dir === 1 ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />)}
                              {t(c.label)}{c.type === 'iqd' && <span className="text-[10px] font-normal text-fg-2">{t('unit.iqd')}</span>}
                              {on && !isNumeric(c) && (sort!.dir === 1 ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />)}
                            </button>
                          </th>
                        )
                      })}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {rows.map((row, i) => <ReportRow key={String(row.id ?? i)} row={row} columns={r.columns} editRate={def.id === 'delegate-commission' && canRate} onSaved={() => void q.refetch()} />)}
                  </tbody>
                  {r.totals && (
                    <tfoot className="sticky bottom-0 bg-surface-2 font-semibold">
                      <tr>
                        {r.columns.map((c, i) => (
                          <td key={c.key} className={cn('whitespace-nowrap border-t-2 border-line px-3 py-2.5', isNumeric(c) && 'num text-end')}>
                            {i === 0 ? t('rx.total') : r.totals![c.key] !== undefined ? cellText(c, r.totals!, t, lang) : ''}
                          </td>
                        ))}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </Card>
          <p className="text-xs text-fg-2">{t('rx.rows_n', { n: rows.length })}{canExport ? ` · ${t('rx.pdf_hint')}` : ''}</p>
        </>
      )}
    </section>
  )
}

function ReportRow({ row, columns, editRate, onSaved }: { row: Row; columns: Column[]; editRate: boolean; onSaved: () => void }) {
  const t = useT()
  const lang = useUI((s) => s.lang)
  return (
    <tr className={cn('hover:bg-surface-2/50', (row.kind === 'subtotal' || row.kind === 'total') && 'font-semibold', row.kind === 'total' && 'bg-gold-soft/60 dark:bg-gold/10')}>
      {columns.map((c) => {
        const v = row[c.key]
        const negative = (c.type === 'iqd' || c.type === 'money') && typeof v === 'number' && v < 0
        return (
          <td key={c.key} className={cn('whitespace-nowrap px-3 py-2', isNumeric(c) && 'num text-end', negative && 'text-danger', row.kind === 'expense' && c.type === 'label' && 'ps-8 text-fg-2')}>
            {editRate && c.key === 'rate' && row.id ? <RateInput id={row.id} value={Number(v ?? 0)} onSaved={onSaved} label={`${t(c.label)} · ${String(row.delegate ?? '')}`} /> : <CellContent c={c} row={row} ctx={{ t, lang }} />}
          </td>
        )
      })}
    </tr>
  )
}

/** A delegate's commission %, saved when the box is left (or Enter is pressed). */
function RateInput({ id, value, label, onSaved }: { id: string; value: number; label: string; onSaved: () => void }) {
  const [v, setV] = useState(String(value))
  const run = useAction(setCommission, { success: 'rx.rate_saved' })
  const save = async () => {
    const n = Number(v)
    if (!Number.isFinite(n) || n === value) { setV(String(value)); return }
    if (await run(id, n)) onSaved()
  }
  return (
    <span className="inline-flex items-center gap-1">
      <Input aria-label={label} inputMode="decimal" className="num !h-9 !w-20 text-end" value={v} disabled={run.busy}
        onChange={(e) => setV(e.target.value.replace(/[^\d.]/g, ''))} onBlur={() => void save()} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
      %
    </span>
  )
}
