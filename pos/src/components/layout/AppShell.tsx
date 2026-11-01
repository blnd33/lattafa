import { useMemo, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { ChevronsLeft, ChevronsRight, Grid2x2, KeyRound } from 'lucide-react'
import { Logo } from '@/components/ui/Brand'
import { Modal } from '@/components/ui/Modal'
import { cn } from '@/components/ui/cn'
import { useT } from '@/i18n'
import { useDevice } from '@/hooks/useDevice'
import { useActor } from '@/hooks/useAuth'
import { hasPerm } from '@/lib/permissions'
import { useUI } from '@/store/ui'
import { NAV, type NavItem } from './nav'
import { Credit, LangSwitch, RateChip, ShiftChip, SyncChip, ThemeToggle, UserMenu } from './Chrome'

function useVisibleNav(): NavItem[] {
  const actor = useActor()
  return useMemo(() => NAV.filter((n) => !!actor && n.perms.some((p) => hasPerm(actor.permissions, p))), [actor])
}

/** Dark, luxurious navigation rail — labels shown when expanded (desktop). */
function Sidebar({ items, expanded }: { items: NavItem[]; expanded: boolean }) {
  const t = useT()
  const toggle = useUI((s) => s.toggleSidebar)
  const device = useDevice()
  const main = items.filter((i) => i.group === 'main')
  const manage = items.filter((i) => i.group === 'manage')
  const link = (n: NavItem) => (
    <NavLink
      key={n.to}
      to={n.to}
      title={t(n.label)}
      className={({ isActive }) =>
        cn(
          'group flex items-center gap-3 rounded-2xl px-3 transition',
          expanded ? 'h-12' : 'h-16 flex-col justify-center gap-1 px-1 text-[10.5px]',
          isActive ? 'bg-gold text-ink shadow-[0_6px_18px_rgba(212,165,72,.25)]' : 'text-[#cfc5b4] hover:bg-white/10 hover:text-white',
        )
      }
    >
      <n.icon className="size-[22px] shrink-0" />
      <span className={cn('truncate font-medium', expanded ? 'text-sm' : 'max-w-full leading-tight')}>{t(n.label)}</span>
    </NavLink>
  )
  return (
    <aside className={cn('flex shrink-0 flex-col bg-ink py-3 text-white ps-safe', expanded ? 'w-60 px-3' : 'w-[5.25rem] px-2')}>
      <div className={cn('mb-3 flex items-center gap-2.5 px-1', !expanded && 'justify-center')}>
        <Logo className="h-11" />
        {expanded && <span className="font-serif text-xl font-semibold tracking-wide text-gold-light">Lattafa</span>}
      </div>
      <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto scroll-hide">
        {main.map(link)}
        {manage.length > 0 && <div className="my-2 border-t border-white/10" />}
        {manage.map(link)}
      </nav>
      {device === 'desktop' && (
        <button type="button" onClick={toggle} aria-label={expanded ? t('nav.collapse') : t('nav.expand')} className="mt-2 flex h-11 items-center justify-center gap-2 rounded-xl text-[#b9ae9c] transition hover:bg-white/10 hover:text-white">
          {expanded ? <ChevronsLeft className="size-5 rtl:rotate-180" /> : <ChevronsRight className="size-5 rtl:rotate-180" />}
          {expanded && <span className="text-xs">{t('nav.collapse')}</span>}
        </button>
      )}
    </aside>
  )
}

function TopBar() {
  const device = useDevice()
  return (
    <header className="flex h-16 shrink-0 items-center gap-2 border-b border-line bg-surface px-3 pt-safe md:gap-3 md:px-5">
      {device === 'phone' && (
        <span className="flex items-center gap-2">
          <Logo className="h-9" />
          <span className="font-serif text-xl font-semibold">Lattafa</span>
        </span>
      )}
      <div className="flex-1" />
      <ShiftChip compact={device !== 'desktop'} />
      <SyncChip compact={device !== 'desktop'} />
      <RateChip />
      {device !== 'phone' && <LangSwitch />}
      {device !== 'phone' && <ThemeToggle />}
      <UserMenu />
    </header>
  )
}

function BottomNav({ items }: { items: NavItem[] }) {
  const t = useT()
  const [more, setMore] = useState(false)
  const navigate = useNavigate()
  const loc = useLocation()
  const bottom = items.filter((i) => i.bottom)
  const rest = items.filter((i) => !i.bottom)
  const restActive = rest.some((r) => loc.pathname.startsWith(r.to))
  return (
    <>
      <nav className="grid shrink-0 border-t border-line bg-surface pb-safe" style={{ gridTemplateColumns: `repeat(${bottom.length + 1}, minmax(0, 1fr))` }} aria-label="Main">
        {bottom.map((n) => (
          <NavLink key={n.to} to={n.to} className={({ isActive }) => cn('flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium transition', isActive ? 'text-gold-text' : 'text-fg-2')}>
            {({ isActive }) => (
              <>
                <span className={cn('grid h-8 w-14 place-items-center rounded-full transition', isActive && 'bg-gold-soft dark:bg-gold/20')}><n.icon className="size-[22px]" /></span>
                {t(n.label)}
              </>
            )}
          </NavLink>
        ))}
        <button type="button" onClick={() => setMore(true)} className={cn('flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium', restActive ? 'text-gold-text' : 'text-fg-2')}>
          <span className={cn('grid h-8 w-14 place-items-center rounded-full', restActive && 'bg-gold-soft dark:bg-gold/20')}><Grid2x2 className="size-[22px]" /></span>
          {t('nav.more')}
        </button>
      </nav>
      <Modal open={more} onClose={() => setMore(false)} title={t('nav.more')} size="sm">
        <div className="grid grid-cols-3 gap-3">
          {rest.map((n) => (
            <button key={n.to} type="button" onClick={() => { setMore(false); navigate(n.to) }} className="flex h-24 flex-col items-center justify-center gap-2 rounded-2xl bg-surface-2 text-xs font-medium transition active:scale-95">
              <n.icon className="size-6 text-gold-text" />
              {t(n.label)}
            </button>
          ))}
          <button type="button" onClick={() => { setMore(false); navigate('/account') }} className="flex h-24 flex-col items-center justify-center gap-2 rounded-2xl bg-surface-2 text-xs font-medium transition active:scale-95">
            <KeyRound className="size-6 text-gold-text" />
            {t('account.title')}
          </button>
        </div>
        <Credit className="mt-5" />
      </Modal>
    </>
  )
}

export function AppShell() {
  const device = useDevice()
  const items = useVisibleNav()
  const sidebarOpen = useUI((s) => s.sidebarOpen)
  return (
    <div className="flex h-dvh bg-bg text-fg">
      {device !== 'phone' && <Sidebar items={items} expanded={device === 'desktop' && sidebarOpen} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain" id="main">
          <Outlet />
        </main>
        {device === 'phone' ? <BottomNav items={items} /> : <div className="shrink-0 border-t border-line bg-surface py-1.5"><Credit /></div>}
      </div>
    </div>
  )
}
