import { useEffect, useRef } from 'react'
import { Cloud, CloudOff, Printer, Plus, Check } from 'lucide-react'
import { Barcode, Logo, QrCode } from '@/components/ui/Brand'
import { Amt } from '@/components/ui/Amt'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { cn } from '@/components/ui/cn'
import { usePrint } from '@/components/PrintHost'
import { pick, useT, translate } from '@/i18n'
import type { AppSettings, Lang, Sale } from '@/data/types'
import { fmtDateTime } from '@/lib/date'
import { fmt, fmtUSD } from '@/lib/money'
import { useOnline } from '@/hooks/useDevice'
import { useSettings } from '@/hooks/queries'
import { useUI } from '@/store/ui'

/**
 * The printed/on-screen receipt. Black on white and sized for a 58 mm or 80 mm
 * thermal roll; everything is real text (not an image) so Arabic/Kurdish print
 * crisply. Trilingual footer comes from Settings → Receipt.
 */
export function ReceiptView({ sale, settings, lang, className }: { sale: Sale; settings: AppSettings; lang: Lang; className?: string }) {
  const tr = (k: string, v?: Record<string, string | number>) => translate(lang, k, v)
  const r = settings.receipt
  const narrow = r.paperMm === 58
  const dir = lang === 'en' ? 'ltr' : 'rtl'
  const change = sale.changeIQD
  return (
    <div
      dir={dir}
      className={cn('mx-auto bg-white font-sans font-semibold text-black',
        // the side padding leaves the roll's unprintable edge alone: ~48 mm of ink on 58 mm paper, ~72 mm on 80 mm
        narrow ? 'w-[58mm] max-w-full px-[5mm] py-[4mm] text-[11px]' : 'w-[80mm] max-w-full px-[4mm] py-[4mm] text-[12px]',
        'leading-snug', className)}
      style={{ printColorAdjust: 'exact' }}
    >
      <div className="text-center">
        {r.showLogo && <Logo mono className="mx-auto mb-1 h-16" />}
        <div className="font-serif text-xl font-bold tracking-widest">{settings.store.name.toUpperCase()}</div>
        {settings.store.tagline && <div>{settings.store.tagline}</div>}
        {settings.store.address && <div>{settings.store.address}</div>}
        {settings.store.phone && <div className="num">{settings.store.phone}</div>}
        {r.header && <div className="mt-1 whitespace-pre-line">{r.header}</div>}
      </div>
      <Hr />
      <div className="flex justify-between font-semibold"><span className="num">{sale.number}</span><span className="num">{fmtDateTime(sale.createdAt)}</span></div>
      <div className="flex justify-between"><span>{tr('receipt.cashier')}: {sale.userName}</span><span>{sale.customerName || tr('sell.walk_in')}</span></div>
      <Hr />
      <ul className="space-y-1.5">
        {sale.items.map((it, i) => (
          <li key={i}>
            <div className="flex justify-between gap-2 font-semibold"><span className="min-w-0">{pick(it.name, lang)} <span className="num">{it.label}</span></span><span className="num shrink-0">{fmt(it.lineTotalIQD)}</span></div>
            <div className="num flex justify-between text-[0.92em]"><span>{it.qty} × {fmt(it.unitPriceIQD)}</span>{it.discountIQD > 0 && <span>−{it.discountPct}% (−{fmt(it.discountIQD)})</span>}</div>
          </li>
        ))}
      </ul>
      <Hr />
      <Line label={tr('sell.subtotal')} value={fmt(sale.subtotalIQD)} />
      {sale.itemDiscountIQD > 0 && <Line label={tr('sell.item_discounts')} value={`−${fmt(sale.itemDiscountIQD)}`} />}
      {sale.orderDiscountIQD > 0 && <Line label={tr('sell.order_discount')} value={`−${fmt(sale.orderDiscountIQD)}`} />}
      {sale.pointsRedeemedIQD > 0 && <Line label={`${tr('sell.points_used')} (${sale.pointsRedeemed})`} value={`−${fmt(sale.pointsRedeemedIQD)}`} />}
      {sale.taxIQD > 0 && <Line label={tr('sell.tax')} value={fmt(sale.taxIQD)} />}
      {sale.giftWrapIQD > 0 && <Line label={tr('sell.gift_wrap')} value={fmt(sale.giftWrapIQD)} />}
      {sale.roundingIQD !== 0 && <Line label={tr('receipt.rounding')} value={`${sale.roundingIQD > 0 ? '+' : '−'}${fmt(Math.abs(sale.roundingIQD))}`} />}
      <div className="mt-1 flex items-baseline justify-between border-t border-black pt-1 text-[1.35em] font-bold"><span>{tr('sell.total')}</span><span className="num">{fmt(sale.totalIQD)} {tr('unit.iqd_short')}</span></div>
      {settings.currency.usdEnabled && <Line label={`≈ USD @ ${fmt(sale.exchangeRate)}`} value={`$${fmtUSD(sale.totalIQD / sale.exchangeRate)}`} muted />}
      <Hr />
      {sale.payments.map((p, i) => (
        <Line key={i} label={`${tr(`method.${p.method}`)}${p.currency === 'USD' ? ` ($${fmtUSD(p.tendered)})` : ''}${p.reference ? ` · ${p.reference}` : ''}`} value={fmt(p.amountIQD)} />
      ))}
      {change > 0 && <Line label={tr('pay.change')} value={fmt(change)} bold />}
      {sale.dueIQD > 0 && <Line label={tr('receipt.on_account')} value={fmt(sale.dueIQD)} bold />}
      {sale.pointsEarned > 0 && <div className="mt-1 text-center">{tr('receipt.points_earned', { n: sale.pointsEarned })}</div>}
      {sale.note && <div className="mt-1">{tr('sell.note')}: {sale.note}</div>}
      <Hr />
      <div className="text-center">
        <Barcode value={sale.number} height={38} className="w-full" />
        {r.showQr && r.qrUrl && (
          <div className="mt-2 flex flex-col items-center gap-1">
            <QrCode value={r.qrUrl} className="size-20" />
            <span className="text-[0.9em]">{tr('receipt.scan_menu')}</span>
          </div>
        )}
        <div className="mt-2 space-y-0.5 font-semibold">
          {(['ar', 'ku', 'en'] as Lang[]).map((l) => r.footer[l] && <div key={l} dir={l === 'en' ? 'ltr' : 'rtl'}>{r.footer[l]}</div>)}
        </div>
        <div className="mt-2 text-[0.85em]" dir="ltr">Developed by Coda Agency · +964 750 730 8005</div>
      </div>
      {sale.status === 'voided' && <div className="mt-2 border-2 border-black py-1 text-center text-base font-bold tracking-widest">{tr('sales.voided').toUpperCase()}</div>}
    </div>
  )
}

const Hr = () => <div className="my-2 border-t border-black" />
function Line({ label, value, bold, muted }: { label: string; value: string; bold?: boolean; muted?: boolean }) {
  return <div className={cn('flex justify-between gap-2', bold && 'font-bold', muted && 'text-[0.95em]')}><span>{label}</span><span className="num shrink-0">{value}</span></div>
}

/** Send a receipt to the printer (58/80 mm roll), honouring the "copies" setting. */
export function printReceipt(sale: Sale, settings: AppSettings, lang: Lang) {
  const copies = Math.max(1, Math.min(5, settings.receipt.copies || 1))
  const node = (
    <>
      {Array.from({ length: copies }).map((_, i) => (
        <div key={i} style={{ breakAfter: i < copies - 1 ? 'page' : 'auto' }}>
          <ReceiptView sale={sale} settings={settings} lang={lang} />
        </div>
      ))}
    </>
  )
  usePrint.getState().print(node, String(settings.receipt.paperMm) as '58' | '80')
}

/**
 * Shown right after a sale (celebratory, with the change to hand back) and reused
 * from Sales history (`mode="view"`) for reprints.
 */
export function ReceiptModal({ sale, onClose, mode = 'done', actions }: { sale: Sale | null; onClose: () => void; mode?: 'done' | 'view'; actions?: React.ReactNode }) {
  const t = useT()
  const lang = useUI((s) => s.lang)
  const { data: settings } = useSettings()
  const online = useOnline()
  const printedFor = useRef<string | null>(null)

  useEffect(() => {
    if (mode !== 'done' || !sale || !settings || !settings.receipt.autoPrint) return
    if (printedFor.current === sale.id) return
    printedFor.current = sale.id
    printReceipt(sale, settings, lang)
  }, [sale, settings, lang, mode])

  if (!sale || !settings) return null
  const done = mode === 'done'
  return (
    <Modal
      open
      onClose={onClose}
      title={done ? t('receipt.done_title') : `${t('receipt.title')} ${sale.number}`}
      size={done ? 'lg' : 'md'}
      dismissible
      bodyClassName="p-0"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {actions}
          <Button size="lg" variant={done ? 'secondary' : 'primary'} icon={<Printer className="size-5" />} onClick={() => printReceipt(sale, settings, lang)}>{t('receipt.print')}</Button>
          {done && <Button size="lg" variant="primary" icon={<Plus className="size-5" />} onClick={onClose} data-autofocus>{t('receipt.new_sale')}</Button>}
        </div>
      }
    >
      <div className={cn('grid', done && 'md:grid-cols-[1fr_22.5rem]')}>
        {done && (
          <div className="order-2 flex flex-col justify-center gap-4 p-6 md:order-1">
            <span className="grid size-16 place-items-center rounded-full bg-ok-bg text-ok-fg"><Check className="size-8" strokeWidth={2.6} /></span>
            <div>
              <div className="font-serif text-3xl font-semibold">{t('receipt.done_title')}</div>
              <div className="num mt-1 text-fg-2">{sale.number}</div>
            </div>
            {sale.changeIQD > 0 && (
              <div className="rounded-2xl bg-ok-bg p-4 text-ok-fg">
                <div className="text-sm font-medium">{t('pay.give_change')}</div>
                <Amt n={sale.changeIQD} className="font-serif text-4xl font-semibold" />
              </div>
            )}
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm text-fg-2">
              <dt>{t('sell.total')}</dt><dd className="font-semibold text-fg"><Amt n={sale.totalIQD} /></dd>
              <dt>{t('pay.received')}</dt><dd className="font-semibold text-fg"><Amt n={sale.paidIQD + sale.changeIQD} /></dd>
              {sale.dueIQD > 0 && <><dt>{t('receipt.on_account')}</dt><dd className="font-semibold text-danger"><Amt n={sale.dueIQD} /></dd></>}
            </dl>
            <p className={cn('flex items-start gap-2 rounded-xl p-3 text-sm', online ? 'bg-surface-2 text-fg-2' : 'bg-warn-bg text-warn-fg')}>
              {online ? <Cloud className="mt-0.5 size-4 shrink-0" /> : <CloudOff className="mt-0.5 size-4 shrink-0" />}
              {online ? t('receipt.saved_local') : t('receipt.saved_offline')}
            </p>
          </div>
        )}
        <div className={cn('order-1 bg-surface-2 p-4 md:order-2', done && 'md:max-h-[60dvh] md:overflow-y-auto')}>
          <div className="mx-auto w-fit shadow-soft"><ReceiptView sale={sale} settings={settings} lang={lang} /></div>
        </div>
      </div>
    </Modal>
  )
}
