/**
 * Data hooks. Every screen reads through TanStack Query so results are cached and
 * shared; after any write we simply invalidate everything (the local database is
 * fast, and it keeps the screens consistent). When the Laravel API is added, these
 * same hooks keep working — only the services underneath change.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query'
import { useSession } from '@/store/session'
import { useT, errorMessage } from '@/i18n'
import { toast } from '@/store/toast'
import { getSettings } from '@/services/settings'
import { listCatalog } from '@/services/catalog'
import { getMyOpenShift, listShifts } from '@/services/shifts'
import { listCustomers } from '@/services/customers'
import { listSales, type SaleFilter } from '@/services/sales'
import { listHolds } from '@/services/holds'
import { pendingCount } from '@/services/sync'
import { listUsers, listRoles } from '@/services/users'
import { lowStock } from '@/services/reports'

function useEnabled() {
  return !!useSession((s) => s.actor)
}

type Opts<T> = Omit<UseQueryOptions<T>, 'queryKey' | 'queryFn'>

export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: getSettings, staleTime: 60_000 })

export function useCatalog(o: Opts<Awaited<ReturnType<typeof listCatalog>>> = {}) {
  const enabled = useEnabled()
  return useQuery({ queryKey: ['catalog'], queryFn: () => listCatalog(), enabled, ...o })
}

export function useCatalogAll() {
  const enabled = useEnabled()
  return useQuery({ queryKey: ['catalog', 'all'], queryFn: () => listCatalog({ includeInactive: true }), enabled })
}

export function useMyShift() {
  const enabled = useEnabled()
  const id = useSession((s) => s.actor?.id)
  return useQuery({ queryKey: ['shift', 'open', id], queryFn: getMyOpenShift, enabled })
}

export function useShifts() {
  const enabled = useEnabled()
  return useQuery({ queryKey: ['shifts'], queryFn: listShifts, enabled })
}

export function useCustomers() {
  const enabled = useEnabled()
  return useQuery({ queryKey: ['customers'], queryFn: listCustomers, enabled })
}

export function useSales(filter: SaleFilter = {}) {
  const enabled = useEnabled()
  return useQuery({ queryKey: ['sales', filter], queryFn: () => listSales(filter), enabled })
}

export function useHolds() {
  const enabled = useEnabled()
  return useQuery({ queryKey: ['holds'], queryFn: listHolds, enabled })
}

export function usePending() {
  return useQuery({ queryKey: ['outbox'], queryFn: pendingCount, refetchInterval: 15_000 })
}

export function useUsers() {
  const enabled = useEnabled()
  return useQuery({ queryKey: ['users'], queryFn: listUsers, enabled })
}

export function useRoles() {
  const enabled = useEnabled()
  return useQuery({ queryKey: ['roles'], queryFn: listRoles, enabled })
}

export function useLowStock() {
  const enabled = useEnabled()
  return useQuery({ queryKey: ['lowstock'], queryFn: lowStock, enabled })
}

/**
 * `const run = useAction(fn)` → `run(args)` calls the service, invalidates every
 * cached query on success, and shows a translated toast on failure.
 */
type Ok<R> = [R] extends [void] ? true : R

export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>, opts: { success?: string; silent?: boolean } = {}) {
  const qc = useQueryClient()
  const t = useT()
  const m = useMutation({ mutationFn: (args: A) => fn(...args) })
  /** Resolves to the service result, `true` for services that return nothing, or `undefined` if it failed. */
  const run = async (...args: A): Promise<Ok<R> | undefined> => {
    try {
      const r = await m.mutateAsync(args)
      await qc.invalidateQueries()
      if (opts.success) toast.success(t(opts.success))
      return (r === undefined ? true : r) as Ok<R>
    } catch (e) {
      if (!opts.silent) toast.error(errorMessage(e, t))
      console.warn(e)
      return undefined
    }
  }
  return Object.assign(run, { busy: m.isPending })
}
