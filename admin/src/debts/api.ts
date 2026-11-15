import { api } from '@/services/api'

/** GET /debts — see backend/app/Services/DebtService.php. */
export type DebtPeriod = 'today' | 'week' | 'month' | 'quarter'
export const DEBT_PERIODS: DebtPeriod[] = ['today', 'week', 'month', 'quarter']

export interface Aging { age0: number; age31: number; age61: number; age91: number }
export const AGES: (keyof Aging)[] = ['age0', 'age31', 'age61', 'age91']

export interface Debtor extends Aging {
  id: string
  name: string
  phone: string
  type: string
  city: string
  balanceIQD: number
  creditLimitIQD: number
  lastDebtAt: number | null
  lastPaymentAt: number | null
  /** days since the oldest bill still unpaid (null = only an opening balance) */
  oldestDays: number | null
}

export interface Creditor {
  id: string
  name: string
  phone: string
  city: string
  currency: 'IQD' | 'USD'
  active: boolean
  received: number
  paid: number
  /** what the shop still owes, in the supplier's currency */
  balance: number
  balanceIQD: number
  lastReceiptAt: number | null
  lastPaymentAt: number | null
}

export type MoveKind = 'debt_sale' | 'collection' | 'debt_return' | 'purchase' | 'supplier_payment'

export interface DebtMove {
  id: string
  at: number
  side: 'customer' | 'supplier'
  kind: MoveKind
  /** +1 the debt grew, −1 it was paid down */
  sign: 1 | -1
  partyId: string | null
  party: string
  ref: string
  amount: number
  currency: 'IQD' | 'USD'
  amountIQD: number
  method: string | null
  by: string
  note: string
}

export interface Debts {
  period: DebtPeriod
  from: number
  to: number
  /** null = may not see customers' debts */
  receivable: {
    totalIQD: number; customers: number; overLimit: number; aging: Aging
    givenIQD: number; givenCount: number; collectedIQD: number; collectedCount: number; returnedIQD: number
    rows: Debtor[]
  } | null
  /** null = may not see what is owed to suppliers */
  payable: {
    totalIQD: number; owedUSD: number; owedIQD: number; rate: number; suppliers: number
    boughtIQD: number; boughtCount: number; paidIQD: number; paidCount: number
    rows: Creditor[]
  } | null
  /** owed to the shop − owed by the shop (only when both are visible) */
  netIQD: number | null
  series: { unit: 'hour' | 'day'; points: { key: string; givenIQD: number; collectedIQD: number; boughtIQD: number; paidIQD: number }[] }
  activity: DebtMove[]
}

export const getDebts = (period: DebtPeriod) => api<Debts>('GET', `/debts?period=${period}`)
