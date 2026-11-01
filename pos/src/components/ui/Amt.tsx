import { useT } from '@/i18n'
import { fmt, fmtUSD } from '@/lib/money'
import { cn } from './cn'

/** An IQD amount: "45,000 IQD" — digits always LTR, currency label follows the language. */
export function Amt({ n, unit = true, className, unitClassName }: { n: number; unit?: boolean; className?: string; unitClassName?: string }) {
  const t = useT()
  return (
    <span className={cn('num whitespace-nowrap', className)}>
      {n < 0 ? '−' : ''}{fmt(Math.abs(n))}
      {unit && <small className={cn('ms-1 text-[0.68em] font-medium opacity-70', unitClassName)}>{t('unit.iqd')}</small>}
    </span>
  )
}

export function UsdAmt({ n, className }: { n: number; className?: string }) {
  return <span className={cn('num whitespace-nowrap', className)}>${fmtUSD(n)}</span>
}
