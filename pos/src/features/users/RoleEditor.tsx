import { useEffect, useState } from 'react'
import { Copy, Lock, Trash2 } from 'lucide-react'
import { Badge, Checkbox } from '@/components/ui/Controls'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Modal, useConfirm } from '@/components/ui/Modal'
import { useT } from '@/i18n'
import type { AppKey, Role } from '@/data/types'
import { deleteRole, saveRole } from '@/services/users'
import { useAction } from '@/hooks/queries'
import { RolePermissionMatrix } from './PermissionMatrix'

const APPS: AppKey[] = ['pos', 'admin', 'delegate']

/** Create / edit a role. System roles can be inspected; only Super Admin is fully locked. */
export function RoleEditor({ value, roles, onClose }: { value: Role | 'new' | null; roles: Role[]; onClose: () => void }) {
  const t = useT()
  const confirm = useConfirm()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [perms, setPerms] = useState<string[]>([])
  const [apps, setApps] = useState<AppKey[]>(['pos'])
  const [key, setKey] = useState<string | null>(null)
  const save = useAction(saveRole, { success: 'roles.saved' })
  const del = useAction(deleteRole, { success: 'roles.deleted' })

  const isNew = value === 'new'
  const id = value ? (isNew ? 'new' : value.id) : null
  useEffect(() => {
    if (id === key) return
    setKey(id)
    if (!value) return
    if (value === 'new') { setName(''); setDescription(''); setPerms(['pos.sell', 'products.view']); setApps(['pos']) }
    else { setName(value.name); setDescription(value.description); setPerms(value.permissions); setApps(value.apps) }
  }, [id, key, value])
  if (!value) return null

  const locked = !isNew && value.key === 'super_admin'
  const cloneFrom = (rid: string) => { const r = roles.find((x) => x.id === rid); if (r) setPerms(r.permissions.includes('*') ? ['*'] : r.permissions) }
  const submit = async () => { if (await save({ id: isNew ? undefined : value.id, name, description, permissions: perms, apps })) onClose() }
  const remove = async () => {
    if (isNew) return
    if (await confirm({ title: t('roles.delete_title'), message: t('roles.delete_msg', { name: value.name }), danger: true, confirmLabel: t('common.delete') })) { if (await del(value.id)) onClose() }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? t('roles.new') : value.name}
      size="2xl"
      className="md:h-[min(48rem,92dvh)]"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          {!isNew && !value.isSystem ? <Button variant="ghost" className="text-danger" icon={<Trash2 className="size-5" />} onClick={remove}>{t('common.delete')}</Button> : <span />}
          {!locked && <Button size="lg" variant="primary" loading={save.busy} disabled={!name.trim()} onClick={submit}>{t('common.save')}</Button>}
        </div>
      }
    >
      <div className="space-y-5">
        {locked && <p className="flex items-center gap-2 rounded-xl bg-gold-soft p-3.5 text-sm text-[#6b4e12] dark:bg-gold/15 dark:text-gold-light"><Lock className="size-4 shrink-0" />{t('roles.locked')}</p>}
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t('roles.name')}>{(i) => <Input id={i} value={name} disabled={locked} onChange={(e) => setName(e.target.value)} data-autofocus />}</Field>
          <Field label={t('roles.description')}>{(i) => <Textarea id={i} rows={2} value={description} disabled={locked} onChange={(e) => setDescription(e.target.value)} className="min-h-11" />}</Field>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">{t('roles.apps')}:</div>
          {APPS.map((a) => (
            <label key={a} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={apps.includes(a)} disabled={locked} label={t(`roles.app_${a}`)} onChange={(on) => setApps(on ? [...apps, a] : apps.filter((x) => x !== a))} />
              {t(`roles.app_${a}`)}
            </label>
          ))}
          {!locked && (
            <div className="ms-auto flex items-center gap-2"><Copy className="size-4 text-fg-2" />
              <Select aria-label={t('roles.copy_from')} className="h-10 w-52 text-sm" value="" onChange={(e) => cloneFrom(e.target.value)}>
                <option value="">{t('roles.copy_from')}…</option>
                {roles.filter((r) => r.id !== (isNew ? '' : value.id)).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </Select>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 text-sm text-fg-2">{t('roles.perms')} <Badge tone="gold"><span className="num">{perms.includes('*') ? 'ALL' : perms.length}</span></Badge></div>
        <RolePermissionMatrix value={perms} onChange={setPerms} readOnly={locked} />
      </div>
    </Modal>
  )
}
