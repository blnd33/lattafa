/**
 * Ordering from the menu: a shop picks sizes, says who they are, and sends it. It is a request, not a sale —
 * no prices are agreed here; the delegate takes the order and settles the money when the goods are handed over.
 * The basket is kept on the phone so a reload (or a slow signal) never loses it.
 */
import { useSyncExternalStore } from 'react'
import type { MenuProduct, MenuSize } from './api'

export interface BasketLine { variantId: string; qty: number }
const KEY = 'lattafa-menu-basket'
const MAX_LINES = 60
const MAX_QTY = 500

const read = (): BasketLine[] => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    if (!Array.isArray(raw)) return []
    return raw.filter((l): l is BasketLine => !!l && typeof (l as BasketLine).variantId === 'string' && Number.isFinite((l as BasketLine).qty)).slice(0, MAX_LINES)
  } catch { return [] }
}

let lines: BasketLine[] = read()
const listeners = new Set<() => void>()
const save = (next: BasketLine[]) => {
  lines = next
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* private mode: the basket lives for this visit only */ }
  listeners.forEach((f) => f())
}

export const basket = {
  lines: () => lines,
  qtyOf: (variantId: string) => lines.find((l) => l.variantId === variantId)?.qty ?? 0,
  units: () => lines.reduce((n, l) => n + l.qty, 0),
  set(variantId: string, qty: number) {
    const q = Math.max(0, Math.min(MAX_QTY, Math.round(qty)))
    const without = lines.filter((l) => l.variantId !== variantId)
    save(q === 0 ? without : [...without, { variantId, qty: q }].slice(-MAX_LINES))
  },
  add(variantId: string, by = 1) { this.set(variantId, this.qtyOf(variantId) + by) },
  clear() { save([]) },
}

/** Re-renders the bar and the buttons whenever the basket changes. */
export function useBasket(): BasketLine[] {
  return useSyncExternalStore(
    (f) => { listeners.add(f); return () => listeners.delete(f) },
    () => lines,
    () => lines,
  )
}

/** What is in the basket, with the names to show — sizes that have since gone are dropped. */
export function basketItems(products: MenuProduct[]): { product: MenuProduct; size: MenuSize; qty: number }[] {
  const sizes = new Map(products.flatMap((p) => p.sizes.map((s) => [s.id, { product: p, size: s }] as const)))
  return lines.flatMap((l) => { const m = sizes.get(l.variantId); return m ? [{ ...m, qty: l.qty }] : [] })
}

export interface OrderSender { shopName: string; phone: string; note: string }

/**
 * Sends the order. Returns its number, which the shop can quote on the phone.
 * Throws `'busy'` when too many orders came from here in the last hour, `'gone'` when something is no longer on sale.
 */
export async function placeOrder(who: OrderSender): Promise<number> {
  const items = lines.filter((l) => l.qty > 0)
  if (!items.length) throw new Error('empty')
  const r = await fetch('/api/v1/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ shopName: who.shopName.trim(), phone: who.phone.trim(), note: who.note.trim(), items }),
  })
  if (r.status === 429) throw new Error('busy')
  if (!r.ok) {
    const code = await r.json().then((b: { error?: { code?: string } }) => b.error?.code).catch(() => undefined)
    throw new Error(code === 'product_unavailable' ? 'gone' : 'failed')
  }
  const { order } = (await r.json()) as { order: { number: number } }
  basket.clear()
  return order.number
}
