import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, FileSpreadsheet, FileUp, Printer } from 'lucide-react'
import { Barcode } from '@/components/ui/Brand'
import { Button } from '@/components/ui/Button'
import { Segmented, Switch } from '@/components/ui/Controls'
import { Field, Input, Select } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { usePrint } from '@/components/PrintHost'
import { pick, useT } from '@/i18n'
import { fmt, parseAmount } from '@/lib/money'
import { downloadText } from '@/lib/image'
import type { CatalogItem } from '@/services/catalog'
import { bulkPriceUpdate } from '@/services/catalog'
import { csvTemplate, importCatalog, previewImport, type ImportPreview } from '@/services/csv'
import { useAction } from '@/hooks/queries'
import { useUI } from '@/store/ui'
import { toast } from '@/store/toast'

/* ───────── barcode labels ───────── */

const SIZES = { '50x30': [50, 30], '40x25': [40, 25], '58x40': [58, 40] } as const
type SizeKey = keyof typeof SIZES

export function LabelModal({ open, onClose, items }: { open: boolean; onClose: () => void; items: CatalogItem[] }) {
  const t = useT()
  const lang = useUI((s) => s.lang)
  const [size, setSize] = useState<SizeKey>('50x30')
  const [copies, setCopies] = useState('1')
  const [showPrice, setShowPrice] = useState(true)
  const [showName, setShowName] = useState(true)
  const rows = useMemo(() => items.flatMap((c) => c.variants.map((v) => ({ product: c.product, variant: v }))), [items])
  const [w, h] = SIZES[size]
  const n = Math.max(1, Math.min(50, Math.round(parseAmount(copies)) || 1))

  const label = (r: (typeof rows)[number], key: string) => (
    <div key={key} style={{ width: `${w}mm`, height: `${h}mm`, breakAfter: 'page', overflow: 'hidden', padding: '1.2mm 2mm', boxSizing: 'border-box' }} className="flex flex-col items-center justify-between bg-white text-center text-black">
      {showName && <div className="w-full truncate text-[8px] font-bold leading-tight">{r.product.brand} · {pick(r.product.name, lang)}</div>}
      <Barcode value={r.variant.barcode} height={h * 0.9 > 26 ? 26 : Math.round(h * 0.85)} className="w-full" />
      <div className="flex w-full justify-between text-[8px] font-semibold leading-none"><span>{r.variant.label}</span>{showPrice && <span className="num">{fmt(r.variant.retailIQD)}</span>}</div>
    </div>
  )
  const doPrint = () => {
    const node = <>{rows.flatMap((r) => Array.from({ length: n }, (_, i) => label(r, `${r.variant.id}-${i}`)))}</>
    usePrint.getState().print(node, 'label', { w, h })
  }
  return (
    <Modal open={open} onClose={onClose} title={t('prod.labels')} size="lg" footer={<Button size="lg" variant="primary" block icon={<Printer className="size-5" />} disabled={!rows.length} onClick={doPrint}>{t('prod.print_labels', { n: rows.length * n })}</Button>}>
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t('prod.label_size')}>{(i) => <Select id={i} value={size} onChange={(e) => setSize(e.target.value as SizeKey)}>{(Object.keys(SIZES) as SizeKey[]).map((k) => <option key={k} value={k}>{k.replace('x', ' × ')} mm</option>)}</Select>}</Field>
          <Field label={t('prod.label_copies')}>{(i) => <Input id={i} inputMode="numeric" className="num" value={copies} onChange={(e) => setCopies(e.target.value.replace(/\D/g, ''))} />}</Field>
          <div className="flex flex-col justify-end gap-2 pb-1 text-sm">
            <label className="flex items-center justify-between gap-2">{t('prod.label_name')}<Switch checked={showName} onChange={setShowName} label={t('prod.label_name')} /></label>
            <label className="flex items-center justify-between gap-2">{t('prod.label_price')}<Switch checked={showPrice} onChange={setShowPrice} label={t('prod.label_price')} /></label>
          </div>
        </div>
        <div>
          <div className="mb-2 text-xs font-medium text-fg-2">{t('prod.preview')}</div>
          <div className="flex flex-wrap gap-3 rounded-2xl bg-surface-2 p-4">
            {rows.slice(0, 6).map((r) => <div key={r.variant.id} className="shadow-soft" style={{ transform: 'scale(1.6)', transformOrigin: 'top start', marginBottom: `${h * 0.6 * 3.78}px`, marginInlineEnd: `${w * 0.6 * 3.78}px` }}>{label(r, r.variant.id)}</div>)}
          </div>
          {rows.length > 6 && <p className="mt-2 text-xs text-fg-2">+{rows.length - 6}</p>}
        </div>
      </div>
    </Modal>
  )
}

/* ───────── bulk price update ───────── */

export function BulkPriceModal({ open, onClose, productIds }: { open: boolean; onClose: () => void; productIds?: string[] }) {
  const t = useT()
  const [mode, setMode] = useState<'pct' | 'fixed'>('pct')
  const [target, setTarget] = useState<'retail' | 'wholesale' | 'both'>('retail')
  const [value, setValue] = useState('')
  const [sign, setSign] = useState<1 | -1>(1)
  const run = useAction(bulkPriceUpdate)
  const submit = async () => {
    const n = await run({ mode, value: sign * parseAmount(value), target, productIds })
    if (n !== undefined) { toast.success(t('prod.bulk_done', { n })); onClose(); setValue('') }
  }
  return (
    <Modal open={open} onClose={onClose} title={t('prod.bulk_price')} size="sm" footer={<Button size="lg" variant="primary" block loading={run.busy} disabled={!(parseAmount(value) > 0)} onClick={submit}>{t('common.apply')}</Button>}>
      <div className="space-y-4">
        <p className="text-sm text-fg-2">{productIds ? t('prod.bulk_selected', { n: productIds.length }) : t('prod.bulk_all')}</p>
        <Segmented value={sign} onChange={setSign} options={[{ value: 1, label: t('prod.increase') }, { value: -1, label: t('prod.decrease') }]} className="w-full [&>button]:flex-1" />
        <Segmented value={mode} onChange={setMode} options={[{ value: 'pct', label: '%' }, { value: 'fixed', label: t('unit.iqd') }]} className="w-full [&>button]:flex-1" />
        <Field label={t('prod.bulk_value')}>{(i) => <Input id={i} big inputMode="decimal" className="num" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ''))} data-autofocus />}</Field>
        <Field label={t('prod.bulk_target')}>{(i) => <Select id={i} value={target} onChange={(e) => setTarget(e.target.value as typeof target)}><option value="retail">{t('prod.retail')}</option><option value="wholesale">{t('prod.wholesale')}</option><option value="both">{t('prod.both')}</option></Select>}</Field>
        <p className="rounded-xl bg-surface-2 p-3 text-xs text-fg-2">{t('prod.bulk_round')}</p>
      </div>
    </Modal>
  )
}

/* ───────── CSV import ───────── */

export function ImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT()
  const [prev, setPrev] = useState<ImportPreview | null>(null)
  const navigate = useNavigate()
  const run = useAction(importCatalog)
  const onFile = async (f?: File) => { if (f) setPrev(previewImport(await f.text())) }
  const submit = async () => {
    if (!prev) return
    const r = await run(prev.rows)
    if (r) { toast.success(t('prod.import_done', { created: r.created, updated: r.updated })); setPrev(null); onClose() }
  }
  return (
    <Modal open={open} onClose={() => { setPrev(null); onClose() }} title={t('prod.import')} size="md" footer={<Button size="lg" variant="primary" block loading={run.busy} disabled={!prev?.rows.length} icon={<FileUp className="size-5" />} onClick={submit}>{t('prod.import_go', { n: prev?.rows.length ?? 0 })}</Button>}>
      <div className="space-y-4">
        <button type="button" onClick={() => { onClose(); navigate('/sheet') }} className="flex w-full items-center gap-3 rounded-xl border border-gold/40 bg-gold-soft p-3 text-start text-sm font-medium text-gold-text dark:bg-gold/10">
          <FileSpreadsheet className="size-5 shrink-0" />{t('prod.import_excel')}
        </button>
        <p className="text-sm text-fg-2">{t('prod.import_hint')}</p>
        <Button variant="secondary" icon={<Download className="size-5" />} onClick={() => downloadText('lattafa-products-template.csv', csvTemplate())}>{t('prod.import_template')}</Button>
        <input type="file" accept=".csv,text/csv" className="block w-full text-sm file:me-3 file:h-11 file:rounded-xl file:border-0 file:bg-gold file:px-4 file:font-semibold file:text-ink" onChange={(e) => onFile(e.target.files?.[0])} />
        {prev && (
          <div className="space-y-2 rounded-xl bg-surface-2 p-3 text-sm">
            <div className="font-semibold">{t('prod.import_rows', { n: prev.rows.length })}</div>
            {prev.errors.length > 0 && <ul className="max-h-40 list-disc space-y-1 overflow-y-auto ps-5 text-danger">{prev.errors.slice(0, 20).map((e, i) => <li key={i}><span className="num">#{e.line}</span> {e.message}</li>)}</ul>}
          </div>
        )}
      </div>
    </Modal>
  )
}

