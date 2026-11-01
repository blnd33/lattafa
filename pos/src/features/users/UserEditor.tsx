import { useEffect, useState } from 'react'
import { Dices, Eye, EyeOff, Lock, Trash2, Unlock } from 'lucide-react'
import { Avatar, Badge, Segmented, Switch } from '@/components/ui/Controls'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { Modal, useConfirm } from '@/components/ui/Modal'
import { cn } from '@/components/ui/cn'
import { useT } from '@/i18n'
import type { Role } from '@/data/types'
import { fmtDateTime } from '@/lib/date'
import { AVATAR_COLORS, DEFAULT_LIMITS, effectivePermissions } from '@/lib/permissions'
import { parseAmount } from '@/lib/money'
import { deleteUser, saveUser, unlockUser, type PublicUser } from '@/services/users'
import { useAction } from '@/hooks/queries'
import { useActor, useCan } from '@/hooks/useAuth'
import { UserOverrideMatrix } from './PermissionMatrix'

interface Form {
  name: string
  username: string
  roleId: string
  active: boolean
  color: string
  pin: string
  password: string
  grants: string[]
  denies: string[]
  maxDiscountPct: string
  maxRefundIQD: string
}

const blank = (roleId: string): Form => ({ name: '', username: '', roleId, active: true, color: AVATAR_COLORS[1], pin: '', password: '', grants: [], denies: [], maxDiscountPct: String(DEFAULT_LIMITS.maxDiscountPct), maxRefundIQD: String(DEFAULT_LIMITS.maxRefundIQD) })

/**
 * Create / edit an account — the Super Admin's main tool:
 *   who they are → which role → sign-in credentials → limits → per-person permission overrides.
 */
export function UserEditor({ value, roles, onClose }: { value: PublicUser | 'new' | null; roles: Role[]; onClose: () => void }) {
  const t = useT()
  const confirm = useConfirm()
  const actor = useActor()
  const canDelete = useCan('users.delete')
  const canEdit = useCan('users.edit')
  const [f, setF] = useState<Form>(() => blank(''))
  const [tab, setTab] = useState<'account' | 'perms'>('account')
  const [show, setShow] = useState(false)
  const [key, setKey] = useState<string | null>(null)
  const save = useAction(saveUser, { success: 'users.saved' })
  const del = useAction(deleteUser, { success: 'users.deleted' })
  const unlock = useAction(unlockUser, { success: 'users.unlocked' })

  const isNew = value === 'new'
  const id = value ? (isNew ? 'new' : value.id) : null
  useEffect(() => {
    if (id === key) return
    setKey(id); setTab('account'); setShow(false)
    if (!value) return
    if (value === 'new') setF(blank(roles.find((r) => r.key === 'cashier')?.id ?? roles[0]?.id ?? ''))
    else setF({ name: value.name, username: value.username, roleId: value.roleId, active: value.active, color: value.color, pin: '', password: '', grants: value.grants, denies: value.denies, maxDiscountPct: String(value.limits.maxDiscountPct), maxRefundIQD: String(value.limits.maxRefundIQD) })
  }, [id, key, value, roles])
  // roles may finish loading after the editor opened — pick the default (Cashier) as soon as they arrive
  useEffect(() => {
    if (value === 'new' && !f.roleId && roles.length) setF((p) => ({ ...p, roleId: roles.find((r) => r.key === 'cashier')?.id ?? roles[0].id }))
  }, [value, f.roleId, roles])
  if (!value) return null

  const existing = isNew ? null : value
  const role = roles.find((r) => r.id === f.roleId)
  const assignable = roles.filter((r) => r.key !== 'super_admin' || actor?.isSuperAdmin)
  const preview = role ? effectivePermissions(role, { grants: f.grants, denies: f.denies }).filter((p) => p !== '*').length : 0
  const isSelf = existing?.id === actor?.id
  const locked = !!existing?.lockedUntil && existing.lockedUntil > Date.now()
  const isSuper = role?.key === 'super_admin'

  const genPin = () => setF((p) => ({ ...p, pin: String(1000 + Math.floor(Math.random() * 9000)) }))

  const submit = async () => {
    const u = await save({
      id: existing?.id, name: f.name, username: f.username, roleId: f.roleId, active: f.active, color: f.color,
      pin: f.pin || undefined, password: f.password || undefined, grants: f.grants, denies: f.denies,
      limits: { maxDiscountPct: parseAmount(f.maxDiscountPct), maxRefundIQD: parseAmount(f.maxRefundIQD) },
    })
    if (u) onClose()
  }
  const remove = async () => {
    if (!existing) return
    if (await confirm({ title: t('users.delete_title'), message: t('users.delete_msg', { name: existing.name }), danger: true, confirmLabel: t('common.delete') })) { if (await del(existing.id)) onClose() }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? t('users.new') : existing!.name}
      size="xl"
      className="md:h-[min(46rem,92dvh)]"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            {canDelete && existing && !isSelf && <Button variant="ghost" className="text-danger" icon={<Trash2 className="size-5" />} onClick={remove}>{t('common.delete')}</Button>}
            {canEdit && locked && <Button variant="secondary" icon={<Unlock className="size-5" />} onClick={async () => { await unlock(existing!.id); onClose() }}>{t('users.unlock')}</Button>}
          </div>
          <Button size="lg" variant="primary" loading={save.busy} disabled={!f.name.trim() || !f.username.trim() || !f.roleId || (isNew && !f.pin)} onClick={submit}>{t('common.save')}</Button>
        </div>
      }
    >
      <div className="space-y-5">
        <Segmented value={tab} onChange={setTab} options={[{ value: 'account', label: t('users.tab_account') }, { value: 'perms', label: <span className="inline-flex items-center gap-1.5">{t('users.tab_perms')}{(f.grants.length + f.denies.length) > 0 && <Badge tone="gold"><span className="num">{f.grants.length + f.denies.length}</span></Badge>}</span> }]} />

        {tab === 'account' ? (
          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <Avatar name={f.name || '?'} color={f.color} size={64} />
                <div className="flex flex-wrap gap-2">
                  {AVATAR_COLORS.map((c) => <button key={c} type="button" aria-label={c} aria-pressed={f.color === c} onClick={() => setF({ ...f, color: c })} className={cn('size-8 rounded-full border-2', f.color === c ? 'border-fg' : 'border-transparent')} style={{ background: c }} />)}
                </div>
              </div>
              <Field label={t('common.name')}>{(i) => <Input id={i} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-autofocus />}</Field>
              <Field label={t('common.username')} hint={t('users.username_hint')}>{(i) => <Input id={i} autoCapitalize="none" autoCorrect="off" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase() })} />}</Field>
              <Field label={t('users.role')} hint={role?.description}>
                {(i) => <Select id={i} value={f.roleId} onChange={(e) => setF({ ...f, roleId: e.target.value })} disabled={isSelf && isSuper}>{assignable.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>}
              </Field>
              <div className="flex items-center justify-between rounded-xl bg-surface-2 p-3.5">
                <div><div className="text-sm font-medium">{t('users.active')}</div><div className="text-xs text-fg-2">{t('users.active_hint')}</div></div>
                <Switch checked={f.active} onChange={(v) => setF({ ...f, active: v })} label={t('users.active')} disabled={isSelf} />
              </div>
              {existing && <p className="text-xs text-fg-2">{t('users.last_login')}: <span className="num">{existing.lastLoginAt ? fmtDateTime(existing.lastLoginAt) : '—'}</span></p>}
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-line p-4">
                <h3 className="mb-3 flex items-center gap-2 font-semibold"><Lock className="size-4 text-gold-text" />{t('users.credentials')}</h3>
                <div className="space-y-4">
                  <Field label={isNew ? t('common.pin') : t('users.new_pin')} hint={isNew ? t('setup.pin_hint') : t('users.keep_hint')}>
                    {(i) => (
                      <div className="flex gap-2">
                        <Input id={i} type={show ? 'text' : 'password'} inputMode="numeric" maxLength={6} autoComplete="off" className="num tracking-[.25em]" value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, '') })} />
                        <Button variant="secondary" aria-label={t('users.random_pin')} title={t('users.random_pin')} className="px-3" onClick={genPin}><Dices className="size-5" /></Button>
                        <Button variant="secondary" aria-label={show ? t('users.hide') : t('users.show')} className="px-3" onClick={() => setShow(!show)}>{show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}</Button>
                      </div>
                    )}
                  </Field>
                  <Field label={existing?.hasPassword ? t('users.new_password') : t('common.password')} hint={existing ? t('users.keep_hint') : t('users.password_optional')}>
                    {(i) => <Input id={i} type={show ? 'text' : 'password'} autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />}
                  </Field>
                </div>
              </div>
              <div className="rounded-2xl border border-line p-4">
                <h3 className="mb-1 font-semibold">{t('users.limits')}</h3>
                <p className="mb-3 text-xs text-fg-2">{t('users.limits_hint')}</p>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t('users.max_discount')}>{(i) => <Input id={i} inputMode="numeric" className="num" value={f.maxDiscountPct} onChange={(e) => setF({ ...f, maxDiscountPct: e.target.value.replace(/\D/g, '') })} />}</Field>
                  <Field label={t('users.max_refund')}>{(i) => <Input id={i} inputMode="numeric" className="num" value={f.maxRefundIQD} onChange={(e) => setF({ ...f, maxRefundIQD: e.target.value.replace(/\D/g, '') })} />}</Field>
                </div>
              </div>
            </div>
          </div>
        ) : !actor?.isSuperAdmin ? (
          <p className="rounded-xl bg-warn-bg p-4 text-sm text-warn-fg">{t('users.perms_sa_only')}</p>
        ) : isSuper ? (
          <p className="rounded-xl bg-surface-2 p-4 text-sm text-fg-2">{t('users.perms_super')}</p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-2 p-3.5 text-sm">
              <span>{t('users.perms_intro', { role: role?.name ?? '' })}</span>
              <Badge tone="gold">{t('users.effective_count', { n: preview })}</Badge>
            </div>
            <UserOverrideMatrix rolePerms={role?.permissions ?? []} grants={f.grants} denies={f.denies} onChange={(g, d) => setF({ ...f, grants: g, denies: d })} />
            {(f.grants.length + f.denies.length) > 0 && <Button variant="ghost" onClick={() => setF({ ...f, grants: [], denies: [] })}>{t('users.clear_overrides')}</Button>}
          </div>
        )}
      </div>
    </Modal>
  )
}

