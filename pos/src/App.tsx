import { Suspense, lazy, useEffect, type ReactNode } from 'react'
import { HashRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { ApprovalProvider } from '@/components/ApprovalProvider'
import { PrintHost } from '@/components/PrintHost'
import { AppShell } from '@/components/layout/AppShell'
import { homeFor } from '@/components/layout/nav'
import { ConfirmProvider } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Controls'
import { Toaster } from '@/components/ui/Toaster'
import { SignIn } from '@/features/auth/SignIn'
import { SetupPage } from '@/features/setup/SetupPage'
import { ConnectPrompt } from '@/features/setup/ConnectPrompt'
import { SellPage } from '@/features/sell/SellPage'
import { NoAccess, RequireAny } from '@/features/NoAccess'
import { htmlLang, isRtl, useT } from '@/i18n'
import { hasPerm } from '@/lib/permissions'
import { isSetupDone } from '@/services/auth'
import { setUnauthorizedHandler } from '@/services/api'
import { initConnection } from '@/services/connection'
import { onSynced, startAutoSync } from '@/services/sync'
import { toast } from '@/store/toast'
import { useAutoLock, useBootSession } from '@/hooks/useAuth'
import { useWakeLock } from '@/hooks/useDevice'
import { useSession } from '@/store/session'
import { useUI } from '@/store/ui'

// Everything except the selling screen is code-split so a phone loads the till first.
const lazyPage = <K extends string>(loader: () => Promise<Record<K, React.ComponentType>>, name: K) =>
  lazy(() => loader().then((m) => ({ default: m[name] })))
const SalesPage = lazyPage(() => import('@/features/sales/SalesPage'), 'SalesPage')
const CustomersPage = lazyPage(() => import('@/features/customers/CustomersPage'), 'CustomersPage')
const ShiftPage = lazyPage(() => import('@/features/shifts/ShiftPage'), 'ShiftPage')
const ProductsPage = lazyPage(() => import('@/features/products/ProductsPage'), 'ProductsPage')
const ProductSheetPage = lazyPage(() => import('@/features/products/ProductSheetPage'), 'ProductSheetPage')
const InventoryPage = lazyPage(() => import('@/features/inventory/InventoryPage'), 'InventoryPage')
const ReportsPage = lazyPage(() => import('@/features/reports/ReportsPage'), 'ReportsPage')
const UsersPage = lazyPage(() => import('@/features/users/UsersPage'), 'UsersPage')
const SettingsPage = lazyPage(() => import('@/features/settings/SettingsPage'), 'SettingsPage')
const DelegatesPage = lazyPage(() => import('@/features/delegates/DelegatesPage'), 'DelegatesPage')
const AccountPage = lazyPage(() => import('@/features/account/AccountPage'), 'AccountPage')

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 5_000 } } })

/** Keeps <html> in sync with the chosen language (dir/lang) and theme (dark class, browser chrome colour). */
function useDocumentTheme() {
  const lang = useUI((s) => s.lang)
  const theme = useUI((s) => s.theme)
  useEffect(() => {
    const root = document.documentElement
    root.dir = isRtl(lang) ? 'rtl' : 'ltr'
    root.lang = htmlLang(lang)
  }, [lang])
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
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

function Splash() {
  return <div className="grid h-dvh place-items-center bg-bg"><Spinner className="size-10" /></div>
}

/** Setup → sign-in → lock screen, then the app. */
function Gate() {
  const { data: setup, isLoading } = useQuery({ queryKey: ['setup'], queryFn: isSetupDone })
  const actor = useSession((s) => s.actor)
  const locked = useSession((s) => s.locked)
  useBootSession(!!setup)
  useAutoLock()
  useWakeLock(!!actor)
  if (isLoading) return <Splash />
  if (!setup) return <Navigate to="/setup" replace />
  if (!actor) return <SignIn />
  if (locked) return <SignIn lockedUserId={actor.id} />
  return <Outlet />
}

function Home() {
  const actor = useSession((s) => s.actor)
  return <Navigate to={homeFor((p) => !!actor && hasPerm(actor.permissions, p))} replace />
}

function SetupRoute() {
  const { data: setup, isLoading } = useQuery({ queryKey: ['setup'], queryFn: isSetupDone })
  if (isLoading) return <Splash />
  return setup ? <Navigate to="/" replace /> : <SetupPage />
}

function Guarded({ perms, children }: { perms: string[]; children: ReactNode }) {
  return <RequireAny perms={perms}>{children}</RequireAny>
}

/**
 * Connected mode: keep syncing while someone is signed in, refresh every screen after a sync, and end the session if
 * the server says the token is no longer valid (password reset, account disabled, device revoked…).
 */
function useServerSync(connected: boolean) {
  const actor = useSession((s) => s.actor)
  const t = useT()
  useEffect(() => {
    if (!connected) return
    setUnauthorizedHandler(() => {
      if (!useSession.getState().actor) return
      useSession.getState().signOut()
      toast.error(t('err.not_signed_in'))
    })
    const off = onSynced((r) => { if (r.ok) void queryClient.invalidateQueries() })
    return () => { setUnauthorizedHandler(null); off() }
  }, [connected, t])
  useEffect(() => (connected && actor ? startAutoSync() : undefined), [connected, actor?.id]) // eslint-disable-line react-hooks/exhaustive-deps
}

function Routing() {
  useDocumentTheme()
  const t = useT()
  const conn = useQuery({ queryKey: ['connection'], queryFn: initConnection, staleTime: Infinity })
  useServerSync(conn.data === 'server')
  if (conn.isLoading) return <Splash />
  if (conn.data === 'needs-choice') {
    return <ConnectPrompt onDone={() => { void queryClient.resetQueries({ queryKey: ['connection'] }); void queryClient.invalidateQueries() }} />
  }
  return (
    <Suspense fallback={<div className="grid h-full place-items-center" aria-label={t('common.loading')}><Spinner className="size-9" /></div>}>
      <Routes>
        <Route path="/setup" element={<SetupRoute />} />
        <Route element={<Gate />}>
          <Route element={<AppShell />}>
            <Route index element={<Home />} />
            <Route path="sell" element={<Guarded perms={['pos.sell']}><SellPage /></Guarded>} />
            <Route path="sales" element={<Guarded perms={['sales.view_own', 'sales.view_all']}><SalesPage /></Guarded>} />
            <Route path="customers" element={<Guarded perms={['customers.view']}><CustomersPage /></Guarded>} />
            <Route path="shift" element={<Guarded perms={['shifts.open', 'shifts.close']}><ShiftPage /></Guarded>} />
            <Route path="products" element={<Guarded perms={['products.create', 'products.edit', 'products.delete']}><ProductsPage /></Guarded>} />
            <Route path="sheet" element={<Guarded perms={['products.import']}><ProductSheetPage /></Guarded>} />
            <Route path="inventory" element={<Guarded perms={['inventory.view']}><InventoryPage /></Guarded>} />
            <Route path="delegates" element={<Guarded perms={['delegates.manage']}><DelegatesPage /></Guarded>} />
            <Route path="reports" element={<Guarded perms={['reports.view']}><ReportsPage /></Guarded>} />
            <Route path="users/*" element={<Guarded perms={['users.view']}><UsersPage /></Guarded>} />
            <Route path="settings" element={<Guarded perms={['settings.view']}><SettingsPage /></Guarded>} />
            <Route path="account" element={<AccountPage />} />
            <Route path="no-access" element={<NoAccess />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  )
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <ConfirmProvider>
          <ApprovalProvider>
            <Routing />
            <PrintHost />
            <Toaster />
          </ApprovalProvider>
        </ConfirmProvider>
      </HashRouter>
    </QueryClientProvider>
  )
}
