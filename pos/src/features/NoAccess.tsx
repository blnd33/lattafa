import type { ReactNode } from 'react'
import { ShieldOff } from 'lucide-react'
import { useT } from '@/i18n'
import { hasPerm } from '@/lib/permissions'
import { useSession } from '@/store/session'

export function NoAccess() {
  const t = useT()
  return (
    <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-3 p-8 text-center">
      <span className="grid size-20 place-items-center rounded-full bg-surface-2 text-fg-2"><ShieldOff className="size-9" /></span>
      <h1 className="font-serif text-2xl font-semibold">{t('noaccess.title')}</h1>
      <p className="text-sm text-fg-2">{t('noaccess.hint')}</p>
    </div>
  )
}

/** Renders children only if the signed-in user holds at least one of `perms`. */
export function RequireAny({ perms, children }: { perms: string[]; children: ReactNode }) {
  const actor = useSession((s) => s.actor)
  if (!actor || !perms.some((p) => hasPerm(actor.permissions, p))) return <NoAccess />
  return <>{children}</>
}
