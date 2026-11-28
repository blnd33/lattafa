import type { Lang, Product } from '@/data/types'
import type { Expense, ExpenseCategory } from '../expenses/api'
import { api } from '@/services/api'

/** GET /dashboard — see backend/app/Services/DashboardService.php. */
export type Period = 'today' | 'week' | 'month'

export interface ChannelTotals { count: number; revenueIQD: number }

export interface Dashboard {
  period: Period
  from: number
  to: number
  /** may see cost and profit (reports.financial) */
  financial: boolean
  totals: {
    count: number; revenueIQD: number; refundsIQD: number; netIQD: number; unitsSold: number; avgBasketIQD: number
    profitIQD: number | null
    /** of the sales: left on the customer's account (debt) / paid at the counter */
    creditIQD: number; paidIQD: number
    /** old debts paid back in the window — money in, but not a sale */
    collectedIQD: number
    /** money that actually came in: paid on the bills + old debts paid back */
    receivedIQD: number
    /** the part of the profit made on bills left on debt (null without reports.financial) */
    creditProfitIQD: number | null
    /** bottles given away free, and what they cost the shop (null without reports.financial) */
    giftUnits?: number
    giftsCostIQD?: number | null
  }
  /** the same stretch of time just before, up to the same moment */
  previous: { count: number; revenueIQD: number; netIQD: number; profitIQD: number | null; creditIQD: number; paidIQD: number; collectedIQD: number; receivedIQD?: number }
  channels: { store: ChannelTotals; delegate: ChannelTotals }
  series: { unit: 'hour' | 'day'; points: { key: string; storeIQD: number; delegateIQD: number; count: number }[] }
  topProducts: { productId: string; name: Record<Lang, string>; brand: string; image: string | null; art: Product['art'] | null; units: number; revenueIQD: number }[]
  /** null = no permission to see it */
  lowStock: { count: number; items: { variantId: string; name: Record<Lang, string>; label: string; sku: string; qty: number; minStock: number }[] } | null
  delegates: { id: string; name: string; color: string; salesIQD: number; salesCount: number; collectedIQD: number; lastSeenAt: number | null }[] | null
  debts: { totalIQD: number; customers: number; top: { id: string; name: string; phone: string; balanceIQD: number }[] } | null
  /** cash the delegates took that the shop has not received yet (null = no permission) */
  withDelegates: WithDelegates | null
  /** shop expenses + delegates' approved road expenses in the window (null = no permission) */
  expensesIQD: number | null
  /** the expenses card (null = no permission): the window's shop expenses, delegates' road expenses, top categories, latest entries, all-time total */
  expenses: {
    totalIQD: number; count: number; delegateIQD: number
    byCategory: { category: ExpenseCategory; amountIQD: number; count: number }[]
    recent: Expense[]
    allTimeIQD: number; allTimeCount: number
  } | null
  suppliers: { owedUSD: number; owedIQD: number; totalIQD: number; rate: number; suppliers: number; top: { id: string; name: string; currency: 'IQD' | 'USD'; balance: number; balanceIQD: number }[] } | null
  attention: { openRequests: number | null; pendingClosings: number | null; salesToReview: number | null; ordersWaiting: number | null }
}

export interface WithDelegates {
  /** dinars + dollars at the rate */
  totalIQD: number; cashIQD: number; cashUSD: number; rate: number
  delegates: { id: string; name: string; color: string | null; cashIQD: number; cashUSD: number; valueIQD: number; days: number; oldestDay: string }[]
}

/** The shop received a delegate's cash: their open days are approved. */
export const receiveCash = (delegateId: string, note = '') =>
  api<{ days: string[]; cashIQD: number; cashUSD: number }>('POST', `/delegates/${delegateId}/receive-cash`, { note })

export const getDashboard = (period: Period) => api<Dashboard>('GET', `/dashboard?period=${period}`)
