import { useEffect, type ReactNode } from 'react'
import { HashRouter, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query'
import { Boxes, Home, MoreHorizontal, ShoppingBag, Users } from 'lucide-react'
import { ConfirmProvider } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Controls'
import { Toaster } from '@/components/ui/Toaster'
import { cn } from '@/components/ui/cn'
import { htmlLang, isRtl, useT } from '@/i18n'
import { setUnauthorizedHandler } from '@/services/api'
import { toast } from '@/store/toast'
import { useUI } from '@/store/ui'
import { initDevice, useSession } from './auth'
import { onSynced, startAutoSync } from './sync'
import { startTracking } from './tracker'
import { BindScreen, SignInScreen } from './screens/Auth'
import { HomeScreen } from './screens/Home'
import { StockScreen } from './screens/Stock'
import { SellScreen } from './screens/Sell'
import { CustomersScreen } from './screens/Customers'
import { MoreScreen } from './screens/More'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 2_000 } } })

function useDocumentLook() {
  const lang = useUI((s) => s.lang)
  const theme = useUI((s) => s.theme)
  useEffect(() => { document.documentElement.dir = isRtl(lang) ? 'rtl' : 'ltr'; document.documentElement.lang = htmlLang(lang) }, [lang])
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const apply = () => document.documentElement.classList.toggle('dark', theme === 'dark' || (theme === 'system' && mq.matches))
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])
}

/** While signed in: sync every 30 s / when the signal returns, refresh the screens after each sync, end a revoked session. */
function useBackgroundSync() {
  const actor = useSession((s) => s.actor)
  const qc = useQueryClient()
  const t = useT()
  useEffect(() => {
    setUnauthorizedHandler(() => { if (useSession.getState().actor) { useSession.getState().signOut(); toast.error(t('err.not_signed_in')) } })
    const off = onSynced((r) => { if (r.ok) void qc.invalidateQueries() })
    return () => { setUnauthorizedHandler(null); off() }
  }, [qc, t])
  useEffect(() => (actor ? startAutoSync() : undefined), [actor?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  // live location for the shop, only while someone is signed in
  useEffect(() => (actor ? startTracking() : undefined), [actor?.id]) // eslint-disable-line react-hooks/exhaustive-deps
}

function Gate() {
  useDocumentLook()
  useBackgroundSync()
  const actor = useSession((s) => s.actor)
  const device = useQuery({ queryKey: ['device'], queryFn: initDevice, staleTime: Infinity })
  if (device.isLoading) return <div className="grid min-h-dvh place-items-center bg-bg"><Spinner className="size-10" /></div>
  if (!device.data?.bound) return <BindScreen />
  if (!actor) return <SignInScreen />
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<HomeScreen />} />
        <Route path="/stock" element={<StockScreen />} />
        <Route path="/sell" element={<SellScreen />} />
        <Route path="/customers" element={<CustomersScreen />} />
        <Route path="/more" element={<MoreScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  )
}

/** Phone layout: the screen, and a bottom navigation within thumb reach. */
function Shell({ children }: { children: ReactNode }) {
  const t = useT()
  const tabs = [
    { to: '/', icon: Home, label: t('dl.nav_home') },
    { to: '/stock', icon: Boxes, label: t('dl.nav_stock') },
    { to: '/sell', icon: ShoppingBag, label: t('dl.nav_sell') },
    { to: '/customers', icon: Users, label: t('dl.nav_customers') },
    { to: '/more', icon: MoreHorizontal, label: t('dl.nav_more') },
  ]
  // selling is laid out like the POS: on a tablet the perfumes and the bill sit side by side
  const wide = useLocation().pathname === '/sell'
  return (
    <div className={cn('mx-auto flex min-h-dvh flex-col bg-bg', wide ? 'max-w-6xl' : 'max-w-xl')}>
      <main className="flex-1 pb-[calc(5rem+env(safe-area-inset-bottom))]">{children}</main>
      <nav aria-label={t('dl.nav')} className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-safe backdrop-blur">
        <div className="mx-auto grid max-w-xl grid-cols-5">
          {tabs.map(({ to, icon: Icon, label }) => (
            <NavLink key={to} to={to} end={to === '/'}
              className={({ isActive }) => cn('flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium', isActive ? 'text-gold-text' : 'text-fg-2')}>
              {({ isActive }) => (<><span className={cn('grid h-8 w-12 place-items-center rounded-full transition', isActive && 'bg-gold-soft dark:bg-gold/15')}><Icon className="size-5" /></span>{label}</>)}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}

export function DelegateApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <ConfirmProvider>
          <Gate />
          <Toaster />
        </ConfirmProvider>
      </HashRouter>
    </QueryClientProvider>
  )
}
