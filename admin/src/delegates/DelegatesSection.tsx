import { DelegatesPage } from '@/features/delegates/DelegatesPage'
import { DelegatePrices } from './DelegatePrices'
import { DelegateReports } from './DelegateReports'

/** The Delegates section: the team, the dollar price list they sell shops at, and their reports. */
export function DelegatesSection() {
  return <DelegatesPage prices={<DelegatePrices />} reports={<DelegateReports />} />
}
