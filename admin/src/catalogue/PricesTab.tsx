import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileDown, FileUp, History, Save } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Badge, Card, EmptyState, Spinner } from '@/components/ui/Controls'
import { Input, SearchInput, Select } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { cn } from '@/components/ui/cn'
import { errorMessage, useT } from '@/i18n'
import { downloadBlob } from '@/lib/image'
import { readXlsx, writeXlsx } from '@/lib/xlsx'
import { toast } from '@/store/toast'
import { useUI } from '@/store/ui'
import * as cat from './api'

/**
 * One country's wholesale prices, as a grid.
 *
 * The delegate's dollar list is shown beside each box, because that is what the size falls back to when this
 * country has no price of its own — so an empty box is a decision, not an oversight. Clearing a box takes the
 * country's price away and hands the size back to the list.
 *
 * Excel out and back in, matched by SKU, for a shop that would rather price a hundred perfumes in a spreadsheet.
 */
export function PricesTab() {
  const t = useT()
  const lang = useUI((s) => s.lang)
  const countries = useQuery({ queryKey: ['cat-countries'], queryFn: cat.getCountries })
  const [countryId, setCountryId] = useState('')
  const [search, setSearch] = useState('')
  const [missingOnly, setMissingOnly] = useState(false)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState(false)

  const chosen = countryId || countries.data?.[0]?.id || ''
  const country = countries.data?.find((c) => c.id === chosen)
  const prices = useQuery({ queryKey: ['cat-prices', chosen], queryFn: () => cat.getCountryPrices(chosen), enabled: !!chosen })

  const rows = prices.data ?? []
  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return rows.filter((r) => {
      // "missing" means a size nobody could order: no price here and none on the dollar list either
      if (missingOnly) {
        const typed = edits[r.variantId] ?? cat.toDollars(r.priceCents)
        const cents = typed.trim() === '' ? null : cat.toCents(typed)
        if ((cents ?? (r.listCents || null)) !== null) return false
      }
      if (!needle) return true
      return `${r.name} ${r.brand} ${r.sku} ${r.label}`.toLowerCase().includes(needle)
    })
  }, [rows, search, missingOnly, edits])

  const valueOf = (r: cat.PriceRow) => edits[r.variantId] ?? cat.toDollars(r.priceCents)
  const bad = Object.entries(edits).filter(([, v]) => v.trim() !== '' && cat.toCents(v) === null)
  const changed = rows.filter((r) => {
    const typed = edits[r.variantId]
    if (typed === undefined) return false
    const now = typed.trim() === '' ? null : cat.toCents(typed)
    return now !== r.priceCents
  })

  const save = async () => {
    if (bad.length) return toast.error(t('wc.bad_number'))
    if (!changed.length) return
    setBusy(true)
    try {
      const body = Object.fromEntries(changed.map((r) => {
        const typed = edits[r.variantId]!
        return [r.variantId, typed.trim() === '' ? null : cat.toCents(typed)]
      }))
      const n = await cat.saveCountryPrices(chosen, body)
      setEdits({})
      await prices.refetch()
      toast.success(t('wc.prices_saved', { n }))
    } catch (e) { toast.error(errorMessage(e, t)) } finally { setBusy(false) }
  }

  const toExcel = async () => {
    const header = [t('wc.col_perfume'), t('wc.col_size'), t('sheet.col_sku'), t('wc.col_list'), t('wc.col_country_price')]
    const body = rows.map((r) => [r.name, r.label, r.sku, r.listCents ? r.listCents / 100 : '', r.priceCents !== null ? r.priceCents / 100 : ''])
    const blob = await writeXlsx([{
      name: country?.iso2 ?? 'prices',
      rtl: lang !== 'en',
      rows: [header, ...body],
      columns: [{ width: 30 }, { width: 12 }, { width: 24, text: true }, { width: 14 }, { width: 16 }],
    }])
    downloadBlob(`lattafa-wholesale-${(country?.iso2 ?? 'prices').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.xlsx`, blob)
  }

  /** Read back the file we gave out: matched by SKU, and only the last money column — this country's price. */
  const fromExcel = async (file?: File) => {
    if (!file) return
    setBusy(true)
    try {
      const sheets = await readXlsx(await file.arrayBuffer())
      const bySku = new Map(rows.map((r) => [r.sku.toLowerCase(), r]))
      const next: Record<string, string> = {}
      let unmatched = 0
      for (const sheet of sheets) {
        for (const line of sheet.rows) {
          const cells = line.map((c) => String(c).trim())
          const at = cells.findIndex((c) => bySku.has(c.toLowerCase()))
          if (at < 0) continue
          const r = bySku.get(cells[at]!.toLowerCase())!
          const money = cells.slice(at + 1).filter((c) => c !== '' && cat.toCents(c) !== null)
          const price = money.at(-1)
          if (price === undefined) { unmatched++; continue }
          next[r.variantId] = cat.toDollars(cat.toCents(price))
        }
      }
      const n = Object.keys(next).length
      if (!n) return toast.error(t('wc.none_matched'))
      setEdits((e) => ({ ...e, ...next }))
      toast.success(t('wc.loaded_n', { n, bad: unmatched }))
    } catch (e) { toast.error(errorMessage(e, t)) } finally { setBusy(false) }
  }

  if (countries.isLoading) return <div className="grid h-60 place-items-center"><Spinner className="size-9" /></div>
  if (!countries.data?.length) return <Card><EmptyState title={t('wc.no_countries')} hint={t('wc.no_countries_hint')} /></Card>

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-2 !py-3">
        <Select value={chosen} onChange={(e) => { setCountryId(e.target.value); setEdits({}) }} aria-label={t('wc.country')} className="!w-auto min-w-40">
          {countries.data.map((c) => <option key={c.id} value={c.id}>{c.name.en || c.iso2}</option>)}
        </Select>
        <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('wc.search_perfumes')} className="min-w-48 flex-1" />
        <Button variant={missingOnly ? 'primary' : 'secondary'} onClick={() => setMissingOnly((x) => !x)}>{t('wc.missing_prices')}</Button>
        <Button variant="secondary" icon={<FileDown className="size-5" />} onClick={() => void toExcel()}>{t('wc.excel_out')}</Button>
        <label className="inline-flex">
          <input type="file" hidden accept=".xlsx,.xlsm" onChange={(e) => { void fromExcel(e.target.files?.[0]); e.target.value = '' }} />
          <span className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-surface-2 px-4 text-sm font-semibold"><FileUp className="size-5" />{t('wc.excel_in')}</span>
        </label>
        <Button variant="secondary" icon={<History className="size-5" />} onClick={() => setHistory(true)}>{t('wc.history')}</Button>
        <Button icon={<Save className="size-5" />} loading={busy} disabled={!changed.length} onClick={() => void save()}>
          {changed.length ? t('wc.save_n', { n: changed.length }) : t('common.save')}
        </Button>
      </Card>

      {prices.isLoading ? <div className="grid h-60 place-items-center"><Spinner className="size-9" /></div>
        : !shown.length ? <Card><EmptyState title={t('wc.no_perfumes')} hint={missingOnly ? t('wc.nothing_missing_price') : undefined} /></Card> : (
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full min-w-[46rem] text-sm">
              <thead className="bg-surface-2 text-xs text-fg-2">
                <tr>
                  <th className="px-3 py-2.5 text-start font-semibold">{t('wc.col_perfume')}</th>
                  <th className="px-3 py-2.5 text-start font-semibold">{t('wc.col_size')}</th>
                  <th className="px-3 py-2.5 text-end font-semibold">{t('wc.col_list')}</th>
                  <th className="w-36 px-3 py-2.5 text-end font-semibold text-gold-text">{t('wc.col_country_price')}</th>
                  <th className="w-28 px-3 py-2.5 text-end font-semibold">{t('wc.col_they_pay')}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const value = valueOf(r)
                  const cents = value.trim() === '' ? null : cat.toCents(value)
                  const effective = cents ?? (r.listCents || null)
                  return (
                    <tr key={r.variantId} className="border-t border-line">
                      <td className="px-3 py-2">
                        <span className="font-medium">{r.name}</span> <span className="text-xs text-fg-2">{r.brand}</span>
                      </td>
                      <td className="num px-3 py-2 text-fg-2">{r.label}</td>
                      <td className="num px-3 py-2 text-end text-fg-2">{r.listCents ? `$${r.listCents / 100}` : '—'}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <span className="text-fg-2">$</span>
                          <Input dir="ltr" inputMode="decimal" aria-label={`${r.name} ${r.label} — ${t('wc.col_country_price')}`}
                            className={cn('num !h-10 !w-20 text-end', value.trim() !== '' && cents === null && 'ring-2 ring-inset ring-danger')}
                            value={value} placeholder={r.listCents ? String(r.listCents / 100) : '—'}
                            onChange={(e) => setEdits((x) => ({ ...x, [r.variantId]: e.target.value }))} />
                        </div>
                      </td>
                      <td className="num px-3 py-2 text-end">
                        {effective === null ? <Badge tone="warn">{t('wc.no_price')}</Badge> : <span className="font-semibold">${effective / 100}</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      <p className="text-xs text-fg-2">{t('wc.prices_hint')}</p>

      {history && <PriceHistory countryId={chosen} onClose={() => setHistory(false)} />}
    </div>
  )
}

function PriceHistory({ countryId, onClose }: { countryId: string; onClose: () => void }) {
  const t = useT()
  const q = useQuery({ queryKey: ['cat-price-history', countryId], queryFn: () => cat.getPriceHistory({ scope: 'country', scopeId: countryId, limit: 200 }) })
  const money = (c: number | null) => (c === null ? t('wc.none') : `$${c / 100}`)

  return (
    <Modal open onClose={onClose} title={t('wc.history')} size="lg" footer={<Button variant="secondary" onClick={onClose}>{t('common.close')}</Button>}>
      {q.isLoading ? <div className="grid h-40 place-items-center"><Spinner className="size-8" /></div>
        : !q.data?.length ? <EmptyState title={t('wc.no_history')} />
          : (
            <ul className="divide-y divide-line text-sm">
              {q.data.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="num text-xs text-fg-2">{new Date(h.at).toLocaleString()}</span>
                  <span className="num">{money(h.fromCents)} → <strong>{money(h.toCents)}</strong></span>
                  <span className="ms-auto text-xs text-fg-2">{h.byName}</span>
                </li>
              ))}
            </ul>
          )}
    </Modal>
  )
}
