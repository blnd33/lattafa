import type { Lang, Product } from '@/data/types'
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
  }
  /** the same stretch of time just before, up to the same moment */
  previous: { count: number; revenueIQD: number; netIQD: number; profitIQD: number | null }
  channels: { store: ChannelTotals; delegate: ChannelTotals }
  series: { unit: 'hour' | 'day'; points: { key: string; storeIQD: number; delegateIQD: number; count: number }[] }
  topProducts: { productId: string; name: Record<Lang, string>; brand: string; image: string | null; art: Product['art'] | null; units: number; revenueIQD: number }[]
  /** null = no permission to see it */
  lowStock: { count: number; items: { variantId: string; name: Record<Lang, string>; label: string; sku: string; qty: number; minStock: number }[] } | null
  delegates: { id: string; name: string; color: string; salesIQD: number; salesCount: number; collectedIQD: number; lastSeenAt: number | null }[] | null
  debts: { totalIQD: number; customers: number; top: { id: string; name: string; phone: string; balanceIQD: number }[] } | null
  /** shop expenses + delegates' approved road expenses in the window (null = no permission) */
  expensesIQD: number | null
  suppliers: { owedUSD: number; owedIQD: number; totalIQD: number; rate: number; suppliers: number; top: { id: string; name: string; currency: 'IQD' | 'USD'; balance: number; balanceIQD: number }[] } | null
  attention: { openRequests: number | null; pendingClosings: number | null; salesToReview: number | null; ordersWaiting: number | null }
}

export const getDashboard = (period: Period) => api<Dashboard>('GET', `/dashboard?period=${period}`)
