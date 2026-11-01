import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { EmptyState, Spinner } from '@/components/ui/Controls'
import { Select } from '@/components/ui/Field'
import { useT } from '@/i18n'
import { fmtDateTime } from '@/lib/date'
import { hasPerm } from '@/lib/permissions'
import { listAudit } from '@/services/audit'
import { useActor } from '@/hooks/useAuth'
import { AUDIT_GROUPS, auditDetails } from './auditText'

/**
 * The activity log: who did what, newest first — the POS's Users → Activity tab and the admin panel's own screen.
 *
 * The details column holds the figures that changed (prices, limits, settings), so it is only for people who may see
 * the shop's money. An account that may not (one made just to watch the system) reads what happened, not how much.
 */
export function ActivityLog() {
  const t = useT()
  const actor = useActor()
  const [prefix, setPrefix] = useState('')
  const { data, isLoading } = useQuery({ queryKey: ['audit', prefix], queryFn: () => listAudit({ action: prefix || undefined, limit: 300 }) })
  const money = !!actor && (hasPerm(actor.permissions, 'reports.financial') || hasPerm(actor.permissions, 'prices.edit'))
  const label = (action: string) => { const k = `act.${action}`; const s = t(k); return s === k ? action : s }
  return (
    <>
      <div className="mb-4 max-w-xs"><Select value={prefix} onChange={(e) => setPrefix(e.target.value)} aria-label={t('users.audit_filter')}><option value="">{t('users.audit_all')}</option>{AUDIT_GROUPS.map((g) => <option key={g} value={g}>{t(`actg.${g}`)}</option>)}</Select></div>
      {isLoading ? <Spinner /> : !data?.length ? <EmptyState title={t('users.audit_none')} /> : (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {data.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
              <span className="num w-36 shrink-0 text-xs text-fg-2">{fmtDateTime(e.createdAt)}</span>
              <span className="w-36 shrink-0 truncate font-medium">{e.userName}</span>
              <span className="w-52 shrink-0 font-medium" title={e.action}>{label(e.action)}</span>
              {money && <span className="min-w-0 flex-1 truncate text-xs text-fg-2" title={auditDetails(e.meta)}>{auditDetails(e.meta)}</span>}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
