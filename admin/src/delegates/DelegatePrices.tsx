import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileDown, FileUp, Save, Search } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, EmptyState, Spinner } from '@/components/ui/Controls'
import { Input, SearchInput } from '@/components/ui/Field'
import { cn } from '@/components/ui/cn'
import { errorMessage, pick, useT } from '@/i18n'
import { downloadBlob } from '@/lib/image'
import { fmt } from '@/lib/money'
import { trimNum } from '@/lib/size'
import { readXlsx, writeXlsx } from '@/lib/xlsx'
import { api } from '@/services/api'
import { toast } from '@/store/toast'
import { useUI } from '@/store/ui'

interface PriceRow { variantId: string; sku: string; name: Record<'en' | 'ar' | 'ku', string>; brand: string; label: string; retailIQD: number; usdCents: number }

const toCents = (text: string): number | null => {
  const s = text.replace(/[\s$,٬]/g, '').replace('٫', '.')
  if (!s) return 0
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null
  return Math.round(Number(s) * 100)
}
const toDollars = (cents: number) => (cents ? trimNum(cents / 100) : '')

/**
 * The delegate's dollar price list: the shop's own perfumes (one list, one stock) priced for shops in dollars.
 * Set here and nowhere else — the till never touches these, and the shop's dinar prices never move.
 */
export function DelegatePrices() {
  const t = useT()
  const lang = useUI((s) => s.lang)
  const q = useQuery({ queryKey: ['delegate-prices'], queryFn: () => api<{ prices: PriceRow[] }>('GET', '/delegate-prices') })
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const rows = q.data?.prices ?? []

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return rows
    return rows.filter((r) => `${r.name.en} ${r.name.ar} ${r.name.ku} ${r.brand} ${r.sku} ${r.label}`.toLowerCase().includes(needle))
  }, [rows, search])

  const valueOf = (r: PriceRow) => edits[r.variantId] ?? toDollars(r.usdCents)
  const badCells = Object.entries(edits).filter(([, v]) => toCents(v) === null).map(([id]) => id)
  const changed = rows.filter((r) => edits[r.variantId] !== undefined && toCents(edits[r.variantId]) !== null && toCents(edits[r.variantId]) !== r.usdCents)

  const save = async () => {
    if (badCells.length) return toast.error(t('dlp.bad_number'))
    if (!changed.length) return
    setBusy(true)
    try {
      const prices = changed.map((r) => ({ variantId: r.variantId, usdCents: toCents(edits[r.variantId])! }))
      const { changed: n } = await api<{ changed: number }>('PUT', '/delegate-prices', { prices })
      setEdits({})
      await q.refetch()
      toast.success(t('dlp.saved', { n }))
    } catch (e) { toast.error(errorMessage(e, t)) } finally { setBusy(false) }
  }

  const toExcel = async () => {
    const header = [t('dlp.col_name'), t('dlp.col_size'), t('sheet.col_sku'), t('dlp.col_retail'), t('dlp.col_usd')]
    const body = rows.map((r) => [pick(r.name, lang), r.label, r.sku, r.retailIQD, r.usdCents ? r.usdCents / 100 : ''])
    const blob = await writeXlsx([{
      name: t('dlp.file'), rtl: lang !== 'en', rows: [header, ...body],
      columns: [{ width: 30 }, { width: 12 }, { width: 24, text: true }, { width: 16, number: true }, { width: 16 }],
    }])
    downloadBlob(`lattafa-delegate-prices-${new Date().toISOString().slice(0, 10)}.xlsx`, blob)
  }

  /** Read back the file we gave out: matched by SKU, only the dollar column is taken. */
  const fromExcel = async (file?: File) => {
    if (!file) return
    setBusy(true)
    try {
      const sheets = await readXlsx(await file.arrayBuffer())
      const bySku = new Map(rows.map((r) => [r.sku.toLowerCase(), r]))
      const next: Record<string, string> = {}
      let unknown = 0
      for (const sheet of sheets) {
        for (const line of sheet.rows) {
          const sku = (line.find((c) => bySku.has(String(c).trim().toLowerCase())) ?? '').trim()
          if (!sku) continue
          const r = bySku.get(sku.toLowerCase())!
          // the dollar price is the last filled cell on the line; a blank one means "leave it alone"
          const usd = [...line].reverse().find((c) => String(c).trim() !== '' && String(c).trim() !== sku)
          const cents = toCents(String(usd ?? ''))
          if (cents === null) { unknown++; continue }
          next[r.variantId] = toDollars(cents)
        }
      }
      const n = Object.keys(next).length
      if (!n) { toast.error(t('dlp.none_matched')); return }
      setEdits((e) => ({ ...e, ...next }))
      toast.success(t('dlp.loaded', { n, bad: unknown }))
    } catch (e) { toast.error(errorMessage(e, t)) } finally { setBusy(false) }
  }

  if (q.isLoading) return <div className="grid h-60 place-items-center"><Spinner className="size-9" /></div>
  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-2 !py-3">
        <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('dlp.search')} className="min-w-52 flex-1" />
        <Button variant="secondary" icon={<FileDown className="size-5" />} onClick={() => void toExcel()}>{t('dlp.excel_out')}</Button>
        <label className="inline-flex">
          <input type="file" hidden accept=".xlsx,.xlsm" onChange={(e) => { void fromExcel(e.target.files?.[0]); e.target.value = '' }} />
          <span className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-surface-2 px-4 text-sm font-semibold"><FileUp className="size-5" />{t('dlp.excel_in')}</span>
        </label>
        <Button variant="primary" icon={<Save className="size-5" />} loading={busy} disabled={!changed.length} onClick={() => void save()}>
          {changed.length ? t('dlp.save_n', { n: changed.length }) : t('dlp.save')}
        </Button>
      </Card>

      {shown.length === 0 ? <Card><EmptyState title={t('dlp.none')} hint={search ? undefined : t('dlp.none_hint')} /></Card> : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-surface-2 text-xs text-fg-2">
              <tr>
                <th className="px-3 py-2.5 text-start font-semibold">{t('dlp.col_name')}</th>
                <th className="px-3 py-2.5 text-start font-semibold">{t('dlp.col_size')}</th>
                <th className="px-3 py-2.5 text-end font-semibold">{t('dlp.col_retail')}</th>
                <th className="w-40 px-3 py-2.5 text-end font-semibold text-gold-text">{t('dlp.col_usd')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const v = valueOf(r)
                const bad = toCents(v) === null
                return (
                  <tr key={r.variantId} className="border-t border-line">
                    <td className="px-3 py-2"><span className="font-medium">{pick(r.name, lang)}</span> <span className="text-xs text-fg-2">{r.brand}</span></td>
                    <td className="num px-3 py-2 text-fg-2">{r.label}</td>
                    <td className="num px-3 py-2 text-end text-fg-2">{fmt(r.retailIQD)}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <span className="text-fg-2">$</span>
                        <Input dir="ltr" inputMode="decimal" aria-label={`${pick(r.name, lang)} ${r.label} — ${t('dlp.col_usd')}`}
                          className={cn('num !h-10 !w-24 text-end', bad && 'ring-2 ring-inset ring-danger')}
                          value={v} placeholder="0" onChange={(e) => setEdits((x) => ({ ...x, [r.variantId]: e.target.value }))} />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="flex items-start gap-2 text-xs text-fg-2"><Search className="mt-0.5 size-3.5 shrink-0" />{t('dlp.hint')}</p>
    </div>
  )
}
