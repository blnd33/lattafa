import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FileUp, Plus, Save, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { EmptyState, Spinner } from '@/components/ui/Controls'
import { Field, Input, SearchInput } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { cn } from '@/components/ui/cn'
import { errorMessage, pick, useT } from '@/i18n'
import { fmt } from '@/lib/money'
import { readXlsx } from '@/lib/xlsx'
import { toast } from '@/store/toast'
import { useUI } from '@/store/ui'
import { addProduct, savePrices, toCents, toDollars, usePrices, type PriceRow } from '../prices'
import { TopBar } from '../ui'

/** The delegate's dollar prices: what he sells each of the shop's perfumes to shops for, plus perfumes he adds himself. */
export function PricesScreen() {
  const t = useT()
  const lang = useUI((s) => s.lang)
  const qc = useQueryClient()
  const q = usePrices()
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const rows = q.data ?? []

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return rows
    return rows.filter((r) => `${r.name.en} ${r.name.ar} ${r.brand} ${r.sku} ${r.label}`.toLowerCase().includes(needle))
  }, [rows, search])

  const valueOf = (r: PriceRow) => edits[r.variantId] ?? toDollars(r.usdCents)
  const bad = Object.values(edits).some((v) => toCents(v) === null)
  const changed = rows.filter((r) => edits[r.variantId] !== undefined && toCents(edits[r.variantId]) !== null && toCents(edits[r.variantId]) !== r.usdCents)

  const save = async () => {
    if (bad) return toast.error(t('dlp.bad_number'))
    setBusy(true)
    try {
      const n = await savePrices(changed.map((r) => ({ variantId: r.variantId, usdCents: toCents(edits[r.variantId])! })))
      setEdits({})
      await qc.invalidateQueries()
      toast.success(t('dlp.saved', { n }))
    } catch (e) { toast.error(errorMessage(e, t)) } finally { setBusy(false) }
  }

  /** An Excel file with a SKU and a dollar price on each line — the sheet from the admin panel goes straight back in. */
  const fromExcel = async (file?: File) => {
    if (!file) return
    setBusy(true)
    try {
      const sheets = await readXlsx(await file.arrayBuffer())
      const bySku = new Map(rows.map((r) => [r.sku.toLowerCase(), r]))
      const next: Record<string, string> = {}
      for (const sheet of sheets) {
        for (const line of sheet.rows) {
          const sku = (line.find((c) => bySku.has(String(c).trim().toLowerCase())) ?? '').trim()
          if (!sku) continue
          const usd = [...line].reverse().find((c) => String(c).trim() !== '' && String(c).trim() !== sku)
          const cents = toCents(String(usd ?? ''))
          if (cents !== null) next[bySku.get(sku.toLowerCase())!.variantId] = toDollars(cents)
        }
      }
      const n = Object.keys(next).length
      if (!n) { toast.error(t('dlp.none_matched')); return }
      setEdits((e) => ({ ...e, ...next }))
      toast.success(t('dlp.loaded', { n, bad: 0 }))
    } catch (e) { toast.error(errorMessage(e, t)) } finally { setBusy(false) }
  }

  return (
    <>
      <TopBar title={t('dl.prices')} subtitle={t('dlp.hint')} />
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap gap-2">
          <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('dlp.search')} className="min-w-44 flex-1" />
          <Button variant="secondary" icon={<Plus className="size-5" />} onClick={() => setAdding(true)}>{t('dl.add_perfume')}</Button>
          <label className="inline-flex">
            <input type="file" hidden accept=".xlsx,.xlsm" onChange={(e) => { void fromExcel(e.target.files?.[0]); e.target.value = '' }} />
            <span className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-surface-2 px-4 text-sm font-semibold"><FileUp className="size-5" />{t('dlp.excel_in')}</span>
          </label>
        </div>

        {q.isLoading ? <Spinner className="mx-auto mt-10 size-8" />
          : q.isError ? <p className="flex items-center justify-center gap-2 py-8 text-sm text-warn-fg"><WifiOff className="size-4" />{t('dl.prices_offline')}</p>
            : shown.length === 0 ? <EmptyState title={t('dlp.none')} />
              : (
                <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
                  {shown.map((r) => {
                    const v = valueOf(r)
                    return (
                      <li key={r.variantId} className="flex items-center gap-3 p-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{pick(r.name, lang)}</p>
                          <p className="num text-xs text-fg-2">{r.label} · {t('dlp.col_retail')} {fmt(r.retailIQD)}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <span className="text-fg-2">$</span>
                          <Input dir="ltr" inputMode="decimal" aria-label={`${pick(r.name, lang)} ${r.label} — ${t('dlp.col_usd')}`}
                            className={cn('num !h-11 !w-24 text-end', toCents(v) === null && 'ring-2 ring-inset ring-danger')}
                            value={v} placeholder="0" onChange={(e) => setEdits((x) => ({ ...x, [r.variantId]: e.target.value }))} />
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
      </div>

      {changed.length > 0 && (
        <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 px-4 pb-2">
          <Button variant="primary" size="lg" block loading={busy} icon={<Save className="size-5" />} onClick={() => void save()}>
            {t('dlp.save_n', { n: changed.length })}
          </Button>
        </div>
      )}

      <AddPerfume open={adding} onClose={() => setAdding(false)} />
    </>
  )
}

/** A perfume the delegate carries that the shop has not entered yet. It joins the shop's list, so its stock is shared. */
function AddPerfume({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [brand, setBrand] = useState('')
  const [size, setSize] = useState('100')
  const [usd, setUsd] = useState('')
  const [stock, setStock] = useState('')
  const [busy, setBusy] = useState(false)
  const cents = toCents(usd)

  const submit = async () => {
    if (name.trim().length < 2) return toast.error(t('dl.add_need_name'))
    if (cents === null || cents <= 0) return toast.error(t('dl.add_need_price'))
    setBusy(true)
    try {
      const isArabic = /[؀-ۿ]/.test(name)
      await addProduct({
        nameEn: isArabic ? '' : name.trim(), nameAr: isArabic ? name.trim() : '', brand: brand.trim(),
        size: Number(size) || 0, unit: 'ml', usdCents: cents, openingStock: Math.max(0, Math.round(Number(stock) || 0)),
      })
      await qc.invalidateQueries()
      toast.success(t('dl.add_done', { name: name.trim() }))
      setName(''); setBrand(''); setUsd(''); setStock(''); setSize('100')
      onClose()
    } catch (e) { toast.error(errorMessage(e, t)) } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('dl.add_perfume')} size="sm">
      <div className="space-y-3">
        <Field label={t('dl.add_name')}>{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="Khamrah" big />}</Field>
        <Field label={t('dl.add_brand')}>{(id) => <Input id={id} value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Lattafa" />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('dl.add_size')}>{(id) => <Input id={id} className="num" dir="ltr" inputMode="decimal" value={size} onChange={(e) => setSize(e.target.value)} placeholder="100" />}</Field>
          <Field label={t('dl.add_price')}>{(id) => <Input id={id} className="num" dir="ltr" inputMode="decimal" value={usd} onChange={(e) => setUsd(e.target.value)} placeholder="20.5" />}</Field>
        </div>
        <Field label={t('dl.add_stock')} hint={t('dl.add_stock_hint')}>{(id) => <Input id={id} className="num" dir="ltr" inputMode="numeric" value={stock} onChange={(e) => setStock(e.target.value)} placeholder="0" />}</Field>
        <Button variant="primary" size="lg" block loading={busy} onClick={() => void submit()}>{t('dl.add_perfume')}</Button>
      </div>
    </Modal>
  )
}
