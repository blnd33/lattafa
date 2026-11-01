import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Lock, ShieldCheck, Smartphone, WifiOff } from 'lucide-react'
import { BrandMark } from '@/components/ui/Brand'
import { Button } from '@/components/ui/Button'
import { Avatar, Badge, Spinner } from '@/components/ui/Controls'
import { Field, Input } from '@/components/ui/Field'
import { PinPad } from '@/components/ui/Pad'
import { cn } from '@/components/ui/cn'
import { LangSwitch } from '../ui'
import { errorMessage, useT } from '@/i18n'
import { isAppError } from '@/services/context'
import { bindPhone, loginTiles, pinLogin, useSession } from '../auth'
import { patchMeta } from '../data'
import { useMeta } from '../hooks'

function Frame({ children }: { children: React.ReactNode }) {
  const t = useT()
  return (
    <div className="relative flex min-h-dvh flex-col bg-bg pt-safe">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(60%_100%_at_50%_0%,rgba(212,165,72,.18),transparent)]" />
      <div className="relative flex justify-end p-3"><LangSwitch /></div>
      <main className="relative mx-auto flex w-full max-w-md flex-1 flex-col items-center px-4 pb-8">
        <BrandMark size="lg" className="mb-1 mt-2 flex-col gap-1" />
        <p className="mb-6 text-sm text-fg-2">{t('dl.app')}</p>
        {children}
      </main>
    </div>
  )
}

/** First run on a phone: the Super Admin connects it to the shop (once). */
export function BindScreen() {
  const t = useT()
  const qc = useQueryClient()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async () => {
    setBusy(true); setError('')
    try { await bindPhone(username, password, name.trim()); await qc.invalidateQueries() } catch (e) { setError(errorMessage(e, t)) } finally { setBusy(false) }
  }
  return (
    <Frame>
      <form className="w-full space-y-4 rounded-3xl border border-line bg-surface p-5 shadow-soft" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-gold-soft text-gold-text dark:bg-gold/15"><Smartphone className="size-6" /></span>
          <div><h2 className="font-serif text-xl font-semibold">{t('dl.bind_title')}</h2><p className="mt-1 text-sm text-fg-2">{t('dl.bind_hint')}</p></div>
        </div>
        <Field label={t('dl.phone_name')} hint={t('dl.phone_name_hint')}>{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('dl.phone_name_ph')} />}</Field>
        <Field label={t('common.username')}>{(id) => <Input id={id} autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} big />}</Field>
        <Field label={t('common.password')}>{(id) => <Input id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} big />}</Field>
        {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
        <Button type="submit" variant="primary" size="xl" block loading={busy} disabled={!username || !password} icon={<ShieldCheck className="size-5" />}>{t('dl.bind')}</Button>
      </form>
    </Frame>
  )
}

/** Every day: tap your name, type your PIN. */
export function SignInScreen() {
  const t = useT()
  const qc = useQueryClient()
  const signIn = useSession((s) => s.signIn)
  const lastUserId = useSession((s) => s.lastUserId)
  const { data: meta } = useMeta()
  const tiles = useQuery({ queryKey: ['tiles'], queryFn: loginTiles })
  const [userId, setUserId] = useState<string | null>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const unbound = isAppError(tiles.error) && (tiles.error.code === 'device_not_registered' || tiles.error.code === 'device_revoked')

  const submit = async (value: string) => {
    if (!userId || busy) return
    setBusy(true); setError('')
    try { signIn(await pinLogin(userId, value)); await qc.invalidateQueries() } catch (e) { setError(errorMessage(e, t)); setPin('') } finally { setBusy(false) }
  }
  const rebind = async () => { await patchMeta({ deviceCode: '' }); await qc.invalidateQueries() }
  const user = tiles.data?.find((u) => u.id === userId)

  return (
    <Frame>
      {tiles.isLoading ? <Spinner className="mt-10" /> : unbound ? (
        <div className="w-full space-y-4 rounded-3xl border border-line bg-surface p-5 text-center">
          <p className="text-sm text-fg-2">{errorMessage(tiles.error, t)}</p>
          <Button variant="primary" block onClick={rebind}>{t('dl.bind_again')}</Button>
        </div>
      ) : !userId ? (
        <>
          <div className="grid w-full grid-cols-2 gap-3">
            {(tiles.data ?? []).map((u) => (
              <button key={u.id} type="button" onClick={() => { setUserId(u.id); setPin(''); setError('') }}
                className={cn('flex min-h-36 flex-col items-center justify-center gap-2 rounded-3xl border bg-surface p-4 shadow-soft transition active:scale-[.97]', u.id === lastUserId ? 'border-gold' : 'border-line')}>
                <Avatar name={u.name} color={u.color} size={60} />
                <span className="max-w-full truncate font-semibold">{u.name}</span>
                {u.locked && <Badge tone="warn">{t('dl.locked')}</Badge>}
              </button>
            ))}
          </div>
          {tiles.data?.length === 0 && <p className="text-center text-sm text-fg-2">{t('dl.no_delegates')}</p>}
          {tiles.isError && !unbound && <p className="mt-4 flex items-center gap-2 text-sm text-warn-fg"><WifiOff className="size-4" />{errorMessage(tiles.error, t)}</p>}
        </>
      ) : (
        <div className="w-full rounded-3xl border border-line bg-surface p-5 shadow-soft">
          <div className="mb-4 flex flex-col items-center gap-2 text-center">
            {user && <Avatar name={user.name} color={user.color} size={60} />}
            <div className="text-lg font-semibold">{user?.name}</div>
            <div className="flex items-center gap-1.5 text-sm text-fg-2"><Lock className="size-4" />{t('auth.enter_pin')}</div>
          </div>
          {error && <p role="alert" className="mb-3 text-center text-sm font-medium text-danger">{error}</p>}
          <PinPad value={pin} onChange={(v) => { setPin(v); setError('') }} onSubmit={submit} error={!!error} disabled={busy} keyboard />
          <Button variant="ghost" className="mt-4 w-full" icon={<ArrowLeft className="size-4 rtl:rotate-180" />} onClick={() => setUserId(null)}>{t('auth.switch_user')}</Button>
        </div>
      )}
      {meta?.deviceCode && <p className="mt-6 flex items-center gap-1.5 text-xs text-fg-2"><ShieldCheck className="size-4 text-success" />{t('dl.bound', { code: meta.deviceCode })} · {t('dl.works_offline')}</p>}
    </Frame>
  )
}
