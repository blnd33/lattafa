import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CartSnapshotLine } from '@/data/types'
import type { OrderDiscount } from '@/lib/pricing'

export interface ReturnCredit {
  amountIQD: number
  fromReturn: string
}

interface CartState {
  lines: CartSnapshotLine[]
  customerId: string | null
  orderDiscount: OrderDiscount | null
  giftWrap: boolean
  note: string
  redeemPoints: number
  returnCredit: ReturnCredit | null
  approvedBy: { id: string; name: string } | null
  add: (variantId: string, qty?: number) => void
  setQty: (variantId: string, qty: number) => void
  setLineDiscount: (variantId: string, pct: number) => void
  remove: (variantId: string) => void
  setCustomer: (id: string | null) => void
  setOrderDiscount: (d: OrderDiscount | null) => void
  setGiftWrap: (v: boolean) => void
  setNote: (n: string) => void
  setRedeem: (p: number) => void
  setReturnCredit: (c: ReturnCredit | null) => void
  setApprovedBy: (a: { id: string; name: string } | null) => void
  load: (snap: { lines: CartSnapshotLine[]; customerId: string | null; orderDiscount: OrderDiscount | null; giftWrap: boolean; note: string }) => void
  clear: () => void
  /** Drops lines whose bottle is no longer for sale (deleted/hidden on the server, data replaced…). Returns how many. */
  prune: (forSale: Set<string>) => number
}

const empty = { lines: [], customerId: null, orderDiscount: null, giftWrap: false, note: '', redeemPoints: 0, returnCredit: null, approvedBy: null }

/** The open bill. Persisted so a refresh or a crash never loses a customer's basket. */
export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      ...empty,
      add: (variantId, qty = 1) =>
        set((s) => {
          const ex = s.lines.find((l) => l.variantId === variantId)
          return { lines: ex ? s.lines.map((l) => (l.variantId === variantId ? { ...l, qty: l.qty + qty } : l)) : [...s.lines, { variantId, qty, discountPct: 0 }] }
        }),
      setQty: (variantId, qty) => set((s) => ({ lines: qty <= 0 ? s.lines.filter((l) => l.variantId !== variantId) : s.lines.map((l) => (l.variantId === variantId ? { ...l, qty } : l)) })),
      setLineDiscount: (variantId, pct) => set((s) => ({ lines: s.lines.map((l) => (l.variantId === variantId ? { ...l, discountPct: pct } : l)) })),
      remove: (variantId) => set((s) => ({ lines: s.lines.filter((l) => l.variantId !== variantId) })),
      setCustomer: (customerId) => set({ customerId, redeemPoints: 0 }),
      setOrderDiscount: (orderDiscount) => set({ orderDiscount }),
      setGiftWrap: (giftWrap) => set({ giftWrap }),
      setNote: (note) => set({ note }),
      setRedeem: (redeemPoints) => set({ redeemPoints }),
      setReturnCredit: (returnCredit) => set({ returnCredit }),
      setApprovedBy: (approvedBy) => set({ approvedBy }),
      load: (snap) => set({ ...empty, ...snap }),
      clear: () => set({ ...empty }),
      prune: (forSale) => {
        const keep = get().lines.filter((l) => forSale.has(l.variantId))
        const dropped = get().lines.length - keep.length
        if (dropped) set({ lines: keep })
        return dropped
      },
    }),
    { name: 'lattafa-cart' },
  ),
)
