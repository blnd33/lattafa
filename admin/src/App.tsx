import { Suspense, lazy, useEffect, type ComponentType, type ReactNode } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { CloudOff, Store } from 'lucide-react'
import { ApprovalProvider } from '@/components/ApprovalProvider'
import { PrintHost } from '@/components/PrintHost'
import { BrandMark } from '@/components/ui/Brand'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Controls'
import { ConfirmProvider } from '@/components/ui/Modal'
import { Toaster } from '@/components/ui/Toaster'
import { Credit } from '@/components/layout/Chrome'
import { NoAccess, RequireAny } from '@/features/NoAccess'
import { useAppAddresses } from '@/hooks/useAppAddresses'
import { useBootSession } from '@/hooks/useAuth'
import { htmlLang, isRtl, useT } from '@/i18n'
import { hasPerm } from '@/lib/permissions'
import { pingServer, setUnauthorizedHandler } from '@/services/api'
import { setupStatus } from '@/services/remote'
import { onSynced, startAutoSync } from '@/services/sync'
import { useSession } from '@/store/session'
import { toast } from '@/store/toast'
import { useUI } from '@/store/ui'
import { adminHome, REPORT_PERMS, Shell } from './Shell'
import { SignIn } from './SignIn'
import { DashboardPage } from './dashboard/DashboardPage'

// The management screens are the POS's own (tested there), loaded only when opened.
const lazyPage = <K extends string>(loader: () => Promise<Record<K, ComponentType>>, name: K) =>
  lazy(() => loader().then((m) => ({ default: m[name] })))
const SalesPage = lazyPage(() => import('@/features/sales/SalesPage'), 'SalesPage')
const ReportsPage = lazyPage(() => import('./reports/ReportsPage'), 'ReportsPage')
const ProductsPage = lazyPage(() => import('@/features/products/ProductsPage'), 'ProductsPage')
const ProductSheetPage = lazyPage(() => import('@/features/products/ProductSheetPage'), 'ProductSheetPage')
const InventoryPage = lazyPage(() => import('@/features/inventory/InventoryPage'), 'InventoryPage')
const CustomersPage = lazyPage(() => import('@/features/customers/CustomersPage'), 'CustomersPage')
const DelegatesPage = lazyPage(() => import('@/features/delegates/DelegatesPage'), 'DelegatesPage')
const UsersPage = lazyPage(() => import('@/features/users/UsersPage'), 'UsersPage')
const SettingsPage = lazyPage(() => import('@/features/settings/SettingsPage'), 'SettingsPage')
const AccountPage = lazyPage(() => import('@/features/account/AccountPage'), 'AccountPage')
const ActivityPage = lazyPage(() => import('./activity/ActivityPage'), 'ActivityPage')
const ReviewPage = lazyPage(() => import('./review/ReviewPage'), 'ReviewPage')
const PurchasingPage = lazyPage(() => import('./purchasing/PurchasingPage'), 'PurchasingPage')
const ExpensesPage = lazyPage(() => import('./expenses/ExpensesPage'), 'ExpensesPage')
const MenuPage = lazyPage(() => import('./menu/MenuPage'), 'MenuPage')

const SERVER_KEY = ['admin-server']

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 5_000 } } })

/** Keeps <html> in step with the chosen language (dir/lang) and theme — shared with the POS. */
function useDocumentLook() {
  const lang = useUI((s) => s.lang)
  const theme = useUI((s) => s.theme)
  useEffect(() => {
    document.documentElement.dir = isRtl(lang) ? 'rtl' : 'ltr'
    document.documentElement.lang = htmlLang(lang)
  }, [lang])
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches)
      document.documentElement.classList.toggle('dark', dark)
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#14110F' : '#1A1714')
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])
}

/** Is the shop server there, and has the shop been set up (in the POS)? */
async function checkServer(): Promise<'ok' | 'offline' | 'not-setup'> {
  if (!(await pingServer(6000))) return 'offline'
  return (await setupStatus()) === false ? 'not-setup' : 'ok'
}

/**
 * While someone is signed in: keep the local copy of the shop in step with the server (every 30 s and when the tab comes
 * back), refresh the screens after each sync, and end the session when the server says it is over (password reset,
 * account switched off…).
 */
function useServerSession() {
  const actor = useSession((s) => s.actor)
  const t = useT()
  useBootSession(!!actor)
  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (!useSession.getState().actor) return
      useSession.getState().signOut()
      toast.error(t('err.not_signed_in'))
    })
    const off = onSynced((r) => { if (r.ok) void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== SERVER_KEY[0] }) })
    return () => { setUnauthorizedHandler(null); off() }
  }, [t])
  useEffect(() => (actor ? startAutoSync() : undefined), [actor?.id]) // eslint-disable-line react-hooks/exhaustive-deps
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <main className="grid flex-1 place-items-center p-6">{children}</main>
      <Credit className="pb-4 pb-safe" />
    </div>
  )
}

function Splash() {
  return <Centered><Spinner className="size-10" /></Centered>
}

function Problem({ icon, text, action }: { icon: ReactNode; text: string; action: ReactNode }) {
  return (
    <Centered>
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <BrandMark size="lg" />
        <span className="grid size-14 place-items-center rounded-full bg-surface-2 text-gold-text">{icon}</span>
        <p className="text-base">{text}</p>
        {action}
      </div>
    </Centered>
  )
}

function Gate() {
  const t = useT()
  const apps = useAppAddresses()
  useDocumentLook()
  useServerSession()
  const actor = useSession((s) => s.actor)
  const server = useQuery({ queryKey: SERVER_KEY, queryFn: checkServer, staleTime: Infinity })
  if (server.isLoading) return <Splash />
  if (server.data === 'offline' && !actor) {
    return <Problem icon={<CloudOff className="size-7" />} text={t('ap.offline')} action={<Button loading={server.isFetching} onClick={() => void server.refetch()}>{t('ap.retry')}</Button>} />
  }
  if (server.data === 'not-setup') {
    return <Problem icon={<Store className="size-7" />} text={t('ap.not_setup')} action={<a href={apps.pos} className="inline-flex h-12 items-center rounded-xl bg-gold px-5 font-semibold text-ink">{t('ap.open_pos')}</a>} />
  }
  if (!actor) return <SignIn />
  const can = (perms: string[]) => (page: ReactNode) => <RequireAny perms={perms}>{page}</RequireAny>
  return (
    <Shell>
      <Suspense fallback={<div className="grid h-80 place-items-center" aria-label={t('common.loading')}><Spinner className="size-9" /></div>}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/sales" element={can(['sales.view_own', 'sales.view_all'])(<SalesPage />)} />
          <Route path="/review" element={<ReviewPage />} />
          <Route path="/reports" element={can(REPORT_PERMS)(<ReportsPage />)} />
          <Route path="/products" element={can(['products.create', 'products.edit', 'products.delete'])(<ProductsPage />)} />
          <Route path="/sheet" element={can(['products.import'])(<ProductSheetPage />)} />
          <Route path="/menu" element={can(['products.edit'])(<MenuPage />)} />
          <Route path="/inventory" element={can(['inventory.view'])(<InventoryPage />)} />
          <Route path="/purchasing/*" element={<PurchasingPage />} />
          <Route path="/expenses" element={<ExpensesPage />} />
          <Route path="/customers" element={can(['customers.view'])(<CustomersPage />)} />
          <Route path="/delegates" element={can(['delegates.manage'])(<DelegatesPage />)} />
          <Route path="/users/*" element={can(['users.view'])(<UsersPage />)} />
          <Route path="/activity" element={can(['audit.view'])(<ActivityPage />)} />
          <Route path="/settings" element={can(['settings.view'])(<SettingsPage />)} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Shell>
  )
}

/** The dashboard, or — for someone without it (a stock keeper) — the first screen they may open. */
function Home() {
  const actor = useSession((s) => s.actor)
  const has = (p: string) => !!actor && hasPerm(actor.permissions, p)
  if (has('reports.view')) return <DashboardPage />
  const to = adminHome(has)
  return to && to !== '/' ? <Navigate to={to} replace /> : <NoAccess />
}

export function AdminApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <ConfirmProvider>
          <ApprovalProvider>
            <Gate />
            <PrintHost />
            <Toaster />
          </ApprovalProvider>
        </ConfirmProvider>
      </HashRouter>
    </QueryClientProvider>
  )
}
