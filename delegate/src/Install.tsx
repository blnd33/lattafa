import { useState } from 'react'
import { Download, Smartphone, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Controls'
import { useT } from '@/i18n'
import { useInstall } from '@/hooks/useInstall'

const DISMISSED = 'lattafa-dl-install-later'

/** More screen: put the delegate app on the phone's home screen so it opens like a normal app. */
export function InstallCard() {
  const t = useT()
  const inst = useInstall()
  return (
    <Card className="mx-4 space-y-3">
      <h2 className="flex items-center gap-2 font-semibold"><Smartphone className="size-5 text-gold-text" />{t('dl.install_title')}</h2>
      {inst.installed ? <p className="text-sm text-ok-fg">{t('dl.installed')}</p> : inst.canPrompt ? (
        <><p className="text-sm text-fg-2">{t('dl.install_hint')}</p><Button variant="primary" block icon={<Download className="size-5" />} onClick={inst.install}>{t('dl.install_go')}</Button></>
      ) : <p className="text-sm text-fg-2">{t(inst.ios ? 'dl.install_ios' : 'dl.install_browser')}</p>}
    </Card>
  )
}

/** Home screen nudge until the app is installed (or the delegate taps "Not now"). */
export function InstallBanner() {
  const t = useT()
  const inst = useInstall()
  const [later, setLater] = useState(() => { try { return localStorage.getItem(DISMISSED) === '1' } catch { return false } })
  if (later || inst.installed || !(inst.canPrompt || inst.ios)) return null
  const dismiss = () => { try { localStorage.setItem(DISMISSED, '1') } catch { /* private mode */ } setLater(true) }
  return (
    <div className="mx-4 mt-3 flex items-center gap-3 rounded-2xl border border-gold/40 bg-surface p-3">
      <Smartphone className="size-6 shrink-0 text-gold-text" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{t('dl.install_title')}</p>
        <p className="text-xs text-fg-2">{t(inst.canPrompt ? 'dl.install_hint' : 'dl.install_ios')}</p>
      </div>
      {inst.canPrompt && <Button variant="primary" size="sm" onClick={inst.install}>{t('dl.install_go')}</Button>}
      <button type="button" className="grid size-10 shrink-0 place-items-center rounded-full text-fg-2 hover:bg-surface-2" aria-label={t('dl.install_later')} onClick={dismiss}><X className="size-4" /></button>
    </div>
  )
}
