import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Check, ShieldCheck, Store, Database } from 'lucide-react'
import { BrandMark } from '@/components/ui/Brand'
import { Button } from '@/components/ui/Button'
import { Switch } from '@/components/ui/Controls'
import { Field, Input } from '@/components/ui/Field'
import { cn } from '@/components/ui/cn'
import { Credit, LangSwitch, ThemeToggle } from '@/components/layout/Chrome'
import { errorMessage, useT } from '@/i18n'
import { passwordProblem, PIN_RE } from '@/lib/credentials'
import { parseAmount } from '@/lib/money'
import { completeSetup, loginWithPassword } from '@/services/auth'
import { useSession } from '@/store/session'

/**
 * First-run wizard. There is deliberately no built-in "admin/admin" account: the
 * shop owner creates the Super Admin here, then that account creates everyone else
 * from Users & Roles.
 */
export function SetupPage() {
  const t = useT()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const signIn = useSession((s) => s.signIn)
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [f, setF] = useState({
    storeName: 'Lattafa Perfumes', phone: '', address: 'Duhok, Kurdistan Region, Iraq', city: 'Duhok', rate: '1460',
    adminName: '', username: '', password: '', password2: '', pin: '', pin2: '',
    deviceName: 'Counter 1', demo: true,
  })
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }))

  const errs: Record<number, Record<string, string>> = {
    0: {
      ...(f.storeName.trim() ? {} : { storeName: t('err.required_fields') }),
      ...(parseAmount(f.rate) > 0 ? {} : { rate: t('err.invalid_rate') }),
    },
    1: {
      ...(f.adminName.trim() ? {} : { adminName: t('err.required_fields') }),
      ...(/^[a-z0-9._-]{3,32}$/i.test(f.username.trim()) ? {} : { username: t('err.username_invalid') }),
      ...(passwordProblem(f.password) ? { password: t(`err.password_${passwordProblem(f.password)}`) } : {}),
      ...(f.password !== f.password2 ? { password2: t('setup.mismatch') } : {}),
      ...(PIN_RE.test(f.pin) ? {} : { pin: t('err.pin_invalid') }),
      ...(f.pin !== f.pin2 ? { pin2: t('setup.mismatch') } : {}),
    },
    2: {},
  }
  const stepErrors = errs[step]
  const [showErr, setShowErr] = useState(false)

  const next = () => {
    if (Object.keys(stepErrors).length) { setShowErr(true); return }
    setShowErr(false); setStep((s) => s + 1)
  }

  const finish = async () => {
    setBusy(true); setError('')
    try {
      await completeSetup({
        store: { name: f.storeName, phone: f.phone, address: f.address, city: f.city },
        rate: parseAmount(f.rate),
        admin: { name: f.adminName, username: f.username, password: f.password, pin: f.pin },
        demoData: f.demo,
        deviceName: f.deviceName,
      })
      signIn(await loginWithPassword(f.username, f.password))
      await qc.invalidateQueries()
      navigate('/', { replace: true })
    } catch (e) {
      setError(errorMessage(e, t))
    } finally {
      setBusy(false)
    }
  }

  const steps = [
    { icon: Store, label: t('setup.step_store') },
    { icon: ShieldCheck, label: t('setup.step_admin') },
    { icon: Database, label: t('setup.step_data') },
  ]
  const e = (k: string) => (showErr ? stepErrors[k] : undefined)

  return (
    <div className="relative flex min-h-dvh flex-col bg-bg pt-safe">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(60%_100%_at_50%_0%,rgba(212,165,72,.18),transparent)]" />
      <div className="relative flex items-center justify-end gap-2 p-3"><LangSwitch /><ThemeToggle /></div>
      <main className="relative mx-auto w-full max-w-xl flex-1 px-4 pb-8">
        <div className="mb-6 flex flex-col items-center gap-1 text-center">
          <BrandMark size="lg" className="flex-col gap-1" />
          <h1 className="mt-2 font-serif text-2xl font-semibold">{t('setup.title')}</h1>
          <p className="text-sm text-fg-2">{t('setup.subtitle')}</p>
        </div>

        <ol className="mb-5 flex items-center justify-center gap-2">
          {steps.map((s, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className={cn('flex h-10 items-center gap-2 rounded-full px-3.5 text-sm font-medium', i === step ? 'bg-gold text-ink' : i < step ? 'bg-ok-bg text-ok-fg' : 'bg-surface-2 text-fg-2')}>
                {i < step ? <Check className="size-4" /> : <s.icon className="size-4" />}
                <span className="hidden sm:inline">{s.label}</span>
                <span className="sm:hidden">{i + 1}</span>
              </span>
              {i < steps.length - 1 && <span className="h-px w-5 bg-line" />}
            </li>
          ))}
        </ol>

        <div className="space-y-4 rounded-3xl border border-line bg-surface p-5 shadow-soft sm:p-6">
          {step === 0 && (
            <>
              <h2 className="font-serif text-xl font-semibold">{t('setup.step_store')}</h2>
              <Field label={t('setup.store_name')} error={e('storeName')}>{(id) => <Input id={id} value={f.storeName} onChange={(x) => set('storeName', x.target.value)} invalid={!!e('storeName')} />}</Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('common.phone')}>{(id) => <Input id={id} type="tel" inputMode="tel" value={f.phone} onChange={(x) => set('phone', x.target.value)} />}</Field>
                <Field label={t('common.city')}>{(id) => <Input id={id} value={f.city} onChange={(x) => set('city', x.target.value)} />}</Field>
              </div>
              <Field label={t('common.address')}>{(id) => <Input id={id} value={f.address} onChange={(x) => set('address', x.target.value)} />}</Field>
              <Field label={t('setup.rate')} hint={t('setup.rate_hint')} error={e('rate')}>{(id) => <Input id={id} inputMode="numeric" value={f.rate} onChange={(x) => set('rate', x.target.value)} invalid={!!e('rate')} className="num" />}</Field>
            </>
          )}
          {step === 1 && (
            <>
              <h2 className="font-serif text-xl font-semibold">{t('setup.step_admin')}</h2>
              <p className="text-sm text-fg-2">{t('setup.admin_hint')}</p>
              <Field label={t('setup.admin_name')} error={e('adminName')}>{(id) => <Input id={id} autoComplete="name" value={f.adminName} onChange={(x) => set('adminName', x.target.value)} invalid={!!e('adminName')} />}</Field>
              <Field label={t('common.username')} hint={t('setup.username_hint')} error={e('username')}>{(id) => <Input id={id} autoComplete="username" autoCapitalize="none" value={f.username} onChange={(x) => set('username', x.target.value)} invalid={!!e('username')} />}</Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('common.password')} hint={t('setup.password_hint')} error={e('password')}>{(id) => <Input id={id} type="password" autoComplete="new-password" value={f.password} onChange={(x) => set('password', x.target.value)} invalid={!!e('password')} />}</Field>
                <Field label={t('setup.password_repeat')} error={e('password2')}>{(id) => <Input id={id} type="password" autoComplete="new-password" value={f.password2} onChange={(x) => set('password2', x.target.value)} invalid={!!e('password2')} />}</Field>
                <Field label={t('common.pin')} hint={t('setup.pin_hint')} error={e('pin')}>{(id) => <Input id={id} type="password" inputMode="numeric" maxLength={6} autoComplete="off" value={f.pin} onChange={(x) => set('pin', x.target.value.replace(/\D/g, ''))} invalid={!!e('pin')} className="num tracking-[.3em]" />}</Field>
                <Field label={t('setup.pin_repeat')} error={e('pin2')}>{(id) => <Input id={id} type="password" inputMode="numeric" maxLength={6} autoComplete="off" value={f.pin2} onChange={(x) => set('pin2', x.target.value.replace(/\D/g, ''))} invalid={!!e('pin2')} className="num tracking-[.3em]" />}</Field>
              </div>
            </>
          )}
          {step === 2 && (
            <>
              <h2 className="font-serif text-xl font-semibold">{t('setup.step_data')}</h2>
              <Field label={t('setup.device_name')} hint={t('setup.device_hint')}>{(id) => <Input id={id} value={f.deviceName} onChange={(x) => set('deviceName', x.target.value)} />}</Field>
              <div className="flex items-start justify-between gap-4 rounded-2xl bg-surface-2 p-4">
                <div className="min-w-0">
                  <div className="font-semibold">{t('setup.demo')}</div>
                  <p className="mt-1 text-sm text-fg-2">{t('setup.demo_hint')}</p>
                </div>
                <Switch checked={f.demo} onChange={(v) => set('demo', v)} label={t('setup.demo')} />
              </div>
              {error && <p role="alert" className="rounded-xl bg-danger-bg px-3 py-2 text-sm font-medium text-danger-fg">{error}</p>}
            </>
          )}

          <div className="flex items-center justify-between gap-3 pt-2">
            {step > 0 ? <Button variant="ghost" size="lg" icon={<ArrowLeft className="size-5 rtl:rotate-180" />} onClick={() => { setStep(step - 1); setShowErr(false) }}>{t('common.back')}</Button> : <span />}
            {step < 2 ? (
              <Button variant="primary" size="lg" iconEnd={<ArrowRight className="size-5 rtl:rotate-180" />} onClick={next}>{t('common.next')}</Button>
            ) : (
              <Button variant="primary" size="lg" loading={busy} icon={<Check className="size-5" />} onClick={finish}>{t('setup.finish')}</Button>
            )}
          </div>
        </div>
      </main>
      <Credit className="pb-[max(1rem,env(safe-area-inset-bottom))]" />
    </div>
  )
}
