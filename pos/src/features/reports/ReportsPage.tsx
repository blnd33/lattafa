import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, Printer } from 'lucide-react'
import { Amt } from '@/components/ui/Amt'
import { Card, EmptyState, PageHeader, Segmented, Spinner, Stat } from '@/components/ui/Controls'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Field'
import { usePrint } from '@/components/PrintHost'
import { useT } from '@/i18n'
import { fromInputDate, toInputDate } from '@/lib/date'
import { fmt } from '@/lib/money'
import { downloadText } from '@/lib/image'
import { debtors, endOfDay, lowStock, salesReport, startOfDay, type SalesReport } from '@/services/reports'
import { listSales } from '@/services/sales'
import { useUsers } from '@/hooks/queries'
import { useCan } from '@/hooks/useAuth'

type Preset = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'custom'
const DAY = 86_400_000

function rangeFor(p: Preset, from: string, to: string): [number, number] {
  const now = Date.now()
  switch (p) {
    case 'today': return [startOfDay(now), endOfDay(now)]
    case 'yesterday': return [startOfDay(now - DAY), endOfDay(now - DAY)]
    case '7d': return [startOfDay(now - 6 * DAY), endOfDay(now)]
    case '30d': return [startOfDay(now - 29 * DAY), endOfDay(now)]
    case 'month': { const d = new Date(); return [new Date(d.getFullYear(), d.getMonth(), 1).getTime(), endOfDay(now)] }
    default: return [fromInputDate(from), fromInputDate(to, true)]
  }
}

export function ReportsPage() {
  const t = useT()
  const canExport = useCan('reports.export')
  const [preset, setPreset] = useState<Preset>('7d')
  const [from, setFrom] = useState(toInputDate(Date.now() - 6 * DAY))
  const [to, setTo] = useState(toInputDate(Date.now()))
  const [userId, setUserId] = useState('')
  const { data: users } = useUsers()
  const [a, b] = useMemo(() => rangeFor(preset, from, to), [preset, from, to])
  const { data: r, isLoading } = useQuery({ queryKey: ['report', a, b, userId], queryFn: () => salesReport(a, b, { userId: userId || undefined }) })
  const { data: low } = useQuery({ queryKey: ['lowstock'], queryFn: lowStock })
  const { data: debts } = useQuery({ queryKey: ['debtors'], queryFn: debtors })

  const exportCsv = async () => {
    const sales = await listSales({ from: a, to: b, userId: userId || undefined, limit: 5000 })
    const head = ['number', 'date', 'cashier', 'customer', 'status', 'subtotal', 'discount', 'total', 'paid', 'due']
    const lines = sales.map((s) => [s.number, new Date(s.createdAt).toISOString(), s.userName, s.customerName, s.status, s.subtotalIQD, s.itemDiscountIQD + s.orderDiscountIQD, s.totalIQD, s.paidIQD, s.dueIQD].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
    downloadText(`lattafa-sales-${toInputDate(a)}_${toInputDate(b)}.csv`, '﻿' + [head.join(','), ...lines].join('\r\n'))
  }
  const print = () => r && usePrint.getState().print(<PrintableReport r={r} />, 'a4')

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
      <PageHeader title={t('rep.title')} subtitle={t('rep.subtitle')} actions={canExport && <><Button variant="secondary" size="lg" icon={<Download className="size-5" />} onClick={exportCsv}>{t('rep.export_csv')}</Button><Button variant="secondary" size="lg" icon={<Printer className="size-5" />} disabled={!r} onClick={print}>{t('rep.print')}</Button></>} />
      <div className="flex flex-wrap items-center gap-2.5">
        <Segmented value={preset} onChange={setPreset} options={(['today', 'yesterday', '7d', '30d', 'month', 'custom'] as Preset[]).map((p) => ({ value: p, label: t(`rep.range_${p}`) }))} />
        {preset === 'custom' && <><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="num w-40" aria-label={t('rep.from')} /><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="num w-40" aria-label={t('rep.to')} /></>}
        <Select value={userId} onChange={(e) => setUserId(e.target.value)} className="w-48" aria-label={t('sales.cashier')}><option value="">{t('sales.all_cashiers')}</option>{(users ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
      </div>

      {isLoading || !r ? <div className="grid place-items-center py-16"><Spinner className="size-9" /></div> : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat tone="gold" label={t('rep.net')} value={<Amt n={r.netIQD} />} sub={`${t('rep.gross')}: ${fmt(r.revenueIQD)}`} />
            <Stat label={t('rep.sales_count')} value={<span className="num">{r.count}</span>} sub={`${t('rep.avg_basket')}: ${fmt(r.avgBasketIQD)}`} />
            <Stat label={t('rep.units')} value={<span className="num">{r.unitsSold}</span>} />
            <Stat label={t('rep.discounts')} value={<Amt n={r.discountIQD} />} sub={`${t('rep.refunds')}: ${fmt(r.refundsIQD)}`} />
            {r.profitIQD !== null && <Stat tone="ok" label={t('rep.profit')} value={<Amt n={r.profitIQD} />} sub={`${t('rep.cost')}: ${fmt(r.costIQD ?? 0)}`} />}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card><h3 className="mb-3 font-semibold">{t('rep.by_day')}</h3>{r.byDay.length ? <Bars data={r.byDay.map((d) => ({ label: d.day.slice(5), value: d.revenueIQD }))} /> : <EmptyState title={t('rep.no_data')} className="py-6" />}</Card>
            <Card><h3 className="mb-3 font-semibold">{t('rep.by_hour')}</h3>{r.byHour.length ? <Bars data={r.byHour.map((h) => ({ label: String(h.hour), value: h.revenueIQD }))} /> : <EmptyState title={t('rep.no_data')} className="py-6" />}</Card>
            <Card><h3 className="mb-3 font-semibold">{t('rep.by_method')}</h3><HBars rows={r.byMethod.map((m) => ({ label: t(`method.${m.method}`), value: m.amountIQD }))} /></Card>
            <Card><h3 className="mb-3 font-semibold">{t('rep.by_cashier')}</h3><HBars rows={r.byCashier.map((c) => ({ label: c.name, value: c.revenueIQD, sub: `${c.count}` }))} /></Card>
            <Card><h3 className="mb-3 font-semibold">{t('rep.top_products')}</h3><HBars rows={r.topProducts.map((p) => ({ label: p.name, value: p.revenueIQD, sub: `×${p.units}` }))} /></Card>
            <Card><h3 className="mb-3 font-semibold">{t('rep.by_brand')}</h3><HBars rows={r.byBrand.map((p) => ({ label: p.brand, value: p.revenueIQD, sub: `×${p.units}` }))} /></Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card pad={false}>
              <h3 className="border-b border-line px-4 py-3 font-semibold">{t('rep.low_stock')}</h3>
              {!low?.length ? <p className="p-5 text-sm text-fg-2">{t('rep.all_good')}</p> : <ul className="max-h-72 divide-y divide-line overflow-y-auto">{low.map((l) => <li key={l.variantId} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"><span className="min-w-0 truncate">{l.productName} <span className="num text-fg-2">{l.label}</span></span><span className="num font-bold text-warn-fg">{l.qty} / {l.minStock}</span></li>)}</ul>}
            </Card>
            <Card pad={false}>
              <h3 className="border-b border-line px-4 py-3 font-semibold">{t('rep.debtors')}</h3>
              {!debts?.length ? <p className="p-5 text-sm text-fg-2">{t('rep.no_debts')}</p> : <ul className="max-h-72 divide-y divide-line overflow-y-auto">{debts.map((d) => <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"><span className="min-w-0 truncate">{d.name}</span><Amt n={d.balanceIQD} className="font-bold text-danger" /></li>)}</ul>}
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

/** Compact SVG column chart with a value tooltip on every bar. */
function Bars({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value))
  const W = Math.max(280, data.length * 44)
  return (
    <div className="overflow-x-auto scroll-hide">
      <svg viewBox={`0 0 ${W} 170`} className="h-44 w-full" style={{ minWidth: Math.min(W, 560) }} role="img">
        {[0.25, 0.5, 0.75, 1].map((g) => <line key={g} x1={0} x2={W} y1={140 - g * 120} y2={140 - g * 120} className="stroke-line" strokeDasharray="3 4" />)}
        {data.map((d, i) => {
          const h = (d.value / max) * 120
          const x = i * (W / data.length) + 6
          const w = W / data.length - 12
          return (
            <g key={d.label + i}>
              <rect x={x} y={140 - h} width={w} height={Math.max(2, h)} rx={5} className="fill-gold"><title>{`${d.label}: ${fmt(d.value)}`}</title></rect>
              <text x={x + w / 2} y={158} textAnchor="middle" className="fill-fg-2 text-[10px]" style={{ fontFamily: 'Poppins' }}>{d.label}</text>
              {h > 16 && <text x={x + w / 2} y={140 - h - 4} textAnchor="middle" className="fill-fg text-[9px] font-semibold" style={{ fontFamily: 'Poppins' }}>{d.value >= 1_000_000 ? `${(d.value / 1_000_000).toFixed(1)}M` : `${Math.round(d.value / 1000)}k`}</text>}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function HBars({ rows }: { rows: { label: string; value: number; sub?: string }[] }) {
  const t = useT()
  if (!rows.length) return <EmptyState title={t('rep.no_data')} className="py-6" />
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <ul className="space-y-3">
      {rows.map((r, i) => (
        <li key={r.label + i}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm"><span className="min-w-0 truncate">{r.label}{r.sub && <span className="num ms-1.5 text-xs text-fg-2">{r.sub}</span>}</span><Amt n={r.value} className="shrink-0 font-semibold" /></div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-gradient-to-r from-gold-light to-gold-dark" style={{ width: `${Math.max(3, (r.value / max) * 100)}%` }} /></div>
        </li>
      ))}
    </ul>
  )
}

function PrintableReport({ r }: { r: SalesReport }) {
  const t = useT()
  return (
    <div className="p-4 font-sans text-[12px] text-black">
      <h1 className="font-serif text-2xl font-semibold">Lattafa — {t('rep.title')}</h1>
      <p className="num mb-4 text-xs">{toInputDate(r.from)} → {toInputDate(r.to)}</p>
      <table className="w-full border-collapse text-sm"><tbody>
        {([['rep.gross', r.revenueIQD], ['rep.discounts', r.discountIQD], ['rep.refunds', r.refundsIQD], ['rep.net', r.netIQD], ['rep.sales_count', r.count], ['rep.units', r.unitsSold], ['rep.avg_basket', r.avgBasketIQD]] as const).map(([k, v]) => <tr key={k} className="border-b border-black/20"><td className="py-1.5">{t(k)}</td><td className="num py-1.5 text-end font-semibold">{fmt(v)}</td></tr>)}
        {r.profitIQD !== null && <tr className="border-b border-black/20"><td className="py-1.5">{t('rep.profit')}</td><td className="num py-1.5 text-end font-semibold">{fmt(r.profitIQD)}</td></tr>}
      </tbody></table>
      <h2 className="mb-1 mt-5 font-semibold">{t('rep.top_products')}</h2>
      <table className="w-full border-collapse text-sm"><tbody>{r.topProducts.map((p) => <tr key={p.productId} className="border-b border-black/10"><td className="py-1">{p.name}</td><td className="num py-1 text-end">×{p.units}</td><td className="num py-1 text-end">{fmt(p.revenueIQD)}</td></tr>)}</tbody></table>
    </div>
  )
}
