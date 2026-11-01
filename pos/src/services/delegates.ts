/**
 * Managing delegates from the POS (managers): load and unload vans, handle stock requests, approve daily closings.
 * This only exists with the shop server — vans and delegates live there.
 */
import type { I18nText } from '@/data/types'
import { api } from './api'
import { AppError, assertCan } from './context'
import { isServer } from './mode'
import { pullNow } from './sync'

export interface DelegateRow {
  id: string; name: string; color: string; active: boolean; lastLoginAt: number | null
  vanUnits: number; vanValueIQD: number; todaySalesIQD: number; todaySalesCount: number; todayCollectionsIQD: number; todayVisits: number
  openRequests: number; pendingClosings: number
  /** where the phone was last seen (live location), or null */
  lastLocation: LocationPoint | null
}
export interface LocationPoint { lat: number; lng: number; accuracyM: number | null; at: number }
export interface VanLine { variantId: string; productId: string; name: I18nText; brand: string; label: string; sku: string; qty: number; wholesaleIQD: number; retailIQD: number }
export interface StockRequestRow { id: string; userId: string; userName: string; items: { variantId: string; qty: number }[]; note: string; status: 'open' | 'fulfilled' | 'cancelled'; createdAt: number }
export interface ClosingRow {
  id: string; userId: string; userName: string; day: string; salesCount: number; salesIQD: number; cashSalesIQD: number; creditSalesIQD: number
  collectionsIQD: number; expensesIQD: number; expectedCashIQD: number; countedCashIQD: number; varianceIQD: number; vanUnits: number; visits: number
  /** dollar notes, counted on their own */
  expectedCashUSD?: number; countedCashUSD?: number; varianceUSD?: number
  note: string; status: 'submitted' | 'approved' | 'rejected'; reviewNote: string; createdAt: number
}
export interface VisitRow { id: string; customerName: string; lat: number | null; lng: number | null; outcome: string; note: string; createdAt: number }

function need() {
  assertCan('delegates.manage')
  if (!isServer()) throw new AppError('needs_server')
}

export async function listDelegates(): Promise<DelegateRow[]> { need(); return (await api<{ delegates: DelegateRow[] }>('GET', '/delegates')).delegates }
export async function vanOf(id: string): Promise<VanLine[]> { need(); return (await api<{ items: VanLine[] }>('GET', `/delegates/${id}/van`)).items }
export async function requestsOf(id: string): Promise<StockRequestRow[]> { need(); return (await api<{ requests: StockRequestRow[] }>('GET', '/stock-requests')).requests.filter((r) => r.userId === id) }
export async function closingsOf(id: string): Promise<ClosingRow[]> { need(); return (await api<{ closings: ClosingRow[] }>('GET', `/delegate-closings?userId=${id}`)).closings }
/** A delegate's route on a day (YYYY-MM-DD, shop time) and where they were last seen. */
export async function locationsOf(id: string, day: string): Promise<{ points: LocationPoint[]; last: LocationPoint | null; day: string }> {
  need()
  return api('GET', `/delegates/${id}/locations?day=${encodeURIComponent(day)}`)
}
export async function visitsOf(id: string): Promise<VisitRow[]> { need(); return (await api<{ visits: VisitRow[] }>('GET', `/visits?userId=${id}`)).visits }

/** Shop → van (optionally fulfilling a request). The shop's stock on this till is refreshed afterwards. */
export async function loadVan(id: string, items: { variantId: string; qty: number }[], note: string, requestId?: string): Promise<void> {
  need()
  await api('POST', `/delegates/${id}/load`, { items, note, requestId })
  await pullNow()
}
export async function unloadVan(id: string, items: { variantId: string; qty: number }[], note: string): Promise<void> {
  need()
  await api('POST', `/delegates/${id}/unload`, { items, note })
  await pullNow()
}
export async function cancelRequest(requestId: string): Promise<void> { need(); await api('POST', `/stock-requests/${requestId}/cancel`) }
export async function approveClosing(closingId: string, note: string): Promise<void> { need(); await api('POST', `/delegate-closings/${closingId}/approve`, { note }) }
export async function rejectClosing(closingId: string, note: string): Promise<void> {
  need()
  if (!note.trim()) throw new AppError('required_fields')
  await api('POST', `/delegate-closings/${closingId}/reject`, { note })
}
