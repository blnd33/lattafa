import { Logo } from '@/components/ui/Brand'
import { usePrint } from '@/components/PrintHost'
import { translate } from '@/i18n'
import type { AppSettings, Lang, Shift, ShiftTotals } from '@/data/types'
import { fmtDateTime } from '@/lib/date'
import { fmt, fmtUSD } from '@/lib/money'

/** X (mid-shift) and Z (closed) report, printable on the thermal roll. */
export function ShiftReport({ shift, totals, settings, lang }: { shift: Shift; totals: ShiftTotals; settings: AppSettings; lang: Lang }) {
  const tr = (k: string) => translate(lang, k)
  const closed = shift.status === 'closed'
  const narrow = settings.receipt.paperMm === 58
  const methods = Object.entries(totals.byMethod).filter(([k]) => !k.startsWith('collection_'))
  return (
    <div dir={lang === 'en' ? 'ltr' : 'rtl'} className={`mx-auto bg-white p-3 font-sans text-black leading-snug ${narrow ? 'w-[58mm] text-[10px]' : 'w-[80mm] text-[11px]'}`}>
      <div className="text-center">
        {settings.receipt.showLogo && <Logo mono className="mx-auto mb-1 h-14" />}
        <div className="font-serif text-base font-semibold tracking-widest">{settings.store.name.toUpperCase()}</div>
        <div className="mt-1 text-sm font-bold">{closed ? tr('shift.z_report') : tr('shift.x_report')}</div>
      </div>
      <Hr />
      <L a={tr('receipt.cashier')} b={shift.userName} />
      <L a={tr('shift.opened')} b={fmtDateTime(shift.openedAt)} num />
      {shift.closedAt && <L a={tr('shift.closed')} b={fmtDateTime(shift.closedAt)} num />}
      <Hr />
      <L a={tr('shift.sales_count')} b={String(totals.salesCount)} num />
      <L a={tr('shift.sales_total')} b={fmt(totals.salesIQD)} num bold />
      <Hr />
      {methods.map(([k, v]) => <L key={k} a={tr(`method.${k}`)} b={fmt(v)} num />)}
      <Hr />
      <L a={tr('shift.opening_float')} b={fmt(shift.openingIQD)} num />
      <L a={tr('shift.cash_sales')} b={fmt(totals.cashIQD)} num />
      {totals.cashUSD > 0 && <L a={tr('shift.usd_received')} b={`$${fmtUSD(totals.cashUSD)}`} num />}
      {totals.collectionsIQD > 0 && <L a={tr('shift.collections')} b={fmt(totals.collectionsIQD)} num />}
      {totals.cashInIQD > 0 && <L a={tr('shift.cash_in')} b={fmt(totals.cashInIQD)} num />}
      {totals.cashOutIQD > 0 && <L a={tr('shift.cash_out')} b={`−${fmt(totals.cashOutIQD)}`} num />}
      {totals.refundsIQD > 0 && <L a={tr('shift.refunds')} b={`−${fmt(totals.refundsIQD)}`} num />}
      <L a={tr('shift.expected_iqd')} b={fmt(totals.expectedIQD)} num bold />
      {(shift.openingUSD > 0 || totals.cashUSD > 0) && <L a={tr('shift.expected_usd')} b={`$${fmtUSD(totals.expectedUSD)}`} num bold />}
      {closed && (
        <>
          <Hr />
          <L a={tr('shift.counted_iqd')} b={fmt(shift.countedIQD ?? 0)} num />
          {(shift.countedUSD ?? 0) > 0 && <L a={tr('shift.counted_usd')} b={`$${fmtUSD(shift.countedUSD ?? 0)}`} num />}
          <L a={tr('shift.variance')} b={`${(shift.varianceIQD ?? 0) > 0 ? '+' : ''}${fmt(shift.varianceIQD ?? 0)}`} num bold />
          {shift.note && <div className="mt-1 opacity-80">{shift.note}</div>}
        </>
      )}
      <div className="mt-6 flex justify-between gap-6 text-[0.9em]"><span className="flex-1 border-t border-black pt-1 text-center">{tr('receipt.cashier')}</span><span className="flex-1 border-t border-black pt-1 text-center">{tr('shift.manager')}</span></div>
    </div>
  )
}

const Hr = () => <div className="my-2 border-t border-dashed border-black/60" />
function L({ a, b, num, bold }: { a: string; b: string; num?: boolean; bold?: boolean }) {
  return <div className={`flex justify-between gap-2 ${bold ? 'font-bold' : ''}`}><span>{a}</span><span className={`shrink-0 ${num ? 'num' : ''}`}>{b}</span></div>
}

export function printShiftReport(shift: Shift, totals: ShiftTotals, settings: AppSettings, lang: Lang) {
  usePrint.getState().print(<ShiftReport shift={shift} totals={totals} settings={settings} lang={lang} />, String(settings.receipt.paperMm) as '58' | '80')
}
