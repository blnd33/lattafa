import { useState } from 'react'
import { Download, Lock, LogOut, ShieldCheck, Smartphone } from 'lucide-react'
import { Avatar, Badge, Card, PageHeader } from '@/components/ui/Controls'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { LangSwitch, ThemeToggle } from '@/components/layout/Chrome'
import { useT } from '@/i18n'
import { passwordProblem, PIN_RE } from '@/lib/credentials'
import { ALL_PERMISSIONS, PERMISSION_GROUPS, hasPerm } from '@/lib/permissions'
import { APP } from '@/data/app'
import { audit } from '@/services/audit'
import { logout } from '@/services/remote'
import { changeOwnCredentials } from '@/services/users'
import { useAction } from '@/hooks/queries'
import { useActor } from '@/hooks/useAuth'
import { useInstall } from '@/hooks/useInstall'
import { useSession } from '@/store/session'

/** Everyone's own page: change PIN/password, language & theme, install the app, see what you may do. */
export function AccountPage() {
  const t = useT()
  const actor = useActor()
  const lock = useSession((s) => s.lock)
  const signOut = useSession((s) => s.signOut)
  const inst = useInstall()
  const [cur, setCur] = useState('')
  const [pin, setPin] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const run = useAction(changeOwnCredentials, { success: 'account.changed' })
  if (!actor) return null

  const submit = async () => {
    setErr('')
    if (pin && !PIN_RE.test(pin)) return setErr(t('err.pin_invalid'))
    if (pw) { const p = passwordProblem(pw); if (p) return setErr(t(`err.password_${p}`)) }
    if (await run({ currentPin: cur, newPin: pin || undefined, newPassword: pw || undefined })) { setCur(''); setPin(''); setPw('') }
  }
  const allowed = actor.permissions.includes('*') ? ALL_PERMISSIONS : actor.permissions
  // the admin panel (any computer, no PIN lock screen) also ends the session on the server
  const admin = APP === 'admin'
  const leave = async () => {
    void audit('auth.logout', 'user', actor.id)
    if (admin) await logout()
    signOut()
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 md:p-6">
      <PageHeader title={t('account.title')} />
      <Card className="flex flex-wrap items-center gap-4">
        <Avatar name={actor.name} color={actor.color} size={72} />
        <div className="min-w-0 flex-1">
          <div className="font-serif text-2xl font-semibold">{actor.name}</div>
          <div className="text-sm text-fg-2">@{actor.username}</div>
          <Badge tone={actor.isSuperAdmin ? 'gold' : 'neutral'} className="mt-1.5">{actor.isSuperAdmin && <ShieldCheck className="size-3" />}{actor.roleName}</Badge>
        </div>
        <div className="flex gap-2">
          {!admin && <Button variant="secondary" size="lg" icon={<Lock className="size-5" />} onClick={lock}>{t('auth.lock')}</Button>}
          <Button variant="secondary" size="lg" className="text-danger" icon={<LogOut className="size-5" />} onClick={leave}>{t('auth.sign_out')}</Button>
        </div>
      </Card>

      <div className="grid gap-5 md:grid-cols-2">
        <Card className="space-y-4">
          <h2 className="font-semibold">{t('account.change')}</h2>
          <Field label={t('account.current_pin')}>{(i) => <Input id={i} type="password" inputMode="numeric" maxLength={6} className="num tracking-[.25em]" value={cur} onChange={(e) => setCur(e.target.value.replace(/\D/g, ''))} />}</Field>
          <Field label={t('users.new_pin')} hint={t('users.keep_hint')}>{(i) => <Input id={i} type="password" inputMode="numeric" maxLength={6} className="num tracking-[.25em]" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />}</Field>
          <Field label={t('users.new_password')} hint={t('users.keep_hint')}>{(i) => <Input id={i} type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />}</Field>
          {err && <p role="alert" className="text-sm font-medium text-danger">{err}</p>}
          <Button variant="primary" size="lg" block loading={run.busy} disabled={!cur || (!pin && !pw)} onClick={submit}>{t('common.save')}</Button>
        </Card>

        <div className="space-y-5">
          <Card className="space-y-3">
            <h2 className="font-semibold">{t('account.preferences')}</h2>
            <div className="flex flex-wrap items-center gap-3"><LangSwitch /><ThemeToggle /></div>
          </Card>
          <Card className="space-y-3">
            <h2 className="flex items-center gap-2 font-semibold"><Smartphone className="size-5 text-gold-text" />{t('account.install')}</h2>
            {inst.installed ? <p className="text-sm text-ok-fg">{t('account.installed')}</p> : inst.canPrompt ? (
              <><p className="text-sm text-fg-2">{t(admin ? 'account.install_hint_admin' : 'account.install_hint')}</p><Button variant="primary" icon={<Download className="size-5" />} onClick={inst.install}>{t('account.install_go')}</Button></>
            ) : inst.ios ? <p className="text-sm text-fg-2">{t('account.install_ios')}</p> : <p className="text-sm text-fg-2">{t('account.install_browser')}</p>}
          </Card>
        </div>
      </div>

      <Card className="space-y-3">
        <h2 className="font-semibold">{t('account.my_permissions')}</h2>
        <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
          {PERMISSION_GROUPS.map((g) => {
            const ok = g.perms.filter((p) => hasPerm(allowed, p))
            if (!ok.length) return null
            return (
              <div key={g.key}>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-2 rtl:tracking-normal">{t(`permgroup.${g.key}`)}</div>
                <ul className="space-y-0.5 text-sm">{ok.map((p) => <li key={p} className="flex items-start gap-2"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-success" />{t(`perm.${p}`)}</li>)}</ul>
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}
