import { useState } from 'react'
import { Check, MessageCircle, Send } from 'lucide-react'
import { CatalogueError, money, placeOrder, whatsappOpened, type Order, type Session } from './api'
import { Button, Rule, Spinner, cx } from './ui'
import { problemText, useT } from './words'

/**
 * Sending the order.
 *
 * Both ways through — WhatsApp and straight through the catalogue — go to the same place: the server prices and
 * checks the basket again, writes the order, and takes the bottles off the shelf for it, in one transaction. The
 * difference is only what happens afterwards.
 *
 * For a WhatsApp order the server also writes the message, from the order as recorded rather than from the basket
 * in this browser, and the catalogue opens `wa.me` with it. **Opening WhatsApp is not the message being sent**:
 * the order already exists and its stock is already held, which is exactly why a buyer who never presses send in
 * WhatsApp still shows up in the shop's list rather than vanishing.
 *
 * The same checkout pressed twice carries the same `Idempotency-Key`, so it is one order, not two.
 */
export function Checkout({ token, session, basket, whatsapp, onPlaced, onBack }: {
  token: string
  session: Session
  basket: Record<string, number>
  /** the shop's own WhatsApp number, from the settings the QR menu already uses */
  whatsapp: string
  onPlaced: (order: Order) => void
  onBack: () => void
}) {
  const t = useT()
  const [f, setF] = useState({
    businessName: session.business,
    contactPerson: session.contactPerson,
    phone: '',
    whatsapp: '',
    email: '',
    address: '',
    note: '',
  })
  const [busy, setBusy] = useState<'direct' | 'whatsapp' | null>(null)
  const [problem, setProblem] = useState<{ code: string; params: Record<string, string | number> } | null>(null)
  // one key for this basket: pressing a button twice, or both buttons, must not make two orders
  const [key] = useState(() => `co-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`)

  const set = <K extends keyof typeof f>(k: K, v: string) => setF((x) => ({ ...x, [k]: v }))
  const lines = Object.entries(basket).filter(([, qty]) => qty > 0).map(([variantId, qty]) => ({ variantId, qty }))

  const send = async (method: 'direct' | 'whatsapp') => {
    if (busy || !lines.length) return
    setBusy(method)
    setProblem(null)
    try {
      const out = await placeOrder(token, { lines, method, ...f }, key)

      if (method === 'whatsapp' && out.whatsapp) {
        // the order is already written and its stock already held; this only opens the conversation
        const to = whatsapp.replace(/[^0-9]/g, '')
        window.open(`https://wa.me/${to}?text=${encodeURIComponent(out.whatsapp)}`, '_blank', 'noopener')
        void whatsappOpened(token, out.order.reference).catch(() => undefined)
      }

      onPlaced(out.order)
    } catch (e) {
      const err = e instanceof CatalogueError ? e : new CatalogueError('unknown')
      setProblem({ code: err.code, params: err.params })
    } finally {
      setBusy(null)
    }
  }

  const field = (k: keyof typeof f, label: string, opts: { type?: string; rows?: number; required?: boolean } = {}) => (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-fg-2">{label}</span>
      {opts.rows
        ? <textarea rows={opts.rows} value={f[k]} onChange={(e) => set(k, e.target.value)}
            className="w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm outline-none transition focus:border-gold focus:ring-4 focus:ring-gold/20" />
        : <input type={opts.type ?? 'text'} value={f[k]} onChange={(e) => set(k, e.target.value)} required={opts.required}
            className="h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-sm outline-none transition focus:border-gold focus:ring-4 focus:ring-gold/20" />}
    </label>
  )

  return (
    <div className="grid gap-4">
      <div className="grid gap-3">
        {field('businessName', t('cat.co_business'), { required: true })}
        <div className="grid gap-3 sm:grid-cols-2">
          {field('contactPerson', t('cat.co_contact'))}
          {field('phone', t('cat.co_phone'), { type: 'tel' })}
          {field('whatsapp', t('cat.co_whatsapp'), { type: 'tel' })}
          {field('email', t('cat.co_email'), { type: 'email' })}
        </div>
        {field('address', t('cat.co_address'), { rows: 2 })}
        {field('note', t('cat.co_note'), { rows: 2 })}
      </div>

      {problem && (
        <p role="alert" className="rounded-xl bg-danger-bg px-3 py-2.5 text-sm font-medium text-danger-fg">
          {problemText(t, problem, money)}
        </p>
      )}

      <div className="grid gap-2">
        {whatsapp && (
          <Button full onClick={() => void send('whatsapp')} disabled={!!busy || !f.businessName.trim()}>
            {busy === 'whatsapp' ? <Spinner className="size-4" /> : <><MessageCircle className="size-4" />{t('cat.co_via_whatsapp')}</>}
          </Button>
        )}
        <Button full variant="quiet" onClick={() => void send('direct')} disabled={!!busy || !f.businessName.trim()}>
          {busy === 'direct' ? <Spinner className="size-4" /> : <><Send className="size-4" />{t('cat.co_place')}</>}
        </Button>
        <Button variant="ghost" onClick={onBack}>{t('cat.back')}</Button>
      </div>

      <p className="text-center text-xs leading-relaxed text-fg-2">{t('cat.co_pending_hint')}</p>
    </div>
  )
}

/**
 * What a buyer sees once the order is in.
 *
 * It says plainly that it is waiting for Lattafa to confirm it — an order submitted is not an order fulfilled,
 * and the catalogue should not let anyone believe otherwise.
 */
export function Placed({ order, onDone }: { order: Order; onDone: () => void }) {
  const t = useT()
  return (
    <div className="grid gap-4 py-6 text-center">
      <span className="mx-auto grid size-14 place-items-center rounded-full bg-ok-bg text-ok-fg"><Check className="size-7" /></span>
      <div>
        <p className="font-serif text-2xl">{t('cat.co_thanks')}</p>
        <p className="num mt-1 text-sm text-fg-2">{order.number}</p>
      </div>
      <Rule />
      <dl className="grid gap-1 text-sm">
        <div className="flex justify-between"><dt className="text-fg-2">{t('cat.subtotal')}</dt><dd className="num font-semibold">{money(order.subtotalCents)}</dd></div>
        <div className="flex justify-between"><dt className="text-fg-2">{t('cat.co_reference')}</dt><dd className="num font-semibold">{order.reference}</dd></div>
      </dl>
      <p className={cx('rounded-xl bg-warn-bg px-3 py-2.5 text-sm text-warn-fg')}>{t('cat.co_pending')}</p>
      <Button full onClick={onDone}>{t('cat.co_keep_browsing')}</Button>
    </div>
  )
}
