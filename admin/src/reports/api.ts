import { ArrowLeftRight, BadgeAlert, BarChart3, CalendarDays, ClipboardList, Scale, Clock, HandCoins, Hourglass, Landmark, Layers, MapPinned, Package, PackageOpen, Receipt, Tags, UserRound, Wallet, type LucideIcon } from 'lucide-react'
import { api } from '@/services/api'

/** One report, in the shape the server sends every report in — see backend/app/Services/ReportCenter.php. */
export type ColumnType = 'text' | 'name' | 'label' | `enum:${string}` | 'day' | 'date' | 'datetime' | 'int' | 'iqd' | 'money' | 'usd' | 'pct' | 'items' | 'map'
/** An `items` cell: what was sold on one bill. */
export interface SoldLine { name: Record<string, string>; label: string; qty: number }
export interface Column { key: string; label: string; type: ColumnType }
export type Row = Record<string, unknown> & { id?: string; currency?: 'IQD' | 'USD'; kind?: 'line' | 'subtotal' | 'expense' | 'total' }

export interface ReportTable {
  type: ReportId
  from: number
  to: number
  financial: boolean
  columns: Column[]
  rows: Row[]
  totals: Row | null
  summary: { label: string; type: ColumnType; value: number }[]
}

export type ReportId =
  | 'sales-by-day' | 'sales-by-product' | 'sales-by-brand' | 'sales-by-category' | 'sales-by-seller'
  | 'profit-loss' | 'expenses' | 'delegate-commission' | 'delegate-sales' | 'debt-aging'
  | 'debt-movements' | 'supplier-balances' | 'supplier-movements'
  | 'missing-cost' | 'stock-valuation' | 'slow-movers' | 'purchases' | 'shifts'

export type Preset = 'today' | 'yesterday' | '7' | '30' | '90' | 'month' | 'last_month' | 'year' | 'custom'

export interface ReportDef {
  id: ReportId
  group: 'sales' | 'money' | 'debts' | 'stock' | 'staff' | 'delegate'
  icon: LucideIcon
  /** the permission the server checks */
  perm: string
  /** "as of now" reports ignore the period */
  asOf?: boolean
  preset: Preset
}

export const REPORTS: ReportDef[] = [
  { id: 'sales-by-day', group: 'sales', icon: CalendarDays, perm: 'reports.view', preset: '30' },
  { id: 'sales-by-product', group: 'sales', icon: Package, perm: 'reports.view', preset: '30' },
  { id: 'sales-by-brand', group: 'sales', icon: Tags, perm: 'reports.view', preset: '30' },
  { id: 'sales-by-category', group: 'sales', icon: Layers, perm: 'reports.view', preset: '30' },
  { id: 'sales-by-seller', group: 'sales', icon: UserRound, perm: 'reports.view', preset: '30' },
  { id: 'delegate-sales', group: 'delegate', icon: MapPinned, perm: 'delegates.manage', preset: '7' },
  { id: 'profit-loss', group: 'money', icon: Landmark, perm: 'reports.financial', preset: 'month' },
  { id: 'missing-cost', group: 'money', icon: BadgeAlert, perm: 'prices.edit', preset: 'today', asOf: true },
  { id: 'expenses', group: 'money', icon: Wallet, perm: 'expenses.view', preset: 'month' },
  { id: 'delegate-commission', group: 'delegate', icon: HandCoins, perm: 'delegates.manage', preset: 'month' },
  { id: 'debt-aging', group: 'debts', icon: Hourglass, perm: 'customers.view', preset: 'today', asOf: true },
  { id: 'debt-movements', group: 'debts', icon: ArrowLeftRight, perm: 'customers.view', preset: 'month' },
  { id: 'supplier-balances', group: 'debts', icon: Scale, perm: 'purchasing.view', preset: 'today', asOf: true },
  { id: 'supplier-movements', group: 'debts', icon: ClipboardList, perm: 'purchasing.view', preset: 'month' },
  { id: 'stock-valuation', group: 'stock', icon: BarChart3, perm: 'reports.financial', preset: 'today', asOf: true },
  { id: 'slow-movers', group: 'stock', icon: Clock, perm: 'inventory.view', preset: '90' },
  { id: 'purchases', group: 'stock', icon: PackageOpen, perm: 'purchasing.view', preset: 'month' },
  { id: 'shifts', group: 'staff', icon: Receipt, perm: 'shifts.view_all', preset: '7' },
]

export const GROUPS = ['sales', 'money', 'debts', 'stock', 'staff', 'delegate'] as const
/** The delegate's own reports — gathered in the Delegates section as well as here. */
export const DELEGATE_REPORTS = REPORTS.filter((r) => r.group === 'delegate')

export const runReport = (type: ReportId, from: number, to: number) => api<ReportTable>('GET', `/reports/table/${type}?from=${from}&to=${to}`)
/** Reports → Sales saved without cost: write a size's real cost into the bills that were saved with 0. */
export const fixMissingCost = (variantId: string, costIQD: number) =>
  api<{ lines: number; units: number; variantUpdated: boolean }>('POST', `/reports/missing-cost/${variantId}`, { costIQD })
export const setCommission = async (delegateId: string, pct: number) => { await api('PUT', `/delegates/${delegateId}/commission`, { pct }) }

/** A preset's first and last millisecond, in this computer's (the shop's) time. */
export function presetRange(p: Preset, now = new Date()): [number, number] {
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate()
  const start = (yy: number, mm: number, dd: number) => new Date(yy, mm, dd).getTime()
  const endToday = start(y, m, d + 1) - 1
  switch (p) {
    case 'yesterday': return [start(y, m, d - 1), start(y, m, d) - 1]
    case '7': return [start(y, m, d - 6), endToday]
    case '30': return [start(y, m, d - 29), endToday]
    case '90': return [start(y, m, d - 89), endToday]
    case 'month': return [start(y, m, 1), endToday]
    case 'last_month': return [start(y, m - 1, 1), start(y, m, 1) - 1]
    case 'year': return [start(y, 0, 1), endToday]
    default: return [start(y, m, d), endToday]
  }
}
