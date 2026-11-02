import { useEffect, useRef, useState } from 'react'
import { MessageCircle, Snowflake, Sun, SunSnow, X } from 'lucide-react'
import { ProductImage } from '@/components/ui/Brand'
import { cn } from '@/components/ui/cn'
import { fmt } from '@/lib/money'
import { useUI } from '@/store/ui'
import { menuSettings, orderNumber, soldOut, type MenuData, type MenuProduct } from './api'
import { useMenuT } from './i18n'
import { AddSize } from './OrderBar'

/**
 * One perfume, in full: notes pyramid, longevity/sillage, season, sizes with prices, and "Order via WhatsApp"
 * (opens the customer's WhatsApp with the order written out — the shop replies from its own phone).
 */
export function ProductSheet({ product: p, data, onClose }: { product: MenuProduct; data: MenuData; onClose: () => void }) {
  const t = useMenuT()
  const lang = useUI((s) => s.lang)
  const firstAvailable = Math.max(0, p.sizes.findIndex((s) => s.available))
  const [i, setI] = useState(firstAvailable)
  const size = p.sizes[i]
  const closeRef = useRef<HTMLButtonElement>(null)
  const name = p.name[lang] || p.name.en
  const desc = p.description[lang] || p.description.en
  const wa = orderNumber(data)
  const showPrice = menuSettings(data).showPrices && size.priceIQD !== null
  const message = [`${t('wa_hello')} ${name}`, size.label, showPrice ? `${fmt(size.priceIQD ?? 0)} ${t('iqd')}` : null].filter(Boolean).join(' — ')

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; prev?.focus?.() }
  }, [onClose])

  const SeasonIcon = p.season === 'winter' ? Snowflake : p.season === 'summer' ? Sun : SunSnow
  const notes: [string, string[]][] = [[t('top'), p.notes.top], [t('heart'), p.notes.heart], [t('base'), p.notes.base]]

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-6" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-label={name}
        className="relative max-h-[92dvh] w-full max-w-3xl animate-[pop_.22s_ease-out_both] overflow-y-auto rounded-t-3xl border border-line bg-surface pb-safe shadow-2xl sm:rounded-3xl">
        <button ref={closeRef} type="button" onClick={onClose} aria-label={t('close')}
          className="absolute end-3 top-3 z-10 grid size-11 place-items-center rounded-full bg-ink/70 text-fg hover:text-gold-light"><X className="size-5" /></button>

        <div className="grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <ProductImage product={p} className="aspect-[4/5] w-full bg-gradient-to-b from-charcoal to-ink sm:aspect-auto sm:h-full" />

          <div className="space-y-5 p-5 sm:p-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gold">{p.brand} · {p.concentration} · {t(`g_${p.gender}`)}</p>
              <h2 className="mt-1 font-serif text-3xl font-semibold leading-tight">{name}</h2>
              {desc && <p className="mt-3 text-sm leading-relaxed text-fg-2">{desc}</p>}
            </div>

            {notes.some(([, n]) => n.length) && (
              <div>
                <h3 className="mb-2 text-sm font-semibold">{t('notes')}</h3>
                <dl className="space-y-1.5">
                  {notes.filter(([, n]) => n.length).map(([label, n]) => (
                    <div key={label} className="flex flex-wrap items-center gap-1.5">
                      <dt className="w-14 shrink-0 text-xs uppercase tracking-wider text-fg-2">{label}</dt>
                      {n.map((x) => <dd key={x} className="rounded-full border border-line px-2.5 py-0.5 text-xs capitalize">{x}</dd>)}
                    </div>
                  ))}
                </dl>
              </div>
            )}

            <div className="grid grid-cols-3 gap-2 text-center">
              <Meter label={t('longevity')} value={p.longevity} />
              <Meter label={t('sillage')} value={p.sillage} />
              <div className="rounded-2xl bg-surface-2 p-2.5">
                <div className="text-[11px] uppercase tracking-wider text-fg-2">{t('season')}</div>
                <div className="mt-1 flex items-center justify-center gap-1 text-xs font-medium"><SeasonIcon className="size-4 text-gold" />{t(`s_${p.season}`)}</div>
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold">{t('sizes')}</h3>
              <div role="radiogroup" aria-label={t('sizes')} className="flex flex-wrap gap-2">
                {p.sizes.map((s, k) => (
                  <button key={s.id} type="button" role="radio" aria-checked={k === i} onClick={() => setI(k)}
                    className={cn('min-h-11 rounded-2xl border px-4 text-sm font-semibold transition', k === i ? 'border-gold bg-gold/15 text-gold-light' : 'border-line hover:border-gold/60', !s.available && 'opacity-60')}>
                    <span className="num">{s.label}</span>{!s.available && <span className="ms-1.5 text-[11px] font-medium text-fg-2">· {t('sold_out')}</span>}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
              <div>
                {showPrice
                  ? <div className="num font-serif text-3xl font-semibold text-gold-light">{fmt(size.priceIQD ?? 0)} <small className="font-sans text-sm text-fg-2">{t('iqd')}</small></div>
                  : <div className="font-serif text-xl font-semibold text-gold-light">{t('ask_price')}</div>}
                <div className="num text-xs text-fg-2">{size.label}{!size.available && ` · ${t('sold_out')}`}</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {/* put this size in the order the shop is building; WhatsApp stays for a quick question */}
                <AddSize variantId={size.id} disabled={!size.available} />
                {wa && !soldOut(p) && (
                  <a href={`https://wa.me/${wa}?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer"
                    className="inline-flex min-h-12 items-center gap-2 rounded-2xl bg-gradient-to-b from-gold-light to-gold px-5 font-semibold text-ink hover:brightness-105">
                    <MessageCircle className="size-5" />{t('order')}
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-surface-2 p-2.5" aria-label={`${label}: ${value}/5`}>
      <div className="text-[11px] uppercase tracking-wider text-fg-2">{label}</div>
      <div className="mt-1.5 flex justify-center gap-1" aria-hidden>
        {[1, 2, 3, 4, 5].map((n) => <span key={n} className={cn('h-1.5 w-4 rounded-full', n <= value ? 'bg-gold' : 'bg-line')} />)}
      </div>
    </div>
  )
}
