import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PackageMinus, PackagePlus, Trash2, Truck } from 'lucide-react'
import { Button, IconButton } from '@/components/ui/Button'
import { Card, EmptyState, Spinner, Switch } from '@/components/ui/Controls'
import { Input } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { cn } from '@/components/ui/cn'
import { errorMessage, pick, useT } from '@/i18n'
import { fmt } from '@/lib/money'
import { api } from '@/services/api'
import { toast } from '@/store/toast'
import { useUI } from '@/store/ui'
import { VariantPicker, type Picked } from '../purchasing/VariantPicker'

/**
 * One delegate's own stock, and the two ways it changes.
 *
 * A delegate's stock is separate from the shop's (the owner's decision, 28 November): **Add stock** puts bottles in
 * his stock and never touches the shop's shelf; **Remove stock** takes them off his stock, and only puts them back on
 * the shelf when ticked (he handed them in). Every line is a stock movement, so his history explains every bottle.
 * The server refuses to take off more than he holds (`insufficient_stock`).
 */
export function VanTab({ delegateId }: { delegateId: string }) {
  const t = useT()
  const lang = useUI((s) => s.lang)
  const qc = useQueryClient()
  const [moving, setMoving] = useState<'load' | 'unload' | null>(null)
  // every perfume on sale, the ones he does not carry at 0 — or only what he carries
  const [showAll, setShowAll] = useState(false)

  const van = useQuery({
    queryKey: ['van', delegateId, showAll],
    queryFn: () => api<{ items: VanRow[] }>('GET', `/delegates/${delegateId}/van${showAll ? '?all=1' : ''}`).then((r) => r.items),
  })

  if (van.isLoading) return <div className="grid h-40 place-items-center"><Spinner className="size-8" /></div>

  const rows = van.data ?? []
  const carried = rows.filter((r) => r.qty !== 0)
  const units = rows.reduce((n, r) => n + r.qty, 0)
  const worth = rows.reduce((n, r) => n + r.qty * r.wholesaleIQD, 0)

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3 !py-3">
        <div className="flex items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-gold-soft text-gold-text dark:bg-gold/15"><Truck className="size-5" /></span>
          <div>
            <p className="num font-semibold">{t('dlg.van_units', { n: units })}</p>
            <p className="num text-xs text-fg-2">{t('dlg.van_value')} · {fmt(worth)}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button icon={<PackagePlus className="size-5" />} onClick={() => setMoving('load')}>{t('dlg.load')}</Button>
          <Button variant="secondary" icon={<PackageMinus className="size-5" />} disabled={!carried.length} onClick={() => setMoving('unload')}>{t('dlg.unload')}</Button>
        </div>
      </Card>

      <label className="flex w-fit items-center gap-2.5 text-sm font-medium">
        <Switch checked={showAll} onChange={setShowAll} label={t('dlg.show_all')} />{t('dlg.show_all')}
      </label>

      {!rows.length ? <Card><EmptyState title={t('dlg.van_empty')} hint={t('dlg.van_empty_hint')} /></Card> : (
        <Card pad={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-start text-xs text-fg-2">
                <tr>
                  <th className="px-3 py-2.5 text-start font-semibold">{t('dlg.van_item')}</th>
                  <th className="px-3 py-2.5 text-start font-semibold">{t('dlg.van_size')}</th>
                  <th className="px-3 py-2.5 text-end font-semibold">{t('dlg.van_qty')}</th>
                  <th className="px-3 py-2.5 text-end font-semibold">{t('dlg.van_price')}</th>
                  <th className="px-3 py-2.5 text-start font-semibold">{t('dlg.van_stocked_by')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.variantId} className={cn(r.qty === 0 && 'text-fg-2')}>
                    <td className="px-3 py-2.5">
                      <p className="font-medium">{pick(r.name, lang)}</p>
                      <p className="text-xs text-fg-2">{r.brand}</p>
                    </td>
                    <td className="num px-3 py-2.5 text-fg-2">{r.label}</td>
                    <td className={cn('num px-3 py-2.5 text-end', r.qty !== 0 && 'font-semibold', r.qty < 0 && 'text-danger-fg')}>{r.qty}</td>
                    <td className="num px-3 py-2.5 text-end">
                      {r.ownCents != null
                        ? <span className="font-semibold text-gold-text">${(r.ownCents / 100).toFixed(2)}</span>
                        : <span className="text-fg-2">{r.shopCents > 0 ? `$${(r.shopCents / 100).toFixed(2)}` : '—'}</span>}
                      <span className="block text-[11px] text-fg-2">{t(r.ownCents != null ? 'dlg.van_his_price' : 'dlg.van_shop_price')}</span>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-fg-2">
                      {r.lastAddedBy ?? '—'}
                      {r.lastAddedByThem && <span className="block text-warn-fg">{t('dlg.van_he_added')}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {moving && (
        <MoveStock
          delegateId={delegateId}
          kind={moving}
          inVan={carried}
          onClose={() => setMoving(null)}
          onDone={() => { setMoving(null); void qc.invalidateQueries({ queryKey: ['van', delegateId] }) }}
        />
      )}
    </div>
  )
}

export interface VanRow {
  variantId: string
  productId: string
  name: Record<'en' | 'ar' | 'ku', string>
  brand: string
  label: string
  sku: string
  qty: number
  wholesaleIQD: number
  retailIQD: number
  /** his own selling price in US cents, or null when he follows the shop's dollar list */
  ownCents: number | null
  shopCents: number
  /** who last put stock in — a delegate can stock his own van, so this is worth seeing */
  lastAddedBy: string | null
  lastAddedByThem: boolean
}

/** Into his stock, or out of it. The same sheet both ways; only the direction and what it offers differ. */
function MoveStock({ delegateId, kind, inVan, onClose, onDone }: {
  delegateId: string
  kind: 'load' | 'unload'
  inVan: VanRow[]
  onClose: () => void
  onDone: () => void
}) {
  const t = useT()
  const lang = useUI((s) => s.lang)
  const [lines, setLines] = useState<{ variantId: string; name: string; label: string; qty: number; max: number | null }[]>([])
  const [note, setNote] = useState('')
  // removing: whether the bottles go back on the shop's shelf (he handed them in) or only come off his stock
  const [toShop, setToShop] = useState(false)
  const [busy, setBusy] = useState(false)

  const add = (variantId: string, name: string, label: string, max: number | null) => {
    setLines((xs) => (xs.some((l) => l.variantId === variantId) ? xs : [...xs, { variantId, name, label, qty: 1, max }]))
  }

  const send = async () => {
    const items = lines.filter((l) => l.qty > 0).map((l) => ({ variantId: l.variantId, qty: l.qty }))
    if (!items.length) return
    setBusy(true)
    try {
      const out = await api<{ units: number }>('POST', `/delegates/${delegateId}/${kind}`, kind === 'unload' ? { items, note, toShop } : { items, note })
      toast.success(t(kind === 'load' ? 'dlg.loaded' : toShop ? 'dlg.unloaded_to_shop' : 'dlg.unloaded', { n: out.units }))
      onDone()
    } catch (e) { toast.error(errorMessage(e, t)) } finally { setBusy(false) }
  }

  const units = lines.reduce((n, l) => n + (l.qty > 0 ? l.qty : 0), 0)

  return (
    // wide, and tall enough that the search results open in full instead of being cut off after two or three
    <Modal open onClose={onClose} size="xl" bodyClassName="min-h-[min(62dvh,560px)]" title={t(kind === 'load' ? 'dlg.load_title' : 'dlg.unload_title')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
      <Button loading={busy} disabled={!units} onClick={() => void send()}>{t(kind === 'load' ? 'dlg.load_n' : 'dlg.unload_n', { n: units })}</Button>
    </>}>
      <div className="space-y-3">
        <p className="text-sm text-fg-2">{t(kind === 'load' ? 'dlg.load_hint' : 'dlg.unload_hint')}</p>

        {kind === 'load'
          // adding can reach for any perfume the shop sells, so it uses the same finder as a purchase order; the shop's
          // own count is not a limit, because his stock is his own
          ? <VariantPicker tall onPick={(p: Picked) => add(p.variant.id, pick(p.product.name, lang), p.variant.label, null)} />
          : (
            <ul className="max-h-[min(40dvh,360px)] divide-y divide-line overflow-y-auto rounded-xl border border-line">
              {inVan.map((r) => (
                <li key={r.variantId}>
                  <button type="button" onClick={() => add(r.variantId, pick(r.name, lang), r.label, r.qty)}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-start text-sm transition hover:bg-surface-2">
                    <span className="min-w-0 flex-1 truncate">{pick(r.name, lang)}</span>
                    <span className="num text-xs text-fg-2">{r.label}</span>
                    <span className="num text-xs font-semibold">{r.qty}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

        {lines.length > 0 && (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {lines.map((l, i) => (
              <li key={l.variantId} className="flex items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{l.name}</span>
                  <span className="num block text-xs text-fg-2">
                    {l.label}{l.max !== null && ` · ${t('dlg.in_van', { n: l.max })}`}
                  </span>
                </span>
                <Input type="number" inputMode="numeric" min={1} value={String(l.qty)} aria-label={t('dlg.van_qty')} className="!w-24"
                  onChange={(e) => setLines((xs) => xs.map((x, j) => (j === i ? { ...x, qty: Math.max(0, Number(e.target.value) || 0) } : x)))} />
                <IconButton label={t('common.remove')} variant="ghost" onClick={() => setLines((xs) => xs.filter((_, j) => j !== i))}>
                  <Trash2 className="size-4 text-danger-fg" />
                </IconButton>
              </li>
            ))}
          </ul>
        )}

        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('dlg.move_note')} aria-label={t('dlg.move_note')} />
        {kind === 'unload' && (
          <label className="flex items-start gap-3 rounded-xl bg-surface-2 p-3 text-sm">
            <Switch checked={toShop} onChange={setToShop} label={t('dlg.to_shop')} />
            <span>{t('dlg.to_shop')}</span>
          </label>
        )}
      </div>
    </Modal>
  )
}
