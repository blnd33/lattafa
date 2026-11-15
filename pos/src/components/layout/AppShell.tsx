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
import { Credit, LangSwitch, RateChip, ShiftChip, SyncChip, ThemeToggle, UserMenu, useOtherSections } from './Chrome'

function useVisibleNav(): NavItem[] {
  const actor = useActor()
  return useMemo(() => NAV.filter((n) => !!actor && n.perms.some((p) => hasPerm(actor.permissions, p))), [actor])
}

/** Dark, luxurious navigation rail — labels shown when expanded (desktop). */
function Sidebar({ items, expanded }: { items: NavItem[]; expanded: boolean }) {
  const t = useT()
  const toggle = useUI((s) => s.toggleSidebar)
  const device = useDevice()
  const others = useOtherSections()
  const main = items.filter((i) => i.group === 'main')
  const manage = items.filter((i) => i.group === 'manage')
  // Items give up height to fit a short screen (a landscape tablet, a 768 px touch screen) but never below a finger-
  // sized 36 px, so the gold pill always holds its icon; past that the menu scrolls. Labels shrink (min-w-0 + truncate)
  // instead of pushing the pill wider.
  const link = (n: NavItem) => (
    <NavLink
      key={n.to}
      to={n.to}
      title={t(n.label)}
      className={({ isActive }) =>
        cn(
          'group flex min-w-0 items-center gap-3 overflow-hidden rounded-2xl px-3 transition',
          expanded ? 'h-12 min-h-9' : 'h-16 min-h-14 flex-col justify-center gap-0.5 px-1 text-[10.5px]',
          isActive ? 'bg-gold text-ink shadow-[0_4px_12px_rgba(212,165,72,.25)]' : 'text-[#cfc5b4] hover:bg-white/10 hover:text-white',
        )
      }
    >
      <n.icon className="size-[22px] shrink-0" />
      <span className={cn('min-w-0 font-medium', expanded ? 'truncate text-sm' : 'line-clamp-2 max-w-full text-center leading-[1.15] tracking-tight')}>{t(n.label)}</span>
    </NavLink>
  )
  return (
    <aside className={cn('flex min-h-0 shrink-0 flex-col overflow-hidden bg-ink py-[clamp(0.375rem,1.2dvh,0.75rem)] text-white', expanded ? 'w-60 px-3 ps-[max(0.75rem,env(safe-area-inset-left))]' : 'w-[5.75rem] px-1.5 ps-[max(0.375rem,env(safe-area-inset-left))]')}>
      <div className={cn('mb-[clamp(0.25rem,1.2dvh,0.75rem)] flex shrink-0 items-center gap-2.5 px-1', !expanded && 'justify-center')}>
        <Logo className="h-[clamp(2rem,5dvh,2.75rem)]" />
        {expanded && <span className="font-serif text-xl font-semibold tracking-wide text-gold-light">Lattafa</span>}
      </div>
      {/* scrolls when it still does not fit; the thin bar shows there is more, and the padding keeps the active pill's shadow from being clipped */}
      <nav aria-label="Main" className="-mx-1 flex min-h-0 flex-1 flex-col gap-[clamp(0.0625rem,0.4dvh,0.25rem)] overflow-y-auto overscroll-contain px-1 py-0.5 [scrollbar-color:rgba(255,255,255,.18)_transparent] [scrollbar-width:thin]">
        {main.map(link)}
        {manage.length > 0 && <div className="my-[clamp(0.25rem,1dvh,0.5rem)] shrink-0 border-t border-white/10" />}
        {manage.map(link)}
        {/* the other sections open in a tab of their own, so the till (and a sale on it) stays as it is */}
        <div className="my-[clamp(0.25rem,1dvh,0.5rem)] shrink-0 border-t border-white/10" />
        {expanded && <p className="shrink-0 truncate px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-[#8f8574] rtl:tracking-normal">{t('nav.sections')}</p>}
        {others.map((o) => (
          <a key={o.key} href={o.href} target="_blank" rel="noopener" title={t(o.label)}
            className={cn('flex min-w-0 items-center gap-3 overflow-hidden rounded-2xl px-3 text-[#cfc5b4] transition hover:bg-white/10 hover:text-white', expanded ? 'h-11 min-h-9' : 'h-16 min-h-14 flex-col justify-center gap-0.5 px-1 text-[10.5px]')}>
            <o.icon className="size-[22px] shrink-0" />
            <span className={cn('min-w-0 font-medium', expanded ? 'truncate text-sm' : 'line-clamp-2 max-w-full text-center leading-[1.15] tracking-tight')}>{t(o.label)}</span>
          </a>
        ))}
      </nav>
      {device === 'desktop' && (
        <button type="button" onClick={toggle} aria-label={expanded ? t('nav.collapse') : t('nav.expand')} className="mt-1 flex h-[clamp(2.25rem,5dvh,2.75rem)] shrink-0 items-center justify-center gap-2 rounded-xl text-[#b9ae9c] transition hover:bg-white/10 hover:text-white">
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
    // the bar's colour runs up under the phone's status bar, but its contents stay below it:
    // the inset is padding on the outside, the 4 rem row lives in its own box inside
    <header className="shrink-0 border-b border-line bg-surface pt-safe ps-safe pe-safe">
      <div className="flex h-16 min-w-0 items-center gap-2 px-3 md:gap-3 md:px-5">
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
        {/* tablets: language and theme move into the user menu so the bar never runs out of room */}
        {device === 'desktop' && <LangSwitch />}
        {device === 'desktop' && <ThemeToggle />}
        <UserMenu />
      </div>
    </header>
  )
}

function BottomNav({ items }: { items: NavItem[] }) {
  const t = useT()
  const [more, setMore] = useState(false)
  const navigate = useNavigate()
  const loc = useLocation()
  const others = useOtherSections()
  const bottom = items.filter((i) => i.bottom)
  const rest = items.filter((i) => !i.bottom)
  const restActive = rest.some((r) => loc.pathname.startsWith(r.to))
  return (
    <>
      <nav className="grid shrink-0 border-t border-line bg-surface pb-safe ps-safe pe-safe" style={{ gridTemplateColumns: `repeat(${bottom.length + 1}, minmax(0, 1fr))` }} aria-label="Main">
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
        <p className="mb-2 mt-5 text-xs font-semibold text-fg-2">{t('nav.sections')}</p>
        <div className="grid grid-cols-3 gap-3">
          {others.map((o) => (
            <a key={o.key} href={o.href} target="_blank" rel="noopener" onClick={() => setMore(false)} className="flex h-24 flex-col items-center justify-center gap-2 rounded-2xl bg-surface-2 text-center text-xs font-medium transition active:scale-95">
              <o.icon className="size-6 text-gold-text" />
              {t(o.label)}
            </a>
          ))}
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
