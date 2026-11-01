import { PageHeader } from '@/components/ui/Controls'
import { useT } from '@/i18n'
import { ActivityLog } from '@/features/users/ActivityLog'

/**
 * What happened in the system, newest first. A screen of its own so an account made only to watch the shop
 * (`audit.view` and nothing else) has somewhere to land — it reads the log and reaches nothing else.
 */
export function ActivityPage() {
  const t = useT()
  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      <PageHeader title={t('ap.nav_activity')} subtitle={t('ap.activity_subtitle')} />
      <ActivityLog />
    </div>
  )
}
