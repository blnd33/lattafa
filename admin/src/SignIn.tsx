import { useState, type FormEvent } from 'react'
import { LogIn } from 'lucide-react'
import { Logo } from '@/components/ui/Brand'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { Credit, LangSwitch, ThemeToggle } from '@/components/layout/Chrome'
import { errorMessage, useT } from '@/i18n'
import { loginWithPassword } from '@/services/auth'
import { useSession } from '@/store/session'

/** Owners and managers sign in with username + password; the computer is not registered as a till. */
export function SignIn() {
  const t = useT()
  const signIn = useSession((s) => s.signIn)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password) return
    setBusy(true)
    setError('')
    try {
      signIn(await loginWithPassword(username, password, 'admin'))
    } catch (err) {
      setError(errorMessage(err, t))
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh bg-bg text-fg">
      {/* the brand side: only where there is room for it */}
      <aside className="relative hidden w-[42%] max-w-xl flex-col justify-between overflow-hidden bg-ink p-10 text-[#f6f0e4] lg:flex">
        <div aria-hidden className="pointer-events-none absolute -end-24 -top-24 size-96 rounded-full bg-gold/10 blur-3xl" />
        <div className="flex items-center gap-3">
          <Logo className="h-12" />
          <span className="font-serif text-2xl font-semibold tracking-wide text-gold-light">Lattafa</span>
        </div>
        <div className="relative">
          <img src="/logo.png" alt="" aria-hidden className="mb-8 h-40 w-auto opacity-90" draggable={false} />
          <h1 className="font-serif text-4xl font-semibold leading-tight text-gold-light">{t('ap.title')}</h1>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-[#b9ae9c]">{t('ap.sign_in_sub')}</p>
        </div>
        <p dir="ltr" className="text-[11px] text-[#8a8178]">Duhok · Lattafa Perfumes</p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex justify-end gap-2 p-4 pt-safe">
          <LangSwitch />
          <ThemeToggle />
        </div>
        <main className="grid flex-1 place-items-center px-5 pb-8">
          <form onSubmit={submit} className="w-full max-w-sm space-y-5" noValidate>
            <div className="mb-2 flex flex-col items-center gap-3 text-center lg:items-start lg:text-start">
              <Logo className="h-16 lg:hidden" />
              <h2 className="font-serif text-3xl font-semibold">{t('auth.sign_in')}</h2>
              <p className="text-sm text-fg-2 lg:hidden">{t('ap.sign_in_sub')}</p>
            </div>
            <Field label={t('common.username')}>
              {(id) => <Input id={id} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} big autoFocus />}
            </Field>
            <Field label={t('common.password')}>
              {(id) => <Input id={id} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" big />}
            </Field>
            {error && <p role="alert" className="rounded-xl bg-danger-bg px-3 py-2.5 text-sm text-danger-fg">{error}</p>}
            <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={!username.trim() || !password} icon={<LogIn className="size-5 rtl:rotate-180" />}>
              {t('auth.sign_in')}
            </Button>
          </form>
        </main>
        <Credit className="px-4 pb-4 pb-safe" />
      </div>
    </div>
  )
}
