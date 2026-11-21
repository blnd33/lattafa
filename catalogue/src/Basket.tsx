import { useEffect, useState } from 'react'
import { AlertTriangle, Check, Trash2 } from 'lucide-react'
import { CatalogueError, getQuote, money, type Order, type Perfume, type Quote, type Session } from './api'
import { Checkout, Placed } from './Checkout'
import { Button, Drawer, Empty, Quantity, Spinner, cx } from './ui'
import { problemText, useP, useT } from './words'

/**
 * The order so far.
 *
 * Every figure in here comes from the server. The catalogue does not add up prices itself and does not decide
 * whether an order is allowed — it sends the basket to `POST /wholesale/quote` and shows the answer, which is
 * the same check that will run again inside the transaction that creates the order. There is no second opinion
 * to drift out of step with the first.
 *
 * Sending the order is Phase 5. Until then this is an order that is priced, checked and ready, and says so.
 */
export function Basket({ open, token, session, whatsapp, basket, perfumes, onClose, onQty, onClear, onPlaced }: {
  open: boolean
  token: string | null
  session: Session | null
  /** the shop's own WhatsApp number, for a WhatsApp order */
  whatsapp: string
  basket: Record<string, number>
  /** every perfume, so a line can show which bottle it is */
  perfumes: Perfume[]
  onClose: () => void
  onQty: (variantId: string, qty: number) => void
  onClear: () => void
  onPlaced: () => void
}) {
  const t = useT()
  const p1 = useP()
  const [quote, setQuote] = useState<Quote | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  /** 'basket' → 'checkout' → 'placed'; reset every time the drawer is opened afresh */
  const [step, setStep] = useState<'basket' | 'checkout' | 'placed'>('basket')
  const [placed, setPlaced] = useState<Order | null>(null)

  useEffect(() => { if (open) { setStep('basket'); setPlaced(null) } }, [open])

  const lines = Object.entries(basket).filter(([, qty]) => qty > 0)
  const key = lines.map(([id, qty]) => `${id}:${qty}`).join(',')

  // the server prices and checks the basket; the catalogue only shows what it says
  useEffect(() => {
    if (!open || !token || !lines.length) { setQuote(null); return }
    let alive = true
    setBusy(true)
    setFailed(null)
    getQuote(token, lines.map(([variantId, qty]) => ({ variantId, qty })))
      .then((q) => { if (alive) setQuote(q) })
      .catch((e) => { if (alive) setFailed(e instanceof CatalogueError ? e.code : 'unknown') })
      .finally(() => { if (alive) setBusy(false) })
    return () => { alive = false }
  }, [open, token, key]) // eslint-disable-line react-hooks/exhaustive-deps

  const sizeOf = (variantId: string) => {
    for (const p of perfumes) {
      const size = p.sizes.find((s) => s.variantId === variantId)
      if (size) return { perfume: p, size }
    }
    return null
  }

  const money$ = (cents: number) => money(cents)

  const footer = !lines.length ? undefined : (
    <div className="grid gap-3">
      {quote && (
        <>
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-fg-2">{t('cat.subtotal')}</span>
            <span className="num font-serif text-2xl">{money(quote.subtotalCents)}</span>
          </div>
          <p className="num -mt-2 text-xs text-fg-2">{p1('cat.bottles_n', quote.units)}</p>

          {quote.problems.filter((p) => p.code === 'min_order').map((p) => (
            <p key={p.code} className="flex items-start gap-2 rounded-xl bg-warn-bg px-3 py-2 text-xs text-warn-fg">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {problemText(t, p, money$)}
            </p>
          ))}
        </>
      )}

      {quote?.ok && (
        <p className="flex items-center justify-center gap-2 text-sm font-medium text-ok-fg">
          <Check className="size-4" />{t('cat.ready_to_send')}
        </p>
      )}

      <Button full disabled={!quote?.ok} onClick={() => setStep('checkout')}>{t('cat.send_order')}</Button>
    </div>
  )

  // once the order is in, the drawer is the receipt; before that it is the form, then the basket
  if (step === 'placed' && placed) {
    return (
      <Drawer open={open} onClose={onClose} title={t('cat.your_order')}>
        <Placed order={placed} onDone={() => { onClose(); onPlaced() }} />
      </Drawer>
    )
  }

  if (step === 'checkout' && token && session) {
    return (
      <Drawer open={open} onClose={onClose} title={t('cat.co_title')}>
        <Checkout
          token={token}
          session={session}
          basket={basket}
          whatsapp={whatsapp}
          onBack={() => setStep('basket')}
          onPlaced={(order) => { setPlaced(order); setStep('placed'); onClear() }}
        />
      </Drawer>
    )
  }

  return (
    <Drawer open={open} onClose={onClose} title={t('cat.your_order')} footer={footer}>
      {!token ? (
        <Empty title={t('cat.locked_prices')} hint={t('cat.unlock_to_order')} />
      ) : !lines.length ? (
        <Empty title={t('cat.order_empty')} hint={t('cat.order_empty_hint')} />
      ) : (
        <div className="grid gap-4">
          {busy && !quote && <div className="grid place-items-center py-10"><Spinner /></div>}
          {failed && <p role="alert" className="rounded-xl bg-danger-bg px-3 py-2 text-sm text-danger-fg">{t(`cat.err_${failed}`)}</p>}

          <ul className="grid gap-4">
            {lines.map(([variantId, qty]) => {
              const found = sizeOf(variantId)
              const line = quote?.lines.find((l) => l.variantId === variantId)
              return (
                <li key={variantId} className={cx('grid gap-2 border-b border-line pb-4 last:border-0', !!line?.problems.length && 'rounded-xl bg-danger-bg/30 p-3')}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{found?.perfume.name ?? variantId}</p>
                      <p className="num text-xs text-fg-2">{found?.size.label}{line ? ` · ${line.sku}` : ''}</p>
                    </div>
                    <button type="button" onClick={() => onQty(variantId, 0)} aria-label={t('cat.remove')}
                      className="-me-1 grid size-9 shrink-0 place-items-center rounded-full text-fg-2 transition hover:text-danger-fg">
                      <Trash2 className="size-4" />
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Quantity
                      qty={qty}
                      minQty={found?.size.minQty ?? line?.minQty ?? 0}
                      step={found?.size.step ?? line?.step ?? 0}
                      onChange={(n) => onQty(variantId, n)}
                    />
                    {line && line.unitCents !== null && (
                      <span className="num text-sm">
                        <span className="text-fg-2">{money(line.unitCents)} × {line.qty} = </span>
                        <span className="font-semibold">{money(line.lineCents)}</span>
                      </span>
                    )}
                  </div>

                  {line?.problems.map((p, i) => (
                    <p key={i} className="text-xs font-medium text-danger-fg">{problemText(t, p, money$)}</p>
                  ))}
                </li>
              )
            })}
          </ul>

          <Button variant="ghost" onClick={onClear} className="justify-self-start !px-0">{t('cat.clear_order')}</Button>
        </div>
      )}
    </Drawer>
  )
}
