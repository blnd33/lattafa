import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Badge, Card } from '@/components/ui/Controls'
import { errorMessage, useT } from '@/i18n'
import { useSettings, usePending } from '@/hooks/queries'
import { AppError } from '@/services/context'
import { failedItems, syncNow } from '@/services/sync'
import { toast } from '@/store/toast'

/** Settings → Data: is this device connected, when did it last sync, and is anything stuck? */
export function SyncCard() {
  const t = useT()
  const qc = useQueryClient()
  const { data: settings } = useSettings()
  const { data: pending = 0 } = usePending()
  const { data: failed = [] } = useQuery({ queryKey: ['outbox', 'failed'], queryFn: failedItems })
  const [busy, setBusy] = useState(false)
  const connected = settings?.sync.mode === 'server'
  const last = settings?.sync.lastPullAt ? new Date(settings.sync.lastPullAt).toLocaleString() : null

  const run = async () => {
    setBusy(true)
    try {
      const r = await syncNow()
      await qc.invalidateQueries()
      if (r.ok) toast.success(t('sync.done'))
      else toast.error(errorMessage(new AppError(r.reason === 'offline' ? 'offline' : r.reason === 'not_signed_in' ? 'not_signed_in' : 'server_error'), t))
    } finally { setBusy(false) }
  }

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">{t('settings.sync')}</h2>
        <Badge tone={connected ? 'ok' : 'neutral'}>{connected ? t('sync.server') : t('sync.local')}</Badge>
        {pending > 0 && <Badge tone="warn">{t('sync.queued', { n: pending })}</Badge>}
      </div>
      <p className="text-sm text-fg-2">{connected ? t('settings.sync_connected') : t('settings.sync_local')}</p>
      {connected && (
        <>
          <p className="text-sm">{last ? t('sync.last', { time: last }) : t('sync.never')}</p>
          <Button variant="secondary" size="lg" icon={<RefreshCw className={busy ? 'size-5 animate-spin' : 'size-5'} />} loading={busy} onClick={run}>{t('sync.now')}</Button>
          {failed.length > 0 && (
            <div className="space-y-2 rounded-xl border border-danger/40 p-3">
              <p className="text-sm font-medium text-danger">{t('sync.failed', { n: failed.length })}</p>
              <p className="text-xs text-fg-2">{t('settings.sync_failed_hint')}</p>
              <ul className="space-y-1 text-xs">
                {failed.slice(0, 20).map((f) => (
                  <li key={f.id} className="flex flex-wrap gap-x-2"><span className="font-medium">{f.entity}</span><span className="num text-fg-2">{f.entityId.slice(0, 8)}</span><span>{errorMessage(new AppError(f.lastError), t)}</span></li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Card>
  )
}
