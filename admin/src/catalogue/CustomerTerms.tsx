import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Percent, Save, Trash2 } from 'lucide-react'
import { Button, IconButton } from '@/components/ui/Button'
import { Badge, Card, EmptyState, Spinner } from '@/components/ui/Controls'
import { Field, Input } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { cn } from '@/components/ui/cn'
import { errorMessage, pick, useT } from '@/i18n'
import { toast } from '@/store/toast'
import { useUI } from '@/store/ui'
import { VariantPicker } from '../purchasing/VariantPicker'
import * as cat from './api'

/**
 * What one business has been promised: a price agreed outright for a size, or a percentage off what the price
 * would otherwise be — **never both** — plus, if there is one, a percentage off its whole order.
 *
 * The figures underneath (what the country charges, what the dollar list says) are not repeated here: this screen
 * is the agreement, and `Prices` is the list.
 */
export function CustomerTerms({ customerId, canEdit }: { customerId: string; canEdit: boolean }) {
  const t = useT()
  const lang = useUI((s) => s.lang)
  const terms = useQuery({ queryKey: ['cat-terms', customerId], queryFn: () => cat.getTerms(customerId) })
  const [edits, setEdits] = useState<Record<string, { price: string; percent: string }>>({})
  const [adding, setAdding] = useState(false)
  /** Sizes just picked, shown with empty boxes — nothing is written until Save, so no $0 price is ever stored. */
  const [fresh, setFresh] = useState<cat.CustomerTerm[]>([])
  const [discount, setDiscount] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (terms.isLoading) return <div className="grid h-60 place-items-center"><Spinner className="size-9" /></div>

  const saved = terms.data?.prices ?? []
  const rows = [...saved, ...fresh.filter((f) => !saved.some((r) => r.variantId === f.variantId))]
  const live = terms.data?.discount ?? null
  const discountText = discount ?? cat.fromBp(live?.percentBp)

  const boxOf = (r: cat.CustomerTerm) => edits[r.variantId] ?? { price: cat.toDollars(r.priceCents), percent: cat.fromBp(r.percentBp) }
  const bothFilled = (v: { price: string; percent: string }) => v.price.trim() !== '' && v.percent.trim() !== ''
  const badRow = (v: { price: string; percent: string }) =>
    bothFilled(v) || (v.price.trim() !== '' && cat.toCents(v.price) === null) || (v.percent.trim() !== '' && cat.toBp(v.percent) === null)

  const changed = Object.entries(edits).filter(([variantId, v]) => {
    const row = rows.find((r) => r.variantId === variantId)
    if (!row) return true
    return v.price !== cat.toDollars(row.priceCents) || v.percent !== cat.fromBp(row.percentBp)
  })

  const saveTerms = async () => {
    if (Object.values(edits).some(badRow)) return toast.error(t('wc.price_or_percent'))
    if (!changed.length) return
    setBusy(true)
    try {
      const body = Object.fromEntries(changed.map(([variantId, v]) => [variantId, {
        priceCents: v.price.trim() === '' ? null : cat.toCents(v.price),
        percentBp: v.percent.trim() === '' ? null : cat.toBp(v.percent),
      }]))
      const n = await cat.saveTerms(customerId, body)
      setEdits({})
      setFresh([])
      await terms.refetch()
      toast.success(t('wc.terms_saved', { n }))
    } catch (e) { toast.error(errorMessage(e, t)) } finally { setBusy(false) }
  }

  const saveDiscount = async () => {
    const text = (discount ?? '').trim()
    const bp = text === '' ? null : cat.toBp(text)
    if (text !== '' && bp === null) return toast.error(t('wc.bad_percent'))
    setBusy(true)
    try {
      await cat.setDiscount(customerId, bp)
      setDiscount(null)
      await terms.refetch()
      toast.success(t('wc.discount_saved'))
    } catch (e) { toast.error(errorMessage(e, t)) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      <Card>
        <h3 className="mb-1 flex items-center gap-2 font-serif text-lg"><Percent className="size-5 text-gold-text" />{t('wc.whole_order_discount')}</h3>
        <p className="mb-3 text-sm text-fg-2">{t('wc.whole_order_hint')}</p>
        <div className="flex flex-wrap items-end gap-2">
          <Field label={t('wc.percent_off')} className="w-40">
            {(id) => (
              <div className="flex items-center gap-1">
                <Input id={id} dir="ltr" inputMode="decimal" disabled={!canEdit}
                  className={cn('num text-end', discountText.trim() !== '' && cat.toBp(discountText) === null && 'ring-2 ring-inset ring-danger')}
                  value={discountText} placeholder="0" onChange={(e) => setDiscount(e.target.value)} />
                <span className="text-fg-2">%</span>
              </div>
            )}
          </Field>
          {canEdit && <Button loading={busy} disabled={discount === null} onClick={() => void saveDiscount()}>{t('common.save')}</Button>}
          {live && <Badge tone="gold">{t('wc.discount_live', { pct: cat.fromBp(live.percentBp) })}</Badge>}
        </div>
      </Card>

      <Card className="flex flex-wrap items-center justify-between gap-2 !py-3">
        <p className="text-sm text-fg-2">{t('wc.agreed_prices_hint')}</p>
        <div className="flex gap-2">
          {canEdit && <Button variant="secondary" onClick={() => setAdding(true)}>{t('wc.add_agreed_price')}</Button>}
          {canEdit && (
            <Button icon={<Save className="size-5" />} loading={busy} disabled={!changed.length} onClick={() => void saveTerms()}>
              {changed.length ? t('wc.save_n', { n: changed.length }) : t('common.save')}
            </Button>
          )}
        </div>
      </Card>

      {!rows.length ? <Card><EmptyState title={t('wc.no_terms')} hint={t('wc.no_terms_hint')} /></Card> : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-surface-2 text-xs text-fg-2">
              <tr>
                <th className="px-3 py-2.5 text-start font-semibold">{t('wc.col_perfume')}</th>
                <th className="w-36 px-3 py-2.5 text-end font-semibold">{t('wc.col_agreed_price')}</th>
                <th className="w-32 px-3 py-2.5 text-end font-semibold">{t('wc.col_percent_off')}</th>
                <th className="w-24 px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const v = boxOf(r)
                const clash = bothFilled(v)
                return (
                  <tr key={r.variantId} className={cn('border-t border-line', clash && 'bg-danger-bg/40')}>
                    <td className="px-3 py-2">
                      <span className="font-medium">{r.name}</span> <span className="num text-xs text-fg-2">{r.label}</span>
                      {!r.inForce && <Badge tone="warn" className="ms-2">{t('wc.out_of_date')}</Badge>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <span className="text-fg-2">$</span>
                        <Input dir="ltr" inputMode="decimal" disabled={!canEdit} aria-label={`${r.name} ${r.label} — ${t('wc.col_agreed_price')}`}
                          className={cn('num !h-10 !w-20 text-end', v.price.trim() !== '' && cat.toCents(v.price) === null && 'ring-2 ring-inset ring-danger')}
                          value={v.price} placeholder="—" onChange={(e) => setEdits((x) => ({ ...x, [r.variantId]: { ...boxOf(r), price: e.target.value } }))} />
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <Input dir="ltr" inputMode="decimal" disabled={!canEdit} aria-label={`${r.name} ${r.label} — ${t('wc.col_percent_off')}`}
                          className={cn('num !h-10 !w-16 text-end', v.percent.trim() !== '' && cat.toBp(v.percent) === null && 'ring-2 ring-inset ring-danger')}
                          value={v.percent} placeholder="—" onChange={(e) => setEdits((x) => ({ ...x, [r.variantId]: { ...boxOf(r), percent: e.target.value } }))} />
                        <span className="text-fg-2">%</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-end">
                      {canEdit && (
                        <IconButton label={t('wc.withdraw')} variant="ghost"
                          onClick={() => setEdits((x) => ({ ...x, [r.variantId]: { price: '', percent: '' } }))}>
                          <Trash2 className="size-4 text-danger-fg" />
                        </IconButton>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-fg-2">{t('wc.terms_hint')}</p>

      {adding && (
        <Modal open onClose={() => setAdding(false)} title={t('wc.add_agreed_price')} footer={<Button variant="secondary" onClick={() => setAdding(false)}>{t('common.close')}</Button>}>
          <div className="min-h-64">
            <p className="mb-3 text-sm text-fg-2">{t('wc.pick_size_hint')}</p>
            <VariantPicker
              onPick={({ product, variant }) => {
                setAdding(false)
                setFresh((x) => x.some((f) => f.variantId === variant.id) ? x : [...x, {
                  variantId: variant.id, name: pick(product.name, lang), sku: variant.sku, label: variant.label,
                  priceCents: null, percentBp: null, validFrom: null, validTo: null, inForce: true,
                }])
              }}
            />
          </div>
        </Modal>
      )}
    </div>
  )
}
