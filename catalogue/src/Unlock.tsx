import { useEffect, useRef, useState } from 'react'
import { KeyRound, LogOut } from 'lucide-react'
import { CatalogueError, type Country, type Session, unlock } from './api'
import { Button, Rule, Spinner, cx } from './ui'
import { problemText, useT } from './words'

/**
 * The access code: the one door between browsing and buying.
 *
 * Every refusal is said plainly and differently — expired, withdrawn, on hold, wrong country — because those
 * mean different things to the shop that is typing. The one exception is a code that was never issued, which is
 * told only that it was not recognised.
 *
 * The code goes to the server as typed. Nothing is checked here first: a guess refused in the browser would just
 * teach a guesser what the shape of a real code is.
 */
export function Unlock({ open, session, country, onClose, onSignedIn, onSignOut }: {
  open: boolean
  session: Session | null
  country: Country | null
  onClose: () => void
  onSignedIn: (token: string, session: Session) => void
  onSignOut: () => void
}) {
  const t = useT()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<{ code: string; params: Record<string, string | number> } | null>(null)
  const box = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setProblem(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const at = setTimeout(() => box.current?.focus(), 60)
    return () => { window.removeEventListener('keydown', onKey); clearTimeout(at) }
  }, [open, onClose])

  if (!open) return null

  const submit = async () => {
    if (!code.trim() || busy) return
    setBusy(true)
    setProblem(null)
    try {
      const out = await unlock(code, country?.iso2 ?? null)
      setCode('')
      onSignedIn(out.token, out.session)
    } catch (e) {
      const err = e instanceof CatalogueError ? e : new CatalogueError('unknown')
      setProblem({ code: err.code === 'too_many_requests' ? 'too_many' : err.code, params: err.params })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" role="dialog" aria-modal="true" aria-label={t('cat.unlock_title')}>
      <button type="button" aria-label={t('cat.close')} onClick={onClose} className="absolute inset-0 bg-overlay motion-safe:animate-fade" />

      <div className="relative w-full max-w-sm rounded-card bg-bg p-7 shadow-pop motion-safe:animate-pop">
        {session ? (
          <div className="text-center">
            <Rule />
            <p className="mt-4 text-xs tracking-[0.16em] text-fg-2 uppercase">{t('cat.signed_in_as', { business: '' })}</p>
            <p className="font-serif mt-1 text-2xl">{session.business}</p>
            {session.country && <p className="num mt-1 text-sm text-fg-2">{session.country.name.en || session.country.iso2}</p>}
            <div className="mt-6 grid gap-2">
              <Button variant="quiet" onClick={onClose} full>{t('cat.close')}</Button>
              <Button variant="ghost" onClick={onSignOut} full><LogOut className="size-4 rtl:rotate-180" />{t('cat.lock')}</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); void submit() }}>
            <div className="text-center">
              <span className="mx-auto grid size-12 place-items-center rounded-full bg-gold-soft text-gold-text"><KeyRound className="size-5" /></span>
              <h2 className="font-serif mt-4 text-2xl">{t('cat.unlock_title')}</h2>
              <p className="mt-2 text-sm leading-relaxed text-fg-2">{t('cat.unlock_lead')}</p>
            </div>

            <label htmlFor="wholesale-code" className="mt-6 block text-xs font-medium text-fg-2">{t('cat.code_label')}</label>
            <input
              id="wholesale-code"
              ref={box}
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="LAT-XXXXXXXX"
              aria-invalid={!!problem}
              className={cx(
                'num mt-1.5 h-12 w-full rounded-xl border bg-surface px-4 text-center text-lg font-semibold tracking-[0.2em] uppercase outline-none transition',
                problem ? 'border-danger focus:ring-4 focus:ring-danger/15' : 'border-line focus:border-gold focus:ring-4 focus:ring-gold/20',
              )}
            />

            {problem && (
              <p role="alert" className="mt-3 text-center text-sm font-medium text-danger-fg">
                {problemText(t, problem, (c) => `$${(c / 100).toFixed(2)}`)}
              </p>
            )}

            <Button type="submit" disabled={!code.trim() || busy} full className="mt-5">
              {busy ? <Spinner className="size-4" /> : t('cat.unlock_cta')}
            </Button>
            <button type="button" onClick={onClose} className="mt-3 w-full text-center text-sm text-fg-2 transition hover:text-fg">{t('cat.close')}</button>
          </form>
        )}
      </div>
    </div>
  )
}
