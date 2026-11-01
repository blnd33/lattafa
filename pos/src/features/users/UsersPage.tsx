import { useMemo, useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Lock, Monitor, Pencil, Plus, ShieldCheck } from 'lucide-react'
import { Avatar, Badge, EmptyState, PageHeader, Spinner } from '@/components/ui/Controls'
import { Button } from '@/components/ui/Button'
import { Field, Input, SearchInput, Select } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { cn } from '@/components/ui/cn'
import { useT } from '@/i18n'
import type { Role } from '@/data/types'
import { fmtDate, fmtDateTime } from '@/lib/date'
import { hasPerm } from '@/lib/permissions'
import { listAudit } from '@/services/audit'
import { listDevices, setDeviceRevoked, updateDevice } from '@/services/devices'
import type { PublicUser } from '@/services/users'
import { useAction, useRoles, useUsers } from '@/hooks/queries'
import { useActor, useCan } from '@/hooks/useAuth'
import { RoleEditor } from './RoleEditor'
import { AUDIT_GROUPS, auditDetails } from './auditText'
import { UserEditor } from './UserEditor'

/** Users & roles hub: accounts, roles/permissions, activity log, devices. */
export function UsersPage() {
  const t = useT()
  const actor = useActor()
  const can = (p: string) => !!actor && hasPerm(actor.permissions, p)
  const tabs = [
    { to: '/users', end: true, label: t('users.tab_users'), show: can('users.view') },
    { to: '/users/roles', end: false, label: t('users.tab_roles'), show: can('users.view') },
    { to: '/users/audit', end: false, label: t('users.tab_audit'), show: can('audit.view') },
    { to: '/users/devices', end: false, label: t('users.tab_devices'), show: can('devices.manage') },
  ].filter((x) => x.show)
  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      <PageHeader title={t('users.title')} subtitle={t('users.subtitle')} />
      <nav className="mb-5 inline-flex max-w-full gap-1 overflow-x-auto rounded-xl bg-surface-2 p-1 scroll-hide" aria-label={t('users.title')}>
        {tabs.map((x) => (
          <NavLink key={x.to} to={x.to} end={x.end} className={({ isActive }) => cn('whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold transition', isActive ? 'bg-gold text-ink shadow-sm' : 'text-fg-2 hover:text-fg')}>{x.label}</NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<UsersTab />} />
        <Route path="roles" element={<RolesTab />} />
        <Route path="audit" element={can('audit.view') ? <AuditTab /> : <Navigate to="/users" replace />} />
        <Route path="devices" element={can('devices.manage') ? <DevicesTab /> : <Navigate to="/users" replace />} />
      </Routes>
    </div>
  )
}

/* ───────── accounts ───────── */
function UsersTab() {
  const t = useT()
  const { data: users, isLoading } = useUsers()
  const { data: roles = [] } = useRoles()
  const canCreate = useCan('users.create')
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<PublicUser | 'new' | null>(null)
  const roleOf = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles])
  const list = (users ?? []).filter((u) => !q.trim() || (u.name + u.username).toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <SearchInput className="min-w-56 flex-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('users.search')} />
        {canCreate && <Button variant="primary" size="lg" icon={<Plus className="size-5" />} onClick={() => setEditing('new')}>{t('users.new')}</Button>}
      </div>
      {isLoading ? <div className="grid place-items-center py-16"><Spinner className="size-9" /></div> : !list.length ? <EmptyState title={t('users.none')} /> : (
        <ul className="grid gap-2.5 md:grid-cols-2">
          {list.map((u) => {
            const r = roleOf.get(u.roleId)
            const locked = !!u.lockedUntil && u.lockedUntil > Date.now()
            return (
              <li key={u.id}>
                <button type="button" onClick={() => setEditing(u)} className={cn('flex w-full items-center gap-3.5 rounded-2xl border border-line bg-surface p-3.5 text-start shadow-soft transition hover:border-gold-light active:bg-surface-2', !u.active && 'opacity-60')}>
                  <Avatar name={u.name} color={u.color} size={52} />
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate font-semibold">{u.name}</span>
                    <span className="block truncate text-xs text-fg-2">@{u.username}</span>
                    <span className="mt-1.5 flex flex-wrap gap-1.5">
                      <Badge tone={r?.key === 'super_admin' ? 'gold' : 'neutral'}>{r?.key === 'super_admin' && <ShieldCheck className="size-3" />}{r?.name ?? '—'}</Badge>
                      {!u.active && <Badge tone="danger">{t('users.disabled')}</Badge>}
                      {locked && <Badge tone="warn"><Lock className="size-3" />{t('users.locked')}</Badge>}
                      {(u.grants.length + u.denies.length) > 0 && <Badge tone="gold">{t('users.custom_perms')}</Badge>}
                    </span>
                  </span>
                  <Pencil className="size-4 shrink-0 text-fg-2" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <UserEditor value={editing} roles={roles} onClose={() => setEditing(null)} />
    </>
  )
}

/* ───────── roles ───────── */
function RolesTab() {
  const t = useT()
  const { data: roles, isLoading } = useRoles()
  const { data: users = [] } = useUsers()
  const canManage = useCan('roles.manage')
  const [editing, setEditing] = useState<Role | 'new' | null>(null)
  if (isLoading || !roles) return <div className="grid place-items-center py-16"><Spinner className="size-9" /></div>
  const count = (id: string) => users.filter((u) => u.roleId === id).length
  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-fg-2">{t('roles.intro')}</p>
        {canManage && <Button variant="primary" size="lg" icon={<Plus className="size-5" />} onClick={() => setEditing('new')}>{t('roles.new')}</Button>}
      </div>
      <ul className="grid gap-2.5 md:grid-cols-2">
        {roles.map((r) => (
          <li key={r.id}>
            <button type="button" onClick={() => setEditing(r)} className="flex w-full items-start gap-3.5 rounded-2xl border border-line bg-surface p-4 text-start shadow-soft transition hover:border-gold-light active:bg-surface-2">
              <span className={cn('grid size-11 shrink-0 place-items-center rounded-xl', r.key === 'super_admin' ? 'bg-gold text-ink' : 'bg-surface-2 text-gold-text')}><ShieldCheck className="size-5" /></span>
              <span className="min-w-0 flex-1 leading-snug">
                <span className="flex flex-wrap items-center gap-2 font-semibold">{r.name}{r.isSystem && <Badge tone="neutral">{t('roles.system')}</Badge>}</span>
                <span className="mt-0.5 block text-sm text-fg-2">{r.description}</span>
                <span className="mt-2 flex flex-wrap gap-1.5">
                  <Badge tone="gold"><span className="num">{r.permissions.includes('*') ? t('roles.all') : r.permissions.length}</span> {t('roles.perms_short')}</Badge>
                  <Badge tone="neutral"><span className="num">{count(r.id)}</span> {t('roles.users_short')}</Badge>
                  {r.apps.map((a) => <Badge key={a} tone="neutral">{t(`roles.app_${a}`)}</Badge>)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <RoleEditor value={editing} roles={roles} onClose={() => setEditing(null)} />
    </>
  )
}

/* ───────── activity log ───────── */
function AuditTab() {
  const t = useT()
  const [prefix, setPrefix] = useState('')
  const { data, isLoading } = useQuery({ queryKey: ['audit', prefix], queryFn: () => listAudit({ action: prefix || undefined, limit: 300 }) })
  const label = (action: string) => { const k = `act.${action}`; const s = t(k); return s === k ? action : s }
  return (
    <>
      <div className="mb-4 max-w-xs"><Select value={prefix} onChange={(e) => setPrefix(e.target.value)} aria-label={t('users.audit_filter')}><option value="">{t('users.audit_all')}</option>{AUDIT_GROUPS.map((g) => <option key={g} value={g}>{t(`actg.${g}`)}</option>)}</Select></div>
      {isLoading ? <Spinner /> : !data?.length ? <EmptyState title={t('users.audit_none')} /> : (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {data.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
              <span className="num w-36 shrink-0 text-xs text-fg-2">{fmtDateTime(e.createdAt)}</span>
              <span className="w-36 shrink-0 truncate font-medium">{e.userName}</span>
              <span className="w-52 shrink-0 font-medium" title={e.action}>{label(e.action)}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-fg-2" title={auditDetails(e.meta)}>{auditDetails(e.meta)}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

/* ───────── devices ───────── */
function DevicesTab() {
  const t = useT()
  const { data, isLoading } = useQuery({ queryKey: ['devices'], queryFn: listDevices })
  const [edit, setEdit] = useState<{ id: string; name: string; code: string } | null>(null)
  const save = useAction(updateDevice, { success: 'users.device_saved' })
  const revoke = useAction(setDeviceRevoked)
  if (isLoading) return <Spinner />
  return (
    <>
      <p className="mb-4 text-sm text-fg-2">{t('users.devices_intro')}</p>
      <ul className="space-y-2.5">
        {(data ?? []).map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-3.5">
            <span className="grid size-11 place-items-center rounded-xl bg-surface-2 text-gold-text"><Monitor className="size-5" /></span>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="flex flex-wrap items-center gap-2 font-semibold">{d.name} <Badge tone="neutral"><span className="num">{d.code}</span></Badge>{d.isThis && <Badge tone="gold">{t('users.this_device')}</Badge>}{d.revoked && <Badge tone="danger">{t('users.revoked')}</Badge>}</div>
              <div className="num text-xs text-fg-2">{t('users.registered')}: {fmtDate(d.registeredAt)}</div>
            </div>
            <Button variant="secondary" onClick={() => setEdit({ id: d.id, name: d.name, code: d.code })}>{t('common.edit')}</Button>
            {!d.isThis && <Button variant="ghost" className={d.revoked ? '' : 'text-danger'} onClick={() => void revoke(d.id, !d.revoked)}>{d.revoked ? t('users.restore') : t('users.revoke')}</Button>}
          </li>
        ))}
      </ul>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={t('users.device_edit')} size="sm" footer={<Button size="lg" variant="primary" block loading={save.busy} onClick={async () => { if (edit && (await save(edit.id, { name: edit.name, code: edit.code })) === undefined) return; setEdit(null) }}>{t('common.save')}</Button>}>
        {edit && (
          <div className="space-y-4">
            <Field label={t('common.name')}>{(i) => <Input id={i} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} data-autofocus />}</Field>
            <Field label={t('users.device_code')} hint={t('users.device_code_hint')}>{(i) => <Input id={i} className="num uppercase" maxLength={6} value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase() })} />}</Field>
          </div>
        )}
      </Modal>
    </>
  )
}
