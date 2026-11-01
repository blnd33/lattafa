import { BookOpen, Cloud, CloudOff, LayoutDashboard, Lock, LogOut, Moon, Sun, Monitor, KeyRound, Clock, Languages } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Avatar, Badge } from '@/components/ui/Controls'
import { Menu, MenuItem } from '@/components/ui/Menu'
import { cn } from '@/components/ui/cn'
import { LANGS, useT } from '@/i18n'
import { useUI, type ThemeChoice } from '@/store/ui'
import { useSession } from '@/store/session'
import { useMyShift, usePending, useSettings } from '@/hooks/queries'
import { useAppAddresses } from '@/hooks/useAppAddresses'
import { hasPerm } from '@/lib/permissions'
import { useOnline } from '@/hooks/useDevice'
import { fmtTime } from '@/lib/date'
import { fmt } from '@/lib/money'
import { audit } from '@/services/audit'
import { syncNow } from '@/services/sync'

/** EN | عربي | کوردی */
export function LangSwitch({ className }: { className?: string }) {
  const lang = useUI((s) => s.lang)
  const setLang = useUI((s) => s.setLang)
  return (
    <div dir="ltr" role="group" aria-label="Language" className={cn('inline-flex rounded-full bg-surface-2 p-0.5', className)}>
      {LANGS.map((l) => (
        <button
          key={l.code}
          type="button"
          aria-pressed={lang === l.code}
          onClick={() => setLang(l.code)}
          className={cn('h-9 rounded-full px-3 text-xs font-semibold transition', lang === l.code ? 'bg-gold text-ink' : 'text-fg-2 hover:text-fg')}
        >
          {l.label}
        </button>
      ))}
    </div>
  )
}

export function ThemeToggle({ className }: { className?: string }) {
  const theme = useUI((s) => s.theme)
  const setTheme = useUI((s) => s.setTheme)
  const t = useT()
  const order: ThemeChoice[] = ['light', 'dark', 'system']
  const next = order[(order.indexOf(theme) + 1) % 3]
  const Icon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor
  return (
    <button
      type="button"
      aria-label={`${t('common.theme')}: ${t(`theme.${theme}`)}`}
      title={`${t('common.theme')}: ${t(`theme.${theme}`)}`}
      onClick={() => setTheme(next)}
      className={cn('grid size-11 place-items-center rounded-xl bg-surface-2 text-fg transition hover:bg-gold-soft dark:hover:bg-charcoal', className)}
    >
      <Icon className="size-5" />
    </button>
  )
}

/** Online/offline + queued items waiting for the server. Connected: tap to sync now. */
export function SyncChip({ compact }: { compact?: boolean }) {
  const online = useOnline()
  const { data: pending = 0 } = usePending()
  const { data: settings } = useSettings()
  const t = useT()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const local = settings?.sync.mode !== 'server'
  const warn = !online
  const last = settings?.sync.lastPullAt ? new Date(settings.sync.lastPullAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null
  const run = async () => {
    if (local || busy) return
    setBusy(true)
    try { await syncNow(); await qc.invalidateQueries() } finally { setBusy(false) }
  }
  return (
    <button
      type="button"
      onClick={run}
      disabled={local}
      title={local ? t('sync.local_hint') : `${t('sync.now')} · ${last ? t('sync.last', { time: last }) : t('sync.never')}`}
      aria-label={local ? t('sync.local') : t('sync.now')}
      className={cn('inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-full px-3 text-xs font-medium disabled:cursor-default', warn ? 'bg-warn-bg text-warn-fg' : 'bg-surface-2 text-fg', !local && 'hover:bg-gold-soft dark:hover:bg-charcoal')}
    >
      <span className={cn('size-2 rounded-full', warn ? 'bg-warning' : 'bg-success')} />
      {warn ? <CloudOff className="size-4" /> : <Cloud className={cn('size-4', busy && 'animate-pulse')} />}
      {!compact && (
        <span>
          {busy ? t('sync.syncing') : warn ? t('sync.offline') : local ? t('sync.local') : t('sync.server')}
          {pending > 0 && <span className="num ms-1 opacity-80">· {t('sync.queued', { n: pending })}</span>}
        </span>
      )}
      {compact && pending > 0 && <span className="num">{pending}</span>}
    </button>
  )
}

export function ShiftChip({ compact }: { compact?: boolean }) {
  const { data: shift } = useMyShift()
  const { data: s } = useSettings()
  const t = useT()
  const navigate = useNavigate()
  // selling doesn't need a shift here: no "No shift" warning (the Shift page can still open one to count the drawer)
  if (!shift && s && !s.sales.requireShift) return null
  return (
    <button
      type="button"
      onClick={() => navigate('/shift')}
      className={cn('inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-full px-3 text-xs font-medium transition', shift ? 'bg-surface-2 text-fg' : 'bg-warn-bg text-warn-fg')}
    >
      <Clock className="size-4" />
      {!compact && (shift ? <span>{t('shift.open_since', { time: fmtTime(shift.openedAt) })}</span> : <span>{t('shift.none')}</span>)}
    </button>
  )
}

export function RateChip() {
  const { data: s } = useSettings()
  const t = useT()
  if (!s?.currency.usdEnabled) return null
  return (
    <span className="hidden h-9 items-center gap-1.5 whitespace-nowrap rounded-full bg-surface-2 px-3 text-xs font-medium xl:inline-flex" title={t('settings.rate')}>
      <span className="text-fg-2">{t('common.rate')}</span>
      <span className="num">1 USD = {fmt(s.currency.rate)}</span>
    </span>
  )
}

export function UserMenu() {
  const actor = useSession((s) => s.actor)
  const lock = useSession((s) => s.lock)
  const signOut = useSession((s) => s.signOut)
  const t = useT()
  const lang = useUI((s) => s.lang)
  const setLang = useUI((s) => s.setLang)
  const theme = useUI((s) => s.theme)
  const setTheme = useUI((s) => s.setTheme)
  const navigate = useNavigate()
  const langs = useMemo(() => LANGS, [])
  const apps = useAppAddresses()
  if (!actor) return null
  const open = (href: string) => window.open(href, '_blank', 'noopener')
  // the admin panel is for people who see the shop's figures (its own sign-in decides the rest)
  const manager = actor.isSuperAdmin || hasPerm(actor.permissions, 'reports.view')
  return (
    <Menu
      title={actor.name}
      trigger={({ toggle }) => (
        <button type="button" onClick={toggle} aria-label={actor.name} className="flex h-11 items-center gap-2.5 rounded-xl px-1 transition hover:bg-surface-2 lg:pe-3">
          <Avatar name={actor.name} color={actor.color} size={38} />
          <span className="hidden text-start leading-tight lg:block">
            <span className="block max-w-32 truncate text-sm font-semibold">{actor.name}</span>
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
              {langs.map((l) => (
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
          {manager && <MenuItem icon={<LayoutDashboard className="size-5" />} onClick={() => { close(); open(apps.admin) }}>{t('ap.open_admin')}</MenuItem>}
          <MenuItem icon={<BookOpen className="size-5" />} onClick={() => { close(); open(apps.menu) }}>{t('ap.open_menu')}</MenuItem>
          <MenuItem icon={<KeyRound className="size-5" />} onClick={() => { close(); navigate('/account') }}>{t('account.title')}</MenuItem>
          <MenuItem icon={<Lock className="size-5" />} onClick={() => { close(); lock() }}>{t('auth.lock')}</MenuItem>
          <MenuItem icon={<LogOut className="size-5" />} danger onClick={() => { close(); void audit('auth.logout', 'user', actor.id); signOut() }}>{t('auth.sign_out')}</MenuItem>
        </>
      )}
    </Menu>
  )
}

export function Credit({ className }: { className?: string }) {
  return (
    <p dir="ltr" className={cn('text-center text-[11px] leading-relaxed text-fg-2', className)}>
      Developed by <b className="font-semibold text-gold-text">Coda Agency</b> — Build What's Next — <span className="num">+964 750 730 8005</span> — <b className="font-semibold text-gold-text">@codatechagency</b>
    </p>
  )
}
