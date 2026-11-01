import type { Lang } from '@/data/types'
import { isRtl, type TFn } from '@/i18n'
import { fmtDate, fmtDateTime } from '@/lib/date'
import { downloadBlob } from '@/lib/image'
import { writeXlsx, type CellValue, type SheetColumn } from '@/lib/xlsx'
import { Logo } from '@/components/ui/Brand'
import { cn } from '@/components/ui/cn'
import { Credit } from '@/components/layout/Chrome'
import type { Column, ReportDef, ReportTable } from './api'
import { MapPin } from 'lucide-react'
import { cellText, cellValue, isDateLike, isNumeric, mapUrl } from './format'

export interface ExportCtx { t: TFn; lang: Lang; shop: string; by: string; def: ReportDef }

/** The period on screen and on paper, with each date kept as one left-to-right piece. */
export function Period({ r, ctx }: { r: ReportTable; ctx: ExportCtx }) {
  if (ctx.def.asOf) return <>{ctx.t('rx.as_of')} <span className="num">{fmtDateTime(Date.now())}</span></>
  return <><span className="num">{fmtDate(r.from)}</span> – <span className="num">{fmtDate(r.to)}</span></>
}

/** A table cell's content: dates isolated so they read correctly in right-to-left text. */
export function CellContent({ c, row, ctx }: { c: Column; row: ReportTable['rows'][number]; ctx: Pick<ExportCtx, 't' | 'lang'> }) {
  const text = cellText(c, row, ctx.t, ctx.lang)
  // where a delegate sold: a link to the spot (on paper it reads as the coordinates)
  if (c.type === 'map' && row[c.key]) {
    return (
      <a href={mapUrl(String(row[c.key]))} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-gold-text underline-offset-2 hover:underline print:text-inherit">
        <MapPin className="size-3.5 print:hidden" aria-hidden /><span className="print:hidden">{ctx.t('rx.open_map')}</span><span className="num hidden print:inline">{text}</span>
      </a>
    )
  }
  if (c.type === 'items') return <span className="block min-w-48 whitespace-normal">{text}</span>
  return isDateLike(c) ? <span className="num">{text}</span> : <>{text}</>
}

/** "1 Oct 2026 – 31 Oct 2026", or "as of 10 Oct 2026, 14:05" for a snapshot. */
export const periodText = (r: ReportTable, ctx: ExportCtx) =>
  ctx.def.asOf ? `${ctx.t('rx.as_of')} ${fmtDateTime(Date.now())}` : ctx.t('rx.period', { from: fmtDate(r.from), to: fmtDate(r.to) })

/** The file name: lattafa-sales-by-day-2026-10-01-2026-10-31.xlsx */
export function fileName(r: ReportTable, def: ReportDef, ext: string): string {
  const d = (ms: number) => { const x = new Date(ms); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }
  return `lattafa-${r.type}-${def.asOf ? d(Date.now()) : `${d(r.from)}-${d(r.to)}`}.${ext}`
}

/** Excel: the table on the first sheet (header frozen, totals in bold, numbers as numbers), the details on a second. */
export async function downloadXlsx(r: ReportTable, ctx: ExportCtx): Promise<void> {
  const { t, lang } = ctx
  // a money column carries its currency in the next column, so dollar and dinar amounts are never mixed up
  const cols: (Column | { key: string; label: string; type: 'currency' })[] = r.columns.flatMap((c) => (c.type === 'money' ? [c, { key: `${c.key}__cur`, label: 'rc.currency', type: 'currency' as const }] : [c]))
  const value = (c: (typeof cols)[number], row: ReportTable['rows'][number]): CellValue => (c.type === 'currency' ? (row.currency ?? 'IQD') : cellValue(c as Column, row, t, lang))
  const header = cols.map((c) => t(c.label))
  const body = r.rows.map((row) => cols.map((c) => value(c, row)))
  const rows: CellValue[][] = [header, ...body]
  const bold: number[] = r.rows.map((row, i) => (row.kind === 'subtotal' || row.kind === 'total' ? i + 1 : -1)).filter((i) => i > 0)
  if (r.totals) {
    rows.push(cols.map((c, i) => (i === 0 ? t('rx.total') : c.type !== 'currency' && r.totals![c.key] !== undefined ? cellValue(c as Column, r.totals!, t, lang) : null)))
    bold.push(rows.length - 1)
  }
  const width = (c: (typeof cols)[number]): SheetColumn => {
    if (c.type === 'name' || c.type === 'label' || c.key === 'note') return { width: 34 }
    if (c.type === 'items' || c.type === 'map') return { width: c.type === 'items' ? 50 : 30 }
    if (c.type === 'text' || c.type.startsWith('enum:')) return { width: 20, text: c.key === 'sku' || c.key === 'phone' }
    if (c.type === 'currency') return { width: 10 }
    return { width: 15, number: isNumeric(c as Column) }
  }
  const about: CellValue[][] = [
    [t(`rx.r_${r.type}`)], [ctx.shop], [periodText(r, ctx)], [t('rx.generated', { date: fmtDateTime(Date.now()), name: ctx.by })], [],
    [t(`rx.d_${r.type}`)],
  ]
  const blob = await writeXlsx([
    { name: t('rx.sheet_report').slice(0, 31), columns: cols.map(width), rows, bold, rtl: isRtl(lang) },
    { name: t('rx.sheet_about').slice(0, 31), columns: [{ width: 90 }], rows: about, header: false, bold: [0], rtl: isRtl(lang) },
  ])
  downloadBlob(fileName(r, ctx.def, 'xlsx'), blob)
}

/** The A4 page for "PDF / print": the shop and report at the top, the table (its header repeats on every page), the credit. */
export function PrintableReport({ r, ctx }: { r: ReportTable; ctx: ExportCtx }) {
  const { t, lang } = ctx
  return (
    <div dir={isRtl(lang) ? 'rtl' : 'ltr'} className="bg-white text-[10.5px] leading-snug text-black">
      <header className="mb-3 flex items-start justify-between gap-4 border-b-2 border-[#D4A548] pb-2">
        <div className="flex items-center gap-2"><Logo className="h-10" /><div><div className="font-serif text-base font-semibold">{ctx.shop}</div><div className="text-[9px] text-neutral-500">{t('rx.generated', { date: fmtDateTime(Date.now()), name: ctx.by })}</div></div></div>
        <div className="text-end"><div className="font-serif text-lg font-semibold">{t(`rx.r_${r.type}`)}</div><div className="text-neutral-600"><Period r={r} ctx={ctx} /></div></div>
      </header>
      {r.summary.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {r.summary.map((s) => (
            <div key={s.label} className="rounded border border-neutral-300 px-2 py-1"><div className="text-[9px] text-neutral-500">{t(s.label)}</div><div className="num font-semibold">{cellText({ key: 'v', label: s.label, type: s.type }, { v: s.value }, t, lang)}{s.type === 'iqd' ? ` ${t('unit.iqd')}` : ''}</div></div>
          ))}
        </div>
      )}
      <table className="w-full border-collapse">
        <thead>
          <tr>{r.columns.map((c) => <th key={c.key} className={cn('border-b border-neutral-400 px-1 py-1 text-start font-semibold', isNumeric(c) && 'text-end')}>{t(c.label)}{c.type === 'iqd' ? ` (${t('unit.iqd')})` : ''}</th>)}</tr>
        </thead>
        <tbody>
          {r.rows.map((row, i) => (
            <tr key={String(row.id ?? i)} className={cn('break-inside-avoid', (row.kind === 'subtotal' || row.kind === 'total') && 'font-semibold', row.kind === 'total' && 'border-t-2 border-black')}>
              {r.columns.map((c) => <td key={c.key} className={cn('border-b border-neutral-200 px-1 py-[3px] align-top', isNumeric(c) && 'num text-end', row.kind === 'expense' && c.type === 'label' && 'ps-4')}><CellContent c={c} row={row} ctx={ctx} /></td>)}
            </tr>
          ))}
        </tbody>
        {r.totals && (
          <tfoot>
            <tr className="font-semibold">{r.columns.map((c, i) => <td key={c.key} className={cn('border-t-2 border-black px-1 py-1', isNumeric(c) && 'num text-end')}>{i === 0 ? t('rx.total') : r.totals![c.key] !== undefined ? cellText(c, r.totals!, t, lang) : ''}</td>)}</tr>
          </tfoot>
        )}
      </table>
      <Credit className="mt-4 !text-[9px]" />
    </div>
  )
}
