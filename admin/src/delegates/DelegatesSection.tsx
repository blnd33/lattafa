import { DelegatesPage } from '@/features/delegates/DelegatesPage'
import { DelegateReports } from './DelegateReports'

/** The Delegates section of the admin panel: the team (sales, location, closings, visits) and their reports in one place. */
export function DelegatesSection() {
  return <DelegatesPage reports={<DelegateReports />} />
}
