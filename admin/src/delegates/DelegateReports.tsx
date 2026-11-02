import { useState } from 'react'
import { EmptyState } from '@/components/ui/Controls'
import { cn } from '@/components/ui/cn'
import { useT } from '@/i18n'
import { DELEGATE_REPORTS, type ReportId } from '../reports/api'
import { ReportView } from '../reports/ReportsPage'

/** The delegate's own reports, inside the Delegates section: what was sold, to which shop, for how much, and commission. */
export function DelegateReports() {
  const t = useT()
  const [id, setId] = useState<ReportId | null>(DELEGATE_REPORTS[0]?.id ?? null)
  const def = DELEGATE_REPORTS.find((r) => r.id === id) ?? DELEGATE_REPORTS[0]
  if (!def) return <EmptyState title={t('noaccess.title')} hint={t('noaccess.hint')} />
  return (
    <div className="space-y-4">
      {DELEGATE_REPORTS.length > 1 && (
        <nav aria-label={t('rx.g_delegate')} className="flex flex-wrap gap-2">
          {DELEGATE_REPORTS.map((r) => (
            <button key={r.id} type="button" onClick={() => setId(r.id)} aria-current={r.id === def.id ? 'page' : undefined}
              className={cn('inline-flex h-11 items-center gap-2 rounded-xl px-4 text-sm font-medium transition', r.id === def.id ? 'bg-gold text-ink' : 'bg-surface-2 text-fg-2 hover:text-fg')}>
              <r.icon className="size-4 shrink-0" />{t(`rx.r_${r.id}`)}
            </button>
          ))}
        </nav>
      )}
      <ReportView key={def.id} def={def} />
    </div>
  )
}
