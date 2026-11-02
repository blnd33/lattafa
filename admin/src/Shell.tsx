import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  BarChart3, BookOpen, Boxes, ClipboardList, FileSpreadsheet, History, Inbox, MonitorSmartphone, KeyRound, Languages, LayoutDashboard, LogOut, Menu as MenuIcon, Package, Receipt, Settings,
  ShieldAlert, ShieldCheck, Sun, Truck, Users, Wallet, X, type LucideIcon,
} from 'lucide-react'
import { Logo } from '@/components/ui/Brand'
import { Avatar, Badge } from '@/components/ui/Controls'
import { Menu, MenuItem } from '@/components/ui/Menu'
import { cn } from '@/components/ui/cn'
import { Credit, LangSwitch, ThemeToggle } from '@/components/layout/Chrome'
import { useAppAddresses } from '@/hooks/useAppAddresses'
import { useDevice } from '@/hooks/useDevice'
import { LANGS, useT } from '@/i18n'
import { hasPerm } from '@/lib/permissions'
import { logout } from '@/services/remote'
import { useSession } from '@/store/session'
import { REPORTS } from './reports/api'
import { useUI, type ThemeChoice } from '@/store/ui'

type Section = 'overview' | 'catalogue' | 'money' | 'people' | 'system'

export interface AdminNavItem {
  to: string
  icon: LucideIcon
  label: string // i18n key
  /** shown when the person holds ANY of these permissions */
  perms: string[]
  section: Section
}

/** Anyone allowed at least one report sees Reports (a stock keeper gets the stock ones). */
export const REPORT_PERMS = [...new Set(REPORTS.map((r) => r.perm))]

/** The screens (most are the POS's own, run against the server), grouped as in the sidebar. */
export const ADMIN_NAV: AdminNavItem[] = [
  { to: '/', icon: LayoutDashboard, label: 'ap.nav_dashboard', perms: ['reports.view'], section: 'overview' },
  { to: '/sales', icon: Receipt, label: 'nav.sales', perms: ['sales.view_own', 'sales.view_all'], section: 'overview' },
  { to: '/review', icon: ShieldAlert, label: 'ap.nav_review', perms: ['sales.view_all'], section: 'overview' },
  { to: '/reports', icon: BarChart3, label: 'nav.reports', perms: REPORT_PERMS, section: 'overview' },
  { to: '/products', icon: Package, label: 'nav.products', perms: ['products.create', 'products.edit', 'products.delete'], section: 'catalogue' },
  { to: '/sheet', icon: FileSpreadsheet, label: 'nav.sheet', perms: ['products.import'], section: 'catalogue' },
  { to: '/menu', icon: BookOpen, label: 'ap.nav_menu', perms: ['products.edit'], section: 'catalogue' },
  { to: '/inventory', icon: Boxes, label: 'nav.inventory', perms: ['inventory.view'], section: 'catalogue' },
  { to: '/purchasing', icon: ClipboardList, label: 'ap.nav_purchasing', perms: ['purchasing.view'], section: 'catalogue' },
  { to: '/expenses', icon: Wallet, label: 'ap.nav_expenses', perms: ['expenses.view'], section: 'money' },
  { to: '/customers', icon: Users, label: 'nav.customers', perms: ['customers.view'], section: 'people' },
  { to: '/orders', icon: Inbox, label: 'ap.nav_orders', perms: ['delegate.sell', 'delegates.manage'], section: 'people' },
  { to: '/delegates', icon: Truck, label: 'nav.delegates', perms: ['delegates.manage'], section: 'people' },
  { to: '/users', icon: ShieldCheck, label: 'nav.users', perms: ['users.view'], section: 'people' },
  { to: '/activity', icon: History, label: 'ap.nav_activity', perms: ['audit.view'], section: 'system' },
  { to: '/settings', icon: Settings, label: 'nav.settings', perms: ['settings.view'], section: 'system' },
]
const SECTIONS: Section[] = ['overview', 'catalogue', 'money', 'people', 'system']

/** Where someone lands: the dashboard, or the first screen they may open (a stock keeper has no dashboard). */
export function adminHome(has: (perm: string) => boolean): string | null {
  // everyday screens first (a stock keeper starts on Products, not on Reports), then the sidebar's order
  const first = ['/', '/products', '/inventory', '/purchasing', '/sales', '/activity']
  const open = ADMIN_NAV.filter((n) => n.perms.some(has))
  const preferred = first.map((to) => open.find((n) => n.to === to)).find(Boolean)
  return (preferred ?? open[0])?.to ?? null
}

function useNavItems(): AdminNavItem[] {
  const actor = useSession((s) => s.actor)
  return useMemo(() => ADMIN_NAV.filter((n) => !!actor && n.perms.some((p) => hasPerm(actor.permissions, p))), [actor])
}

function NavItems({ items, compact, onPick }: { items: AdminNavItem[]; compact?: boolean; onPick?: () => void }) {
  const t = useT()
  return (
    <nav aria-label="Main" className="-me-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pe-1 [scrollbar-color:rgba(255,255,255,.18)_transparent] [scrollbar-width:thin]">
      {SECTIONS.map((sec, i) => {
        const mine = items.filter((n) => n.section === sec)
        if (!mine.length) return null
        return (
          <div key={sec} className="flex flex-col gap-0.5">
            {compact ? (i > 0 && <div className="my-1.5 border-t border-white/10" />) : (
              <div className="px-3 pb-0.5 pt-1.5 text-[11px] leading-4 font-semibold uppercase tracking-[.14em] text-[#8a8178] first:pt-0 rtl:tracking-normal">{t(`ap.sec_${sec}`)}</div>
            )}
            {mine.map((n) => <NavItem key={n.to} n={n} compact={compact} onPick={onPick} />)}
          </div>
        )
      })}
    </nav>
  )
}

function NavItem({ n, compact, onPick }: { n: AdminNavItem; compact?: boolean; onPick?: () => void }) {
  const t = useT()
  return (
    <NavLink
      to={n.to}
      end={n.to === '/'}
      title={t(n.label)}
      onClick={onPick}
      className={({ isActive }) => cn(
        'flex shrink-0 items-center gap-3 rounded-xl transition',
        compact ? 'min-h-14 flex-col justify-center gap-0.5 px-1 py-1.5 text-[10px]' : 'h-9 px-3 text-sm',
        isActive ? 'bg-gold text-ink shadow-[0_6px_18px_rgba(212,165,72,.25)]' : 'text-[#cfc5b4] hover:bg-white/10 hover:text-white',
      )}
    >
      <n.icon className="size-5 shrink-0" />
      <span className={cn('font-medium', compact ? 'line-clamp-2 max-w-full text-center leading-tight' : 'truncate')}>{t(n.label)}</span>
    </NavLink>
  )
}

function SideBrand({ compact }: { compact?: boolean }) {
  const t = useT()
  return (
    <div className={cn('mb-2 flex items-center gap-2.5 px-1', compact && 'justify-center')}>
      <Logo className="h-11" />
      {!compact && (
        <span className="leading-tight">
          <span className="block font-serif text-xl font-semibold tracking-wide text-gold-light">Lattafa</span>
          <span className="block text-[11px] uppercase tracking-[.18em] text-[#b9ae9c]">{t('ap.title')}</span>
        </span>
      )}
    </div>
  )
}

/** The other Lattafa apps — POS, delegate app, customer menu — each at its own address (each has its own sign-in). */
function AppLinks({ compact }: { compact?: boolean }) {
  const t = useT()
  const at = useAppAddresses()
  const links: [string, LucideIcon, string][] = [[at.pos, MonitorSmartphone, 'ap.open_pos'], [at.delegate, Truck, 'ap.open_delegate'], [at.menu, BookOpen, 'ap.open_menu']]
  return (
    <div className="mt-2 flex flex-col gap-0.5 border-t border-white/10 pt-2">
      {links.map(([href, Icon, label]) => (
        <a key={label} href={href} target="_blank" rel="noopener" title={t(label)}
          className={cn('flex items-center gap-2 rounded-xl text-[#b9ae9c] transition hover:bg-white/10 hover:text-white', compact ? 'h-11 justify-center' : 'h-9 px-3 text-sm')}>
          <Icon className="size-5 shrink-0" />
          {!compact && <span className="truncate">{t(label)}</span>}
        </a>
      ))}
    </div>
  )
}

function UserMenu() {
  const actor = useSession((s) => s.actor)
  const signOut = useSession((s) => s.signOut)
  const t = useT()
  const lang = useUI((s) => s.lang)
  const setLang = useUI((s) => s.setLang)
  const theme = useUI((s) => s.theme)
  const setTheme = useUI((s) => s.setTheme)
  const navigate = useNavigate()
  if (!actor) return null
  const leave = async () => {
    await logout() // ends the session on the server too: this may be a shared computer
    signOut()
  }
  return (
    <Menu
      title={actor.name}
      trigger={({ toggle }) => (
        <button type="button" onClick={toggle} aria-label={t('ap.signed_in_as', { name: actor.name })} className="flex h-11 items-center gap-2.5 rounded-xl px-1 transition hover:bg-surface-2 lg:pe-3">
          <Avatar name={actor.name} color={actor.color} size={38} />
          <span className="hidden text-start leading-tight lg:block">
            <span className="block max-w-36 truncate text-sm font-semibold">{actor.name}</span>
            <span className="block text-xs text-fg-2">{actor.roleName}</span>
          </span>
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="flex items-center gap-3 px-3 py-3">
            <Avatar name={actor.name} color={actor.color} size={44} />
            <div className="min-w-0">
              <div className="truncate font-semibold">{actor.name}</div>
              <Badge tone={actor.isSuperAdmin ? 'gold' : 'neutral'}>{actor.roleName}</Badge>
            </div>
          </div>
          <div className="my-1 border-t border-line" />
          <div className="px-3 py-2 md:hidden">
            <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-fg-2"><Languages className="size-4" />{t('common.language')}</div>
            <div className="flex gap-2">
              {LANGS.map((l) => (
                <button key={l.code} type="button" onClick={() => setLang(l.code)} aria-pressed={lang === l.code} className={cn('h-11 flex-1 rounded-xl text-sm font-semibold', lang === l.code ? 'bg-gold text-ink' : 'bg-surface-2')}>{l.label}</button>
              ))}
            </div>
            <div className="mb-1.5 mt-3 flex items-center gap-2 text-xs font-medium text-fg-2"><Sun className="size-4" />{t('common.theme')}</div>
            <div className="flex gap-2">
              {(['light', 'dark', 'system'] as ThemeChoice[]).map((th) => (
                <button key={th} type="button" onClick={() => setTheme(th)} aria-pressed={theme === th} className={cn('h-11 flex-1 rounded-xl text-sm font-semibold', theme === th ? 'bg-gold text-ink' : 'bg-surface-2')}>{t(`theme.${th}`)}</button>
              ))}
            </div>
          </div>
          <div className="my-1 border-t border-line md:hidden" />
          <MenuItem icon={<KeyRound className="size-5" />} onClick={() => { close(); navigate('/account') }}>{t('account.title')}</MenuItem>
          <MenuItem icon={<LogOut className="size-5 rtl:rotate-180" />} danger onClick={() => { close(); void leave() }}>{t('auth.sign_out')}</MenuItem>
        </>
      )}
    </Menu>
  )
}

/** Phones: the navigation slides in from the side. */
function Drawer({ open, onClose, items }: { open: boolean; onClose: () => void; items: AdminNavItem[] }) {
  const t = useT()
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40 flex" role="dialog" aria-modal="true" aria-label={t('ap.title')}>
      <button type="button" aria-label={t('common.close')} className="absolute inset-0 bg-overlay" onClick={onClose} />
      <aside className="relative flex w-72 max-w-[85%] flex-col bg-ink px-3 py-3 pt-safe text-white">
        <div className="flex items-start justify-between">
          <SideBrand />
          <button type="button" onClick={onClose} aria-label={t('common.close')} className="grid size-11 place-items-center rounded-xl text-[#cfc5b4] hover:bg-white/10"><X className="size-5" /></button>
        </div>
        <NavItems items={items} onPick={onClose} />
        <AppLinks />
      </aside>
    </div>
  )
}

export function Shell({ children }: { children: ReactNode }) {
  const t = useT()
  const device = useDevice()
  const items = useNavItems()
  const [drawer, setDrawer] = useState(false)
  const loc = useLocation()
  useEffect(() => setDrawer(false), [loc.pathname])
  const compact = device === 'tablet'
  return (
    <div className="flex h-dvh bg-bg text-fg">
      {device !== 'phone' && (
        <aside className={cn('flex shrink-0 flex-col bg-ink py-3 text-white ps-safe', compact ? 'w-[5.25rem] px-2' : 'w-64 px-3')}>
          <SideBrand compact={compact} />
          <NavItems items={items} compact={compact} />
          <AppLinks compact={compact} />
        </aside>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-2 border-b border-line bg-surface px-3 pt-safe md:gap-3 md:px-6">
          {device === 'phone' && (
            <>
              <button type="button" onClick={() => setDrawer(true)} aria-label={t('nav.more')} className="grid size-11 place-items-center rounded-xl bg-surface-2"><MenuIcon className="size-5" /></button>
              <Logo className="h-9" />
            </>
          )}
          <div className="flex-1" />
          {device !== 'phone' && <LangSwitch />}
          {device !== 'phone' && <ThemeToggle />}
          <UserMenu />
        </header>
        <main id="main" className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {children}
          <Credit className="px-4 pb-5 pt-2 pb-safe" />
        </main>
      </div>
      {device === 'phone' && <Drawer open={drawer} onClose={() => setDrawer(false)} items={items} />}
    </div>
  )
}
