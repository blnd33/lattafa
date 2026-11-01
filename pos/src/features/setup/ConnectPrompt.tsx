import { useState } from 'react'
import { CloudUpload, HardDrive } from 'lucide-react'
import { BrandMark } from '@/components/ui/Brand'
import { Button } from '@/components/ui/Button'
import { Credit, LangSwitch, ThemeToggle } from '@/components/layout/Chrome'
import { useT } from '@/i18n'
import { connectToServer, stayLocal } from '@/services/connection'
import { useCart } from '@/store/cart'
import { useSession } from '@/store/session'

/**
 * Shown once, when a device that used to run on its own (with its own test data) finds the shop server on this domain.
 * Connecting replaces that local data with the server's; staying keeps it as a separate, local-only POS.
 */
export function ConnectPrompt({ onDone }: { onDone: () => void }) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const connect = async () => {
    setBusy(true)
    try {
      await connectToServer(true)
      useSession.getState().signOut() // the local account no longer exists
      useCart.getState().clear() // nor do the bottles on any open bill
      onDone()
    } finally { setBusy(false) }
  }
  return (
    <div className="relative flex min-h-dvh flex-col bg-bg pt-safe">
      <div className="relative flex items-center justify-end gap-2 p-3"><LangSwitch /><ThemeToggle /></div>
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center px-4 pb-6">
        <BrandMark size="lg" className="mb-4 mt-2 flex-col gap-1 sm:mt-6" />
        <section className="w-full space-y-4 rounded-3xl border border-line bg-surface p-5 shadow-soft">
          <h1 className="font-serif text-xl font-semibold">{t('connect.title')}</h1>
          <p className="text-sm leading-relaxed text-fg-2">{t('connect.body')}</p>
          <Button variant="primary" size="xl" block loading={busy} icon={<CloudUpload className="size-5" />} onClick={connect}>{t('connect.go')}</Button>
          <Button variant="ghost" block disabled={busy} icon={<HardDrive className="size-5" />} onClick={() => { stayLocal(); onDone() }}>{t('connect.stay')}</Button>
        </section>
      </main>
      <Credit className="pb-[max(1rem,env(safe-area-inset-bottom))] pt-2" />
    </div>
  )
}
