/**
 * Orders shops sent from the customer menu. Every delegate sees the waiting ones; the first to accept takes it.
 * Online only — an order is a promise to a shop, so it is never taken on a guess from an old copy on the phone.
 */
import { useQuery } from '@tanstack/react-query'
import type { I18nText } from '@/data/types'
import { api, isOfflineError } from '@/services/api'

export interface OrderLine { variantId: string; productId: string; name: I18nText; brand: string; label: string; sku: string; qty: number }
export interface ShopOrder {
  id: string
  number: number
  shopName: string
  phone: string
  note: string
  customerId: string | null
  items: OrderLine[]
  units: number
  status: 'new' | 'accepted' | 'refused'
  handledBy: string | null
  handledByName: string
  handledAt: number | null
  refuseReason: string
  saleId: string | null
  placedAt: number
}

export const listOrders = async (status?: ShopOrder['status']) =>
  await api<{ orders: ShopOrder[]; waiting: number }>('GET', `/orders${status ? `?status=${status}` : ''}`)

export const acceptOrder = async (id: string) => (await api<{ order: ShopOrder }>('POST', `/orders/${id}/accept`)).order
export const refuseOrder = async (id: string, reason: string) => (await api<{ order: ShopOrder }>('POST', `/orders/${id}/refuse`, { reason })).order

/** The orders screen; it looks again every half minute so a new one turns up by itself. */
export const useOrders = () => useQuery({ queryKey: ['orders'], queryFn: () => listOrders(), refetchInterval: 30_000, retry: false })

/**
 * A short chime when an order arrives while the app is open. Made on the spot (no sound file to load), and quiet
 * if the phone won't play it — a browser that hasn't been tapped yet refuses, which is fine: the badge still shows.
 */
function chime(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const now = ctx.currentTime
    for (const [at, hz] of [[0, 880], [0.16, 1175]] as const) {
      const osc = ctx.createOscillator(), gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = hz
      gain.gain.setValueAtTime(0.0001, now + at)
      gain.gain.exponentialRampToValueAtTime(0.25, now + at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.14)
      osc.connect(gain).connect(ctx.destination)
      osc.start(now + at)
      osc.stop(now + at + 0.16)
    }
    setTimeout(() => void ctx.close(), 800)
  } catch { /* no sound on this phone */ }
}

let lastWaiting: number | null = null

/** Just the number for the badge — quiet when the phone is offline, and it chimes when the number goes up. */
export const useWaitingOrders = () => useQuery({
  queryKey: ['orders-waiting'],
  queryFn: async () => {
    let n = 0
    try { n = (await api<{ waiting: number }>('GET', '/orders/waiting')).waiting } catch (e) { if (!isOfflineError(e)) throw e; return lastWaiting ?? 0 }
    if (lastWaiting !== null && n > lastWaiting) chime()
    lastWaiting = n
    return n
  },
  refetchInterval: 30_000,
  retry: false,
})
