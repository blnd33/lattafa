import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { errorMessage, useT } from '@/i18n'
import { toast } from '@/store/toast'
import { ddb, getMeta } from './data'
import { myDay, shopItems, type DelegateCart } from './field'
import { failedRows, pendingCount } from './sync'

export const useMeta = () => useQuery({ queryKey: ['meta'], queryFn: getMeta })
/** Every perfume the delegate can sell, with the shop's stock. */
export const useShop = () => useQuery({ queryKey: ['shop'], queryFn: shopItems })
export const useMyDay = () => useQuery({ queryKey: ['day'], queryFn: myDay })
export const useCustomers = () => useQuery({ queryKey: ['customers'], queryFn: async () => (await ddb.customers.toArray()).filter((c) => c.active).sort((a, b) => a.name.localeCompare(b.name)) })
export const usePending = () => useQuery({ queryKey: ['pending'], queryFn: pendingCount, refetchInterval: 10_000 })
export const useFailed = () => useQuery({ queryKey: ['failed'], queryFn: failedRows })
export const useClosings = () => useQuery({ queryKey: ['closings'], queryFn: async () => (await ddb.closings.toArray()).sort((a, b) => b.day.localeCompare(a.day)) })

/** `const run = useAct(fn)` — runs a field action, refreshes every screen, shows a translated error if it fails. */
export function useAct<A extends unknown[], R>(fn: (...args: A) => Promise<R>, success?: string) {
  const qc = useQueryClient()
  const t = useT()
  const m = useMutation({ mutationFn: (args: A) => fn(...args) })
  const run = async (...args: A): Promise<R | undefined> => {
    try {
      const r = await m.mutateAsync(args)
      await qc.invalidateQueries()
      if (success) toast.success(t(success))
      return r
    } catch (e) {
      toast.error(errorMessage(e, t))
      return undefined
    }
  }
  return Object.assign(run, { busy: m.isPending })
}

/** The open bill — kept across reloads so a dropped call or a closed tab never loses an order. */
interface CartStore extends DelegateCart {
  set: (patch: Partial<DelegateCart>) => void
  add: (variantId: string, max: number) => void
  setQty: (variantId: string, qty: number) => void
  clear: () => void
}
const EMPTY: Omit<DelegateCart, 'currency'> = { customerId: null, priceList: 'wholesale', lines: [], discountPct: 0, payment: 'cash', paidNow: 0, note: '' }
export const useCart = create<CartStore>()(persist((set) => ({
  ...EMPTY,
  // most field sales are in dollars; the choice stays on the phone (a new bill keeps it)
  currency: 'USD',
  set: (patch) => set(patch),
  add: (variantId, max) => set((s) => {
    const cur = s.lines.find((l) => l.variantId === variantId)?.qty ?? 0
    if (cur >= max) return s
    return { lines: cur ? s.lines.map((l) => (l.variantId === variantId ? { ...l, qty: cur + 1 } : l)) : [...s.lines, { variantId, qty: 1 }] }
  }),
  setQty: (variantId, qty) => set((s) => ({ lines: qty <= 0 ? s.lines.filter((l) => l.variantId !== variantId) : s.lines.map((l) => (l.variantId === variantId ? { ...l, qty } : l)) })),
  clear: () => set({ ...EMPTY }),
}), {
  name: 'lattafa-delegate-cart',
  version: 1,
  // carts saved before dollars: `paidIQD` became `paidNow`, and the bill gets a currency
  migrate: (old) => {
    const o = (old ?? {}) as Record<string, unknown>
    return { ...EMPTY, ...o, paidNow: Number(o.paidNow ?? o.paidIQD ?? 0), currency: o.currency === 'IQD' ? 'IQD' : 'USD' } as unknown as CartStore
  },
}))
