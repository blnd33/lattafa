import type { Lang } from '@/data/types'
import { api } from '@/services/api'
import { pullNow } from '@/services/sync'
import type { Currency } from '../money'

/** The server's purchasing API — see backend/app/Services/PurchasingService.php. */
export interface Supplier {
  id: string
  name: string
  phone: string
  contact: string
  city: string
  currency: Currency
  notes: string
  active: boolean
  /** what the shop owes them, in their currency */
  balance: number
  openOrders: number
  createdAt: number
}
export type SupplierInput = Pick<Supplier, 'name' | 'phone' | 'contact' | 'city' | 'currency' | 'notes' | 'active'>

export type OrderStatus = 'open' | 'partial' | 'received' | 'closed' | 'cancelled'
export type OrderFilter = 'waiting' | 'received' | 'cancelled' | 'all'

export interface OrderItem {
  id: number
  variantId: string
  productId: string
  name: Record<Lang, string>
  label: string
  sku: string
  qty: number
  receivedQty: number
  unitCost: number
  lineTotal: number
}

export interface Delivery { id: string; receivedAt: number; userName: string; rate: number; total: number; totalIQD: number; note: string; units: number }

export interface PurchaseOrder {
  id: string
  number: string
  status: OrderStatus
  currency: Currency
  rate: number
  supplier: { id: string; name: string; currency: Currency } | null
  total: number
  receivedTotal: number
  note: string
  orderedAt: number
  expectedAt: number | null
  closedAt: number | null
  createdByName: string
  units: number
  receivedUnits: number
  items: OrderItem[]
  /** only on a single order */
  receipts?: Delivery[]
}

export interface OrderInput {
  supplierId?: string
  rate?: number
  note: string
  expectedAt: number | null
  lines: { variantId: string; qty: number; unitCost: number }[]
  receiveNow?: boolean
}

export interface StatementRow {
  type: 'receipt' | 'payment'
  id: string
  at: number
  amount: number
  balance: number
  orderId: string | null
  orderNumber: string
  method: string | null
  note: string
  userName: string
}

export interface PaymentInput { amount: number; method: string; note: string; paidAt: number; rate?: number; purchaseOrderId?: string | null }

export const PAY_METHODS = ['cash', 'bank', 'other'] as const

export const listSuppliers = async () => (await api<{ suppliers: Supplier[] }>('GET', '/suppliers')).suppliers
export const saveSupplier = async (input: SupplierInput, id?: string) =>
  (await api<{ supplier: Supplier }>(id ? 'PUT' : 'POST', id ? `/suppliers/${id}` : '/suppliers', input)).supplier
export const supplierStatement = (id: string) => api<{ supplier: Supplier; rows: StatementRow[]; balance: number }>('GET', `/suppliers/${id}/statement`)
export const paySupplier = async (id: string, input: PaymentInput) => (await api<{ payment: { id: string } }>('POST', `/suppliers/${id}/payments`, input)).payment
export const deletePayment = async (id: string) => { await api('DELETE', `/supplier-payments/${id}`) }

export const listOrders = async (status: OrderFilter, supplierId?: string) =>
  (await api<{ orders: PurchaseOrder[] }>('GET', `/purchase-orders?status=${status}${supplierId ? `&supplierId=${supplierId}` : ''}`)).orders
export const getOrder = async (id: string) => (await api<{ order: PurchaseOrder }>('GET', `/purchase-orders/${id}`)).order

/** Saving with "receive now", and receiving, change the shop's stock: refresh the local copy straight away. */
export async function createOrder(input: OrderInput): Promise<PurchaseOrder> {
  const o = (await api<{ order: PurchaseOrder }>('POST', '/purchase-orders', input)).order
  if (input.receiveNow) await pullNow()
  return o
}
export const updateOrder = async (id: string, input: OrderInput) => (await api<{ order: PurchaseOrder }>('PUT', `/purchase-orders/${id}`, input)).order
export async function receiveOrder(id: string, input: { lines: { itemId: number; qty: number; unitCost?: number }[]; rate?: number; note: string }): Promise<PurchaseOrder> {
  const o = (await api<{ order: PurchaseOrder }>('POST', `/purchase-orders/${id}/receive`, input)).order
  await pullNow()
  return o
}
export const cancelOrder = async (id: string) => (await api<{ order: PurchaseOrder }>('POST', `/purchase-orders/${id}/cancel`)).order
