import { Checkbox } from '@/components/ui/Controls'
import { cn } from '@/components/ui/cn'
import { useT } from '@/i18n'
import { PERMISSION_GROUPS, SUPER_ADMIN_ONLY } from '@/lib/permissions'

/**
 * Role editor matrix: every permission grouped by area, with a select-all per group.
 * `value` is the set of permissions the role grants.
 */
export function RolePermissionMatrix({ value, onChange, readOnly }: { value: string[]; onChange: (v: string[]) => void; readOnly?: boolean }) {
  const t = useT()
  const all = value.includes('*')
  const has = (p: string) => all || value.includes(p)
  const toggle = (p: string, on: boolean) => onChange(on ? [...new Set([...value, p])] : value.filter((x) => x !== p))
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {PERMISSION_GROUPS.map((g) => {
        const count = g.perms.filter(has).length
        return (
          <section key={g.key} className="rounded-2xl border border-line bg-surface">
            <header className="flex items-center gap-3 border-b border-line px-3.5 py-2.5">
              <Checkbox checked={count === g.perms.length} mixed={count > 0 && count < g.perms.length} disabled={readOnly || all} label={t(`permgroup.${g.key}`)} onChange={(on) => onChange(on ? [...new Set([...value, ...g.perms])] : value.filter((x) => !g.perms.includes(x)))} />
              <h4 className="flex-1 text-sm font-semibold">{t(`permgroup.${g.key}`)}</h4>
              <span className="num text-xs text-fg-2">{count}/{g.perms.length}</span>
            </header>
            <ul className="divide-y divide-line">
              {g.perms.map((p) => (
                <li key={p}>
                  <label className={cn('flex min-h-11 cursor-pointer items-center gap-3 px-3.5 py-2 text-sm', (readOnly || all) && 'cursor-default')}>
                    <Checkbox checked={has(p)} disabled={readOnly || all} label={t(`perm.${p}`)} onChange={(on) => toggle(p, on)} />
                    <span className="min-w-0 flex-1">{t(`perm.${p}`)}</span>
                    {SUPER_ADMIN_ONLY.has(p) && <span className="rounded-full bg-gold-soft px-2 py-0.5 text-[10px] font-semibold text-[#6b4e12] dark:bg-gold/20 dark:text-gold-light">{t('roles.sa_only')}</span>}
                  </label>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

type Tri = 'inherit' | 'allow' | 'deny'

/**
 * Per-user override matrix. Each permission is Inherit (whatever the role says),
 * Allow (extra grant) or Deny (blocked even if the role allows it).
 */
export function UserOverrideMatrix({ rolePerms, grants, denies, onChange, disabled }: { rolePerms: string[]; grants: string[]; denies: string[]; onChange: (g: string[], d: string[]) => void; disabled?: boolean }) {
  const t = useT()
  const roleAll = rolePerms.includes('*')
  const state = (p: string): Tri => (grants.includes(p) ? 'allow' : denies.includes(p) ? 'deny' : 'inherit')
  const set = (p: string, s: Tri) => onChange(
    s === 'allow' ? [...new Set([...grants, p])] : grants.filter((x) => x !== p),
    s === 'deny' ? [...new Set([...denies, p])] : denies.filter((x) => x !== p),
  )
  return (
    <div className="space-y-3">
      {PERMISSION_GROUPS.map((g) => (
        <section key={g.key} className="overflow-hidden rounded-2xl border border-line bg-surface">
          <h4 className="border-b border-line bg-surface-2/60 px-3.5 py-2 text-sm font-semibold">{t(`permgroup.${g.key}`)}</h4>
          <ul className="divide-y divide-line">
            {g.perms.map((p) => {
              const s = state(p)
              const roleHas = roleAll || rolePerms.includes(p)
              const effective = s === 'allow' ? true : s === 'deny' ? false : roleHas
              return (
                <li key={p} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3.5 py-2 text-sm">
                  <span className={cn('size-2 shrink-0 rounded-full', effective ? 'bg-success' : 'bg-line')} aria-label={effective ? t('users.effective_yes') : t('users.effective_no')} />
                  <span className="min-w-0 flex-1">{t(`perm.${p}`)}</span>
                  <div role="group" aria-label={t(`perm.${p}`)} className="inline-flex rounded-lg bg-surface-2 p-0.5 text-xs font-semibold">
                    {(['inherit', 'allow', 'deny'] as Tri[]).map((x) => (
                      <button key={x} type="button" disabled={disabled} aria-pressed={s === x} onClick={() => set(p, x)} className={cn('h-8 rounded-md px-2.5 transition disabled:opacity-40', s === x ? (x === 'allow' ? 'bg-success text-white' : x === 'deny' ? 'bg-danger text-white' : 'bg-surface text-fg shadow-sm') : 'text-fg-2')}>
                        {x === 'inherit' ? (roleHas ? t('users.inherit_yes') : t('users.inherit_no')) : t(`users.${x}`)}
                      </button>
                    ))}
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
