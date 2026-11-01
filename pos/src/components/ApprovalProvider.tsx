import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { ShieldCheck } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { PinPad } from '@/components/ui/Pad'
import { errorMessage, useT } from '@/i18n'
import { verifyApproval } from '@/services/auth'

export interface Approver { id: string; name: string }
type AskFn = (permission: string, reason?: string) => Promise<Approver | null>

const Ctx = createContext<AskFn>(async () => null)

/**
 * Supervisor approval by PIN.
 *   const ask = useApproval()
 *   const boss = await ask('sales.discount.above_limit', 'Discount 25% is above your limit')
 * Resolves to the approving user (or null if cancelled). The services re-verify
 * the approver when the sale is saved, so this UI alone can't be used to cheat.
 */
export const useApproval = () => useContext(Ctx)

export function ApprovalProvider({ children }: { children: ReactNode }) {
  const t = useT()
  const [req, setReq] = useState<{ permission: string; reason?: string; resolve: (a: Approver | null) => void } | null>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const ask = useCallback<AskFn>((permission, reason) => new Promise((resolve) => { setPin(''); setError(''); setReq({ permission, reason, resolve }) }), [])
  const close = (a: Approver | null) => { req?.resolve(a); setReq(null); setPin('') }

  const submit = async (value: string) => {
    if (!req || busy) return
    setBusy(true)
    try {
      const who = await verifyApproval(value, req.permission)
      if (who) close(who)
      else { setError(t('approval.wrong')); setPin('') }
    } catch (e) {
      setError(errorMessage(e, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Ctx.Provider value={ask}>
      {children}
      <Modal open={!!req} onClose={() => close(null)} title={t('approval.title')} size="sm">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="grid size-14 place-items-center rounded-full bg-gold-soft text-gold-dark dark:bg-gold/20"><ShieldCheck className="size-7" /></span>
          <p className="text-sm text-fg-2">{req?.reason || t('approval.hint')}</p>
          <p className="text-xs font-medium text-fg-2">{t(`perm.${req?.permission ?? ''}`)}</p>
          {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
          <PinPad value={pin} onChange={(v) => { setPin(v); setError('') }} onSubmit={submit} error={!!error} disabled={busy} />
        </div>
      </Modal>
    </Ctx.Provider>
  )
}
