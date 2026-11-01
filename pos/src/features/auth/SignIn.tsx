import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, KeyRound, Lock, RotateCw, UserRound } from 'lucide-react'
import { BrandMark } from '@/components/ui/Brand'
import { Avatar, Badge, Spinner } from '@/components/ui/Controls'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { PinPad } from '@/components/ui/Pad'
import { cn } from '@/components/ui/cn'
import { Credit, LangSwitch, ThemeToggle, useOtherSections } from '@/components/layout/Chrome'
import { errorMessage, useT } from '@/i18n'
import { listLoginUsers, loginWithPassword, loginWithPin } from '@/services/auth'
import { isAppError } from '@/services/context'
import { isServer } from '@/services/mode'
import { useSession } from '@/store/session'

type Mode = { kind: 'tiles' } | { kind: 'pin'; userId: string } | { kind: 'password' }

/**
 * Sign-in screen: cashier tiles → PIN pad (fast, one-handed, touch friendly), with
 * username + password as the alternative for admins. Also used as the lock screen
 * (`lockedUserId`): after inactivity the same person types their PIN to continue.
 */
export function SignIn({ lockedUserId }: { lockedUserId?: string }) {
  const t = useT()
  const signIn = useSession((s) => s.signIn)
  const signOut = useSession((s) => s.signOut)
  const unlock = useSession((s) => s.unlock)
  const lastUserId = useSession((s) => s.lastUserId)
  const others = useOtherSections()
  // read afresh every time this screen shows: the list from before the till was connected would wrongly say "not connected"
  const { data: users, error: usersError, isLoading: firstLoad, isFetching, refetch } = useQuery({ queryKey: ['login-users'], queryFn: listLoginUsers, staleTime: 0, retry: false })
  const isLoading = firstLoad || (isFetching && !users?.length)
  const [mode, setMode] = useState<Mode>(lockedUserId ? { kind: 'pin', userId: lockedUserId } : { kind: 'tiles' })
  const [pin, setPin] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [cool, setCool] = useState(0)

  // count down a lockout so the person sees when they can try again
  useEffect(() => {
    if (cool <= 0) return
    const id = setInterval(() => setCool((c) => Math.max(0, c - 1)), 1000)
    return () => clearInterval(id)
  }, [cool])

  const fail = (e: unknown) => {
    setError(errorMessage(e, t))
    if (isAppError(e) && e.code === 'account_locked') setCool(Number(e.params.seconds) || 60)
    setPin('')
  }

  const submitPin = async (value: string, userId: string) => {
    if (busy) return
    setBusy(true); setError('')
    try {
      const actor = await loginWithPin(userId, value)
      if (lockedUserId && actor.id === lockedUserId) unlock()
      else signIn(actor)
    } catch (e) { fail(e) } finally { setBusy(false) }
  }

  const submitPassword = async () => {
    setBusy(true); setError('')
    try { signIn(await loginWithPassword(username, password)) } catch (e) { fail(e) } finally { setBusy(false) }
  }

  const selected = mode.kind === 'pin' ? users?.find((u) => u.id === mode.userId) : undefined

  return (
    <div className="relative flex min-h-dvh flex-col bg-bg pt-safe">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(60%_100%_at_50%_0%,rgba(212,165,72,.18),transparent)]" />
      <div className="relative flex items-center justify-end gap-2 p-3">
        <LangSwitch />
        <ThemeToggle />
      </div>

      <main className="relative mx-auto flex w-full max-w-3xl flex-1 flex-col items-center px-4 pb-6">
        <BrandMark size="lg" className="mb-1 mt-2 flex-col gap-1 sm:mt-6" />
        <p className="mb-6 text-sm text-fg-2">{lockedUserId ? t('auth.locked') : t('auth.welcome')}</p>

        {isLoading ? <Spinner className="mt-10" /> : mode.kind === 'tiles' ? (
          <>
            {users && users.length > 0 ? (
              <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {users.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => { setMode({ kind: 'pin', userId: u.id }); setPin(''); setError('') }}
                    className={cn('flex min-h-36 flex-col items-center justify-center gap-2.5 rounded-3xl border bg-surface p-4 text-center shadow-soft transition active:scale-[.97] hover:border-gold', u.id === lastUserId ? 'border-gold' : 'border-line')}
                  >
                    <Avatar name={u.name} color={u.color} size={64} />
                    <span className="max-w-full truncate text-base font-semibold">{u.name}</span>
                    <Badge tone="neutral">{u.roleName}</Badge>
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex max-w-md flex-col items-center gap-3 text-center">
                <p className="text-fg-2">{usersError ? errorMessage(usersError, t) : isServer() ? t('auth.connect_device') : t('auth.no_users')}</p>
                {isServer() && <Button variant="secondary" icon={<RotateCw className="size-4" />} loading={isFetching} onClick={() => void refetch()}>{t('ap.retry')}</Button>}
              </div>
            )}
            <Button variant="ghost" className="mt-6" icon={<KeyRound className="size-5" />} onClick={() => { setMode({ kind: 'password' }); setError('') }}>{t('auth.use_password')}</Button>
          </>
        ) : mode.kind === 'pin' ? (
          <div className="w-full max-w-sm rounded-3xl border border-line bg-surface p-5 shadow-soft">
            <div className="mb-4 flex flex-col items-center gap-2 text-center">
              {selected ? <Avatar name={selected.name} color={selected.color} size={64} /> : <span className="grid size-16 place-items-center rounded-full bg-surface-2"><UserRound className="size-8 text-fg-2" /></span>}
              <div className="text-lg font-semibold">{selected?.name ?? t('auth.enter_pin')}</div>
              <div className="flex items-center gap-1.5 text-sm text-fg-2"><Lock className="size-4" />{t('auth.enter_pin')}</div>
            </div>
            {error && <p role="alert" className="mb-3 text-center text-sm font-medium text-danger">{error}{cool > 0 && <span className="num"> ({cool}s)</span>}</p>}
            <PinPad value={pin} onChange={(v) => { setPin(v); setError('') }} onSubmit={(v) => submitPin(v, mode.userId)} error={!!error} disabled={busy || cool > 0} keyboard />
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {lockedUserId ? (
                <Button variant="ghost" onClick={() => signOut()}>{t('auth.switch_user')}</Button>
              ) : (
                <Button variant="ghost" icon={<ArrowLeft className="size-4 rtl:rotate-180" />} onClick={() => { setMode({ kind: 'tiles' }); setError('') }}>{t('auth.switch_user')}</Button>
              )}
            </div>
          </div>
        ) : (
          <form className="w-full max-w-sm space-y-4 rounded-3xl border border-line bg-surface p-5 shadow-soft" onSubmit={(e) => { e.preventDefault(); void submitPassword() }}>
            <h2 className="text-center font-serif text-xl font-semibold">{t('auth.password_login')}</h2>
            <Field label={t('common.username')}>{(id) => <Input id={id} autoComplete="username" autoCapitalize="none" autoCorrect="off" value={username} onChange={(e) => setUsername(e.target.value)} big data-autofocus />}</Field>
            <Field label={t('common.password')}>{(id) => <Input id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} big />}</Field>
            {error && <p role="alert" className="text-center text-sm font-medium text-danger">{error}{cool > 0 && <span className="num"> ({cool}s)</span>}</p>}
            <Button type="submit" variant="primary" size="xl" block loading={busy} disabled={!username || !password || cool > 0}>{t('auth.sign_in')}</Button>
            <Button variant="ghost" block onClick={() => { setMode({ kind: 'tiles' }); setError('') }}>{t('auth.back_to_pin')}</Button>
          </form>
        )}
      </main>
      {/* the shop's address opens the POS; from here the other sections are one tap away */}
      {!lockedUserId && (
        <nav aria-label={t('nav.sections')} className="relative mx-auto flex flex-wrap items-center justify-center gap-2 px-4 pt-2">
          {others.map((o) => (
            <a key={o.key} href={o.href} className="inline-flex h-11 items-center gap-2 rounded-full bg-surface-2 px-4 text-sm font-medium text-fg-2 transition hover:bg-gold-soft hover:text-fg dark:hover:bg-charcoal">
              <o.icon className="size-4" />{t(o.label)}
            </a>
          ))}
        </nav>
      )}
      <Credit className="pb-[max(1rem,env(safe-area-inset-bottom))] pt-2" />
    </div>
  )
}
