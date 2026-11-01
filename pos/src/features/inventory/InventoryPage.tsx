import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ClipboardCheck, FlaskConical, Minus, PackagePlus, Plus, SlidersHorizontal, Trash2 } from 'lucide-react'
import { Amt } from '@/components/ui/Amt'
import { Badge, EmptyState, PageHeader, Segmented, Spinner, Stat, Switch } from '@/components/ui/Controls'
import { Button, IconButton } from '@/components/ui/Button'
import { Field, Input, SearchInput, Select } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { cn } from '@/components/ui/cn'
import { pick, useT } from '@/i18n'
import type { MovementType } from '@/data/types'
import { fmtDateTime } from '@/lib/date'
import { parseAmount } from '@/lib/money'
import { bidiSize } from '@/lib/size'
import type { CatalogItem, CatalogVariant } from '@/services/catalog'
import { adjustStock, applyStockCount, listMovements, markTester, receiveStock } from '@/services/stock'
import { stockValuation } from '@/services/reports'
import { useAction, useCatalog } from '@/hooks/queries'
import { useCan } from '@/hooks/useAuth'
import { useUI } from '@/store/ui'

interface Row { product: CatalogItem['product']; v: CatalogVariant }

export function InventoryPage() {
  const t = useT()
  const canReceive = useCan('inventory.receive')
  const canCount = useCan('inventory.count')
  const canMoves = useCan('inventory.movements')
  const [tab, setTab] = useState<'levels' | 'moves' | 'receive' | 'count'>('levels')
  const tabs = [
    { value: 'levels' as const, label: t('inv.tab_levels') },
    ...(canMoves ? [{ value: 'moves' as const, label: t('inv.tab_moves') }] : []),
    ...(canReceive ? [{ value: 'receive' as const, label: t('inv.tab_receive') }] : []),
    ...(canCount ? [{ value: 'count' as const, label: t('inv.tab_count') }] : []),
  ]
  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      <PageHeader title={t('inv.title')} subtitle={t('inv.subtitle')} actions={<Segmented value={tab} onChange={setTab} options={tabs} />} />
      {tab === 'levels' && <Levels />}
      {tab === 'moves' && <Moves />}
      {tab === 'receive' && <Receive onDone={() => setTab('levels')} />}
      {tab === 'count' && <Count onDone={() => setTab('levels')} />}
    </div>
  )
}

function useRows() {
  const { data: catalog, isLoading } = useCatalog()
  const rows = useMemo<Row[]>(() => (catalog ?? []).flatMap((c) => c.variants.map((v) => ({ product: c.product, v }))), [catalog])
  return { rows, isLoading }
}

/* ───── stock levels ───── */
function Levels() {
  const t = useT()
  const lang = useUI((s) => s.lang)
  const { rows, isLoading } = useRows()
  const canAdjust = useCan('inventory.adjust')
  const canTester = useCan('pos.tester')
  const canFinancial = useCan('reports.financial')
  const [q, setQ] = useState('')
  const [lowOnly, setLowOnly] = useState(false)
  const [adjust, setAdjust] = useState<Row | null>(null)
  const tester = useAction(markTester, { success: 'sell.tester_ok' })
  const { data: val } = useQuery({ queryKey: ['valuation'], queryFn: stockValuation, enabled: canFinancial })

  const list = rows.filter((r) => (!lowOnly || r.v.stock <= r.v.minStock) && (!q.trim() || [r.product.name.en, r.product.name.ar, r.product.name.ku, r.product.brand, r.v.sku, r.v.barcode].join(' ').toLowerCase().includes(q.trim().toLowerCase())))
  const units = rows.reduce((a, r) => a + r.v.stock, 0)
  const low = rows.filter((r) => r.v.stock <= r.v.minStock).length
  if (isLoading) return <div className="grid place-items-center py-16"><Spinner className="size-9" /></div>
  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t('inv.units')} value={<span className="num">{units}</span>} />
        <Stat label={t('inv.low_items')} value={<span className="num">{low}</span>} tone={low ? 'danger' : 'ok'} />
        {val && <Stat label={t('inv.value_cost')} value={<Amt n={val.costIQD} />} />}
        {val && <Stat label={t('inv.value_retail')} value={<Amt n={val.retailIQD} />} tone="gold" />}
      </div>
      <div className="mb-4 grid gap-2.5 md:grid-cols-[1fr_auto]">
        <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('prod.search')} />
        <label className="flex h-11 items-center gap-2.5 rounded-xl bg-surface-2 px-3.5 text-sm font-medium">{t('inv.low_only')}<Switch checked={lowOnly} onChange={setLowOnly} label={t('inv.low_only')} /></label>
      </div>
      {!list.length ? <EmptyState title={t('inv.none')} /> : (
        <ul className="space-y-2">
          {list.map((r) => {
            const isLow = r.v.stock <= r.v.minStock
            return (
              <li key={r.v.id} className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3">
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="truncate font-semibold">{pick(r.product.name, lang)} <span className="num text-sm font-normal text-fg-2">{r.v.label}</span></div>
                  <div className="num truncate text-xs text-fg-2">{r.v.sku} · {r.v.barcode}</div>
                </div>
                <div className="text-end">
                  <div className={cn('num text-xl font-bold', r.v.stock <= 0 ? 'text-danger' : isLow ? 'text-warn-fg' : '')}>{r.v.stock}</div>
                  <div className="text-[11px] text-fg-2">{t('inv.min')} <span className="num">{r.v.minStock}</span></div>
                </div>
                {isLow && <AlertTriangle className="hidden size-5 text-warning sm:block" aria-label={t('sell.low')} />}
                {canTester && r.v.stock > 0 && <IconButton label={t('sell.mark_tester')} variant="ghost" onClick={() => void tester(r.v.id, 1, 'tester')}><FlaskConical className="size-5" /></IconButton>}
                {canAdjust && <IconButton label={t('inv.adjust')} onClick={() => setAdjust(r)}><SlidersHorizontal className="size-5" /></IconButton>}
              </li>
            )
          })}
        </ul>
      )}
      <AdjustModal row={adjust} onClose={() => setAdjust(null)} />
    </>
  )
}

function AdjustModal({ row, onClose }: { row: Row | null; onClose: () => void }) {
  const t = useT()
  const lang = useUI((s) => s.lang)
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState<'adjustment' | 'damage'>('adjustment')
  const [note, setNote] = useState('')
  const run = useAction(adjustStock, { success: 'inv.adjusted' })
  const [key, setKey] = useState<string | null>(null)
  if ((row?.v.id ?? null) !== key) { setKey(row?.v.id ?? null); setQty(row ? String(row.v.stock) : ''); setNote(''); setReason('adjustment') }
  if (!row) return null
  const submit = async () => { if (await run({ variantId: row.v.id, newQty: Math.round(parseAmount(qty)), reason, note })) onClose() }
  return (
    <Modal open onClose={onClose} title={`${t('inv.adjust')} · ${pick(row.product.name, lang)} ${bidiSize(row.v.label)}`} size="sm" footer={<Button size="lg" variant="primary" block loading={run.busy} onClick={submit}>{t('common.save')}</Button>}>
      <div className="space-y-4">
        <div className="rounded-xl bg-surface-2 p-3 text-sm">{t('inv.current')}: <b className="num">{row.v.stock}</b></div>
        <Field label={t('inv.new_qty')}>{(i) => <Input id={i} big inputMode="numeric" className="num" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} data-autofocus />}</Field>
        <Segmented value={reason} onChange={setReason} options={[{ value: 'adjustment', label: t('inv.mv_adjustment') }, { value: 'damage', label: t('inv.mv_damage') }]} className="w-full [&>button]:flex-1" />
        <Field label={t('common.note')}>{(i) => <Input id={i} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      </div>
    </Modal>
  )
}

/* ───── movements ───── */
const MV_TONE: Partial<Record<MovementType, 'ok' | 'danger' | 'warn' | 'gold' | 'neutral'>> = { purchase: 'ok', return: 'ok', opening: 'ok', sale: 'neutral', void: 'ok', damage: 'danger', tester: 'warn', adjustment: 'gold', count: 'gold' }

function Moves() {
  const t = useT()
  const lang = useUI((s) => s.lang)
  const { rows } = useRows()
  const [variantId, setVariantId] = useState('')
  const byId = useMemo(() => new Map(rows.map((r) => [r.v.id, r])), [rows])
  const { data, isLoading } = useQuery({ queryKey: ['movements', variantId], queryFn: () => listMovements({ variantId: variantId || undefined, limit: 300 }) })
  return (
    <>
      <div className="mb-4"><Select value={variantId} onChange={(e) => setVariantId(e.target.value)} aria-label={t('inv.filter_item')}><option value="">{t('inv.all_items')}</option>{rows.map((r) => <option key={r.v.id} value={r.v.id}>{pick(r.product.name, lang)} · {r.v.label}</option>)}</Select></div>
      {isLoading ? <Spinner /> : !data?.length ? <EmptyState title={t('inv.no_moves')} /> : (
        <ul className="space-y-2">
          {data.map((m) => {
            const r = byId.get(m.variantId)
            return (
              <li key={m.id} className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3 text-sm">
                <Badge tone={MV_TONE[m.type] ?? 'neutral'}>{t(`inv.mv_${m.type}`)}</Badge>
                <div className="min-w-0 flex-1 leading-tight"><div className="truncate font-medium">{r ? `${pick(r.product.name, lang)} ${bidiSize(r.v.label)}` : m.variantId}</div><div className="num truncate text-xs text-fg-2">{fmtDateTime(m.createdAt)}{m.note ? ` · ${m.note}` : ''}</div></div>
                <div className="text-end"><div className={cn('num font-bold', m.qty > 0 ? 'text-success' : 'text-danger')}>{m.qty > 0 ? '+' : ''}{m.qty}</div><div className="num text-xs text-fg-2">→ {m.balanceAfter}</div></div>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

/* ───── receive stock ───── */
function Receive({ onDone }: { onDone: () => void }) {
  const t = useT()
  const lang = useUI((s) => s.lang)
  const { rows } = useRows()
  const canPrices = useCan('prices.edit')
  const [lines, setLines] = useState<{ variantId: string; qty: string; cost: string }[]>([{ variantId: '', qty: '', cost: '' }])
  const [note, setNote] = useState('')
  const run = useAction(receiveStock, { success: 'inv.received' })
  const valid = lines.filter((l) => l.variantId && parseAmount(l.qty) > 0)
  const submit = async () => { if ((await run(valid.map((l) => ({ variantId: l.variantId, qty: Math.round(parseAmount(l.qty)), costIQD: canPrices ? parseAmount(l.cost) || undefined : undefined })), note)) !== undefined) onDone() }
  const set = (i: number, p: Partial<(typeof lines)[number]>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)))
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <p className="text-sm text-fg-2">{t('inv.receive_hint')}</p>
      {lines.map((l, i) => (
        <div key={i} className="grid grid-cols-[1fr_5.5rem_auto] items-end gap-2 rounded-2xl border border-line bg-surface p-3 md:grid-cols-[1fr_6rem_8rem_auto]">
          <Field label={t('inv.item')} className="col-span-3 md:col-span-1">{(id) => <Select id={id} value={l.variantId} onChange={(e) => set(i, { variantId: e.target.value })}><option value="">—</option>{rows.map((r) => <option key={r.v.id} value={r.v.id}>{pick(r.product.name, lang)} · {bidiSize(r.v.label)} ({r.v.stock})</option>)}</Select>}</Field>
          <Field label={t('inv.qty')}>{(id) => <Input id={id} inputMode="numeric" className="num" value={l.qty} onChange={(e) => set(i, { qty: e.target.value.replace(/\D/g, '') })} />}</Field>
          {canPrices && <Field label={t('prod.cost')}>{(id) => <Input id={id} inputMode="numeric" className="num" value={l.cost} onChange={(e) => set(i, { cost: e.target.value.replace(/\D/g, '') })} />}</Field>}
          <IconButton label={t('common.remove')} variant="ghost" className="text-danger" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 className="size-5" /></IconButton>
        </div>
      ))}
      <Button variant="secondary" icon={<Plus className="size-5" />} onClick={() => setLines((ls) => [...ls, { variantId: '', qty: '', cost: '' }])}>{t('inv.add_line')}</Button>
      <Field label={t('common.note')}>{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('inv.receive_note_ph')} />}</Field>
      <Button size="xl" variant="primary" block icon={<PackagePlus className="size-5" />} loading={run.busy} disabled={!valid.length} onClick={submit}>{t('inv.receive_go', { n: valid.length })}</Button>
    </div>
  )
}

/* ───── stock count ───── */
function Count({ onDone }: { onDone: () => void }) {
  const t = useT()
  const lang = useUI((s) => s.lang)
  const { rows } = useRows()
  const [counted, setCounted] = useState<Record<string, string>>({})
  const [q, setQ] = useState('')
  const [note, setNote] = useState('')
  const run = useAction(applyStockCount, { success: 'inv.counted' })
  const entries = rows.filter((r) => counted[r.v.id] !== undefined && counted[r.v.id] !== '')
  const diffs = entries.filter((r) => Math.round(parseAmount(counted[r.v.id])) !== r.v.stock)
  const list = rows.filter((r) => !q.trim() || [r.product.name.en, r.product.name.ar, r.product.name.ku, r.v.sku, r.v.barcode].join(' ').toLowerCase().includes(q.trim().toLowerCase()))
  const submit = async () => { if (await run(entries.map((r) => ({ variantId: r.v.id, expected: r.v.stock, counted: Math.round(parseAmount(counted[r.v.id])) })), note)) onDone() }
  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-2">{t('inv.count_hint')}</p>
      <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('prod.search')} />
      <ul className="space-y-2">
        {list.map((r) => {
          const c = counted[r.v.id]
          const diff = c !== undefined && c !== '' ? Math.round(parseAmount(c)) - r.v.stock : 0
          return (
            <li key={r.v.id} className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3">
              <div className="min-w-0 flex-1 leading-tight"><div className="truncate font-semibold">{pick(r.product.name, lang)} <span className="num text-sm font-normal text-fg-2">{r.v.label}</span></div><div className="text-xs text-fg-2">{t('inv.system')}: <b className="num">{r.v.stock}</b></div></div>
              {diff !== 0 && <Badge tone={diff > 0 ? 'ok' : 'danger'}><span className="num">{diff > 0 ? '+' : ''}{diff}</span></Badge>}
              <div className="flex items-center rounded-xl bg-surface-2">
                <IconButton label="−" variant="ghost" onClick={() => setCounted({ ...counted, [r.v.id]: String(Math.max(0, (c === undefined || c === '' ? r.v.stock : Math.round(parseAmount(c))) - 1)) })}><Minus className="size-4" /></IconButton>
                <input aria-label={t('inv.counted_qty')} inputMode="numeric" placeholder={String(r.v.stock)} className="num w-14 bg-transparent text-center font-bold outline-none placeholder:font-normal placeholder:text-fg-2/60" value={c ?? ''} onFocus={(e) => e.target.select()} onChange={(e) => setCounted({ ...counted, [r.v.id]: e.target.value.replace(/\D/g, '') })} />
                <IconButton label="+" variant="ghost" onClick={() => setCounted({ ...counted, [r.v.id]: String((c === undefined || c === '' ? r.v.stock : Math.round(parseAmount(c))) + 1) })}><Plus className="size-4" /></IconButton>
              </div>
            </li>
          )
        })}
      </ul>
      <Field label={t('common.note')}>{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      <div className="sticky bottom-0 -mx-4 border-t border-line bg-bg/95 p-3 backdrop-blur md:-mx-6">
        <Button size="xl" variant="primary" block icon={<ClipboardCheck className="size-5" />} loading={run.busy} disabled={!entries.length} onClick={submit}>{t('inv.count_go', { n: entries.length, d: diffs.length })}</Button>
      </div>
    </div>
  )
}
