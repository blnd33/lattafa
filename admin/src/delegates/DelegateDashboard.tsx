import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Banknote, HandCoins, MapPin, Package, ShoppingBag, Truck } from 'lucide-react'
import { Card, EmptyState, Segmented, Spinner } from '@/components/ui/Controls'
import { cn } from '@/components/ui/cn'
import { pick, plural, useT } from '@/i18n'
import { fmt } from '@/lib/money'
import { api } from '@/services/api'
import { useUI } from '@/store/ui'
import type { Lang } from '@/data/types'

type Range = 'today' | '7d' | '30d' | 'all'

interface Dashboard {
  delegate: { id: string; name: string; color: string }
  soldIQD: number
  salesCount: number
  units: number
  collectedIQD: number
  owedIQD: number
  dueIQD: number
  visits: number
  carrying: { sizes: number; units: number; valueIQD: number }
  shops: { customerId: string | null; name: string | null; sales: number; totalIQD: number; owedIQD: number }[]
  moved: { variantId: string; name: Record<Lang, string> | string; label: string; qty: number; totalIQD: number }[]
}

const SPAN: Record<Range, number> = { today: 0, '7d': 6, '30d': 29, all: 3650 }

/**
 * One delegate, whole: what they sold, what came back as money, what is still owed through them, which shops they
 * sold to and which perfumes moved.
 *
 * **Owed is owed through them.** It is the unpaid part of their own sales less what they collected, not a shop's
 * whole balance — a shop may owe the business for something a till sold it, and that is not this delegate's doing.
 */
export function DelegateDashboard({ delegateId }: { delegateId: string }) {
  const t = useT()
  const lang = useUI((s) => s.lang)
  const [range, setRange] = useState<Range>('7d')

  const to = Date.now()
  const from = new Date(new Date().setHours(0, 0, 0, 0) - SPAN[range] * 86_400_000).getTime()

  const d = useQuery({
    queryKey: ['delegate-dashboard', delegateId, range],
    queryFn: () => api<Dashboard>('GET', `/delegates/${delegateId}/dashboard?from=${from}&to=${to}`),
  })

  if (d.isLoading || !d.data) return <div className="grid h-40 place-items-center"><Spinner className="size-8" /></div>
  const x = d.data

  return (
    <div className="space-y-4">
      <Segmented
        value={range}
        onChange={setRange}
        ariaLabel={t('dlg.period')}
        options={(['today', '7d', '30d', 'all'] as Range[]).map((r) => ({ value: r, label: t(`sales.range_${r}`) }))}
      />

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Figure icon={<ShoppingBag className="size-4" />} label={t('dlg.d_sold')} value={fmt(x.soldIQD)} hint={t('dlg.d_sales_n', { n: x.salesCount })} />
        <Figure icon={<Banknote className="size-4" />} label={t('dlg.d_collected')} value={fmt(x.collectedIQD)} />
        <Figure icon={<HandCoins className="size-4" />} label={t('dlg.d_owed')} value={fmt(x.owedIQD)} hint={t('dlg.d_owed_hint')} tone={x.owedIQD > 0 ? 'warn' : undefined} />
        <Figure icon={<Package className="size-4" />} label={t('dlg.d_units')} value={String(x.units)} hint={t('dlg.d_visits_n', { n: x.visits })} />
      </div>

      <Card className="flex flex-wrap items-center justify-between gap-3 !py-3">
        <div className="flex items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-gold-soft text-gold-text dark:bg-gold/15"><Truck className="size-5" /></span>
          <div>
            <p className="num font-semibold">
              {plural(t, 'dlg.d_bottles', x.carrying.units)} · {plural(t, 'dlg.d_sizes', x.carrying.sizes)}
            </p>
            <p className="num text-xs text-fg-2">{fmt(x.carrying.valueIQD)}</p>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card pad={false}>
          <h3 className="flex items-center gap-2 px-4 py-3 font-serif text-lg"><MapPin className="size-4 text-gold-text" />{t('dlg.d_shops')}</h3>
          {!x.shops.length ? <div className="px-4 pb-4"><EmptyState title={t('dlg.d_nothing')} /></div> : (
            <ul className="divide-y divide-line border-t border-line">
              {x.shops.map((s, i) => (
                <li key={s.customerId ?? `walk-${i}`} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{s.name || t('dlg.d_walk_in')}</span>
                    <span className="num block text-xs text-fg-2">{t('dlg.d_sales_n', { n: s.sales })}</span>
                  </span>
                  <span className="text-end">
                    <span className="num block font-semibold">{fmt(s.totalIQD)}</span>
                    {s.owedIQD > 0 && <span className="num block text-xs text-warn-fg">{t('dlg.d_owes', { amount: fmt(s.owedIQD) })}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card pad={false}>
          <h3 className="flex items-center gap-2 px-4 py-3 font-serif text-lg"><Package className="size-4 text-gold-text" />{t('dlg.d_moved')}</h3>
          {!x.moved.length ? <div className="px-4 pb-4"><EmptyState title={t('dlg.d_nothing')} /></div> : (
            <ul className="divide-y divide-line border-t border-line">
              {x.moved.map((m) => (
                <li key={m.variantId} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{typeof m.name === 'string' ? m.name : pick(m.name, lang)}</span>
                    <span className="num block text-xs text-fg-2">{m.label}</span>
                  </span>
                  <span className="num shrink-0 font-semibold">{m.qty}</span>
                  <span className="num w-24 shrink-0 text-end text-fg-2">{fmt(m.totalIQD)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}

function Figure({ icon, label, value, hint, tone }: {
  icon: React.ReactNode
  label: string
  value: string
  hint?: string
  tone?: 'warn'
}) {
  return (
    <Card className="!p-3">
      <p className="flex items-center gap-1.5 text-xs text-fg-2">{icon}{label}</p>
      <p className={cn('num mt-1 text-lg font-semibold', tone === 'warn' && 'text-warn-fg')}>{value}</p>
      {hint && <p className="num mt-0.5 text-[11px] text-fg-2">{hint}</p>}
    </Card>
  )
}
