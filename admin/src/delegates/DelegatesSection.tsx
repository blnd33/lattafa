import { DelegatesPage } from '@/features/delegates/DelegatesPage'
import { DelegatePrices } from './DelegatePrices'
import { DelegateReports } from './DelegateReports'
import { VanTab } from './VanTab'

/**
 * The Delegates section: the team and what each is carrying, the dollar price list they sell shops at, and their
 * reports. Loading a van is an admin job, so the van screen is handed to the shared page from here rather than
 * living in it — a till has no business moving stock into someone's van.
 */
export function DelegatesSection() {
  return (
    <DelegatesPage
      prices={<DelegatePrices />}
      reports={<DelegateReports />}
      van={(delegateId) => <VanTab key={delegateId} delegateId={delegateId} />}
    />
  )
}
