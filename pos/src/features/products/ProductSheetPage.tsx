import { Fragment, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { AlertTriangle, CheckCircle2, CornerDownLeft, Eraser, FileDown, FileSpreadsheet, FileUp, ListChecks, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, PageHeader } from '@/components/ui/Controls'
import { useConfirm } from '@/components/ui/Modal'
import { cn } from '@/components/ui/cn'
import { errorMessage, useT } from '@/i18n'
import { uuid } from '@/lib/id'
import { downloadBlob } from '@/lib/image'
import {
  CHOICE_COLUMNS, blankRow, catalogueSheetRows, checkRow, isBlank, pasteToPatches, readSheetFile, saveSheetRows, sheetWorkbook, type CellErrors, type SheetCol, type SheetRow,
} from '@/services/productSheet'
import { useUI } from '@/store/ui'
import { AppError } from '@/services/context'
import { toast } from '@/store/toast'

/* ───────── the rows, kept on this device so a reload never loses typing ───────── */

interface Line {
  id: string
  v: SheetRow
  saved?: { status: 'added' | 'updated'; sku: string }
  errors?: CellErrors
  /** a problem with the whole row (e.g. no connection) — an `err.*` code */
  message?: string
  /** cells that came empty from a supplier's invoice and must be filled in (the selling price, the size) */
  need?: SheetCol[]
}
const fresh = (from?: SheetRow): Line => ({ id: uuid(), v: blankRow(from) })
/** There is always one empty row at the bottom to type into. */
const withTail = (lines: Line[]): Line[] => {
  const last = lines[lines.length - 1]
  return !last || last.saved || !isBlank(last.v) ? [...lines, fresh(last?.v)] : lines
}
const useSheet = create<{ lines: Line[]; setLines: (l: Line[]) => void }>()(persist(
  (set) => ({ lines: [fresh()], setLines: (lines) => set({ lines: withTail(lines) }) }),
  { name: 'lattafa-product-sheet', version: 1 },
))

/* ───────── columns ───────── */

interface Col { key: SheetCol; w: string; kind: 'text' | 'number' | 'choice'; ph?: string; dir?: 'ltr' | 'rtl' | 'auto' }
const COLS: Col[] = [
  { key: 'name_en', w: 'w-48', kind: 'text', ph: 'Khamrah', dir: 'ltr' },
  { key: 'name_ar', w: 'w-44', kind: 'text', ph: 'خمرة', dir: 'rtl' },
  { key: 'name_ku', w: 'w-44', kind: 'text', ph: 'خەمرە', dir: 'rtl' },
  { key: 'brand', w: 'w-32', kind: 'text', dir: 'auto' },
  { key: 'category', w: 'w-36', kind: 'choice' },
  { key: 'gender', w: 'w-28', kind: 'choice' },
  { key: 'concentration', w: 'w-28', kind: 'choice' },
  { key: 'size', w: 'w-20', kind: 'number', ph: '100' },
  { key: 'unit', w: 'w-20', kind: 'choice' },
  { key: 'cost_iqd', w: 'w-28', kind: 'number' },
  { key: 'retail_iqd', w: 'w-28', kind: 'number', ph: '35000' },
  { key: 'wholesale_iqd', w: 'w-28', kind: 'number' },
  { key: 'stock', w: 'w-24', kind: 'number' },
  { key: 'min_stock', w: 'w-24', kind: 'number', ph: '5' },
  { key: 'barcode', w: 'w-40', kind: 'text', dir: 'ltr' },
  { key: 'sku', w: 'w-44', kind: 'text', dir: 'ltr' },
]

export function ProductSheetPage() {
  const t = useT()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const lines = useSheet((s) => s.lines)
  const setLines = useSheet((s) => s.setLines)
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [fileBusy, setFileBusy] = useState<'template' | 'products' | 'upload' | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const lang = useUI((s) => s.lang)

  const choiceLabel = (col: SheetCol, v: string) =>
    col === 'category' ? t(`prod.cat_${v}`) : col === 'gender' ? t(`gender.${v}`) : v
  const drafts = lines.filter((l) => !l.saved && !isBlank(l.v))

  const focusCell = (r: number, c: number) => {
    const row = Math.max(0, Math.min(r, useSheet.getState().lines.length - 1))
    const col = Math.max(0, Math.min(c, COLS.length - 1))
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-cell="${row}:${col}"]`)
      el?.focus()
      if (el instanceof HTMLInputElement) el.select()
    })
  }

  const setCell = (r: number, col: SheetCol, value: string) => {
    const cur = useSheet.getState().lines
    if (!cur[r] || cur[r].saved) return
    const errors = cur[r].errors ? { ...cur[r].errors } : undefined
    if (errors) delete errors[col]
    setLines(cur.map((l, i) => (i === r ? { ...l, v: { ...l.v, [col]: value }, errors, message: undefined } : l)))
  }

  /** Enter (one row) or "Add all" (every filled row): check, save through the import, mark each row. */
  const save = async (ids: string[], moveFrom?: number) => {
    const cur = useSheet.getState().lines
    const targets = cur.filter((l) => ids.includes(l.id) && !l.saved && !isBlank(l.v))
    if (!targets.length) { if (moveFrom !== undefined) focusCell(moveFrom + 1, 0); return }
    setBusy(new Set(targets.map((l) => l.id)))
    try {
      const res = await saveSheetRows(targets.map((l) => l.v), targets.map((l) => l.need))
      const byId = new Map(targets.map((l, k) => [l.id, res[k]]))
      setLines(useSheet.getState().lines.map((l) => {
        const r = byId.get(l.id)
        if (!r) return l
        return r.ok ? { ...l, v: { ...l.v, sku: r.sku }, saved: { status: r.status, sku: r.sku }, errors: undefined, message: undefined } : { ...l, errors: r.errors, message: r.message }
      }))
      await qc.invalidateQueries()
      const bad = res.filter((r) => !r.ok).length
      if (targets.length > 1) (bad ? toast.error : toast.success)(t('sheet.added_n', { ok: res.length - bad, bad }))
      const after = useSheet.getState().lines
      if (moveFrom !== undefined) {
        const r = res[0]
        if (r.ok) {
          // like Excel: the next row to type in (skipping rows already added)
          let next = moveFrom + 1
          while (after[next]?.saved) next++
          focusCell(next, 0)
        } else {
          const first = COLS.findIndex((c) => !r.ok && r.errors[c.key])
          if (first >= 0) focusCell(moveFrom, first)
          toast.error(r.message ? errorMessage(new AppError(r.message), t) : t(Object.values(r.errors)[0]!.key, Object.values(r.errors)[0]!.vars))
        }
      }
    } catch (e) {
      toast.error(errorMessage(e, t))
    } finally {
      setBusy(new Set())
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTableElement>) => {
    const el = e.target as HTMLElement
    const pos = el.dataset.cell
    if (!pos) return
    const [r, c] = pos.split(':').map(Number)
    const rtl = document.documentElement.dir === 'rtl'
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      e.preventDefault()
      void save([lines[r].id], r)
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.altKey) {
      e.preventDefault()
      focusCell(r + (e.key === 'ArrowDown' ? 1 : -1), c)
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const forward = (e.key === 'ArrowRight') !== rtl
      if (el instanceof HTMLInputElement) {
        // inside a cell the arrows move the cursor; at its edge they move to the next cell
        const atStart = el.selectionStart === 0 && el.selectionEnd === 0
        const atEnd = el.selectionStart === el.value.length
        if (el.dir === 'rtl' ? (forward ? !atStart : !atEnd) : (forward ? !atEnd : !atStart)) return
      }
      e.preventDefault()
      focusCell(r, c + (forward ? 1 : -1))
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
      // Excel's "fill down": copy the cell above
      e.preventDefault()
      if (r > 0) setCell(r, COLS[c].key, lines[r - 1].v[COLS[c].key])
    }
  }

  const onPaste = (e: ClipboardEvent<HTMLTableElement>) => {
    const el = e.target as HTMLElement
    const pos = el.dataset.cell
    if (!pos) return
    const text = e.clipboardData.getData('text/plain')
    if (!/[\t\n]/.test(text.replace(/\r?\n$/, ''))) return // one value: a normal paste into the cell
    e.preventDefault()
    const [r, c] = pos.split(':').map(Number)
    const patches = pasteToPatches(text, COLS[c].key)
    if (!patches.length) return
    const cur = [...useSheet.getState().lines]
    let i = r
    for (const p of patches) {
      while (cur[i]?.saved) i++ // never write over a row that is already added
      if (i >= cur.length) cur.push(fresh(cur[cur.length - 1]?.v))
      cur[i] = { ...cur[i], v: { ...cur[i].v, ...p }, errors: undefined, message: undefined }
      i++
    }
    setLines(cur)
    toast.success(t('sheet.pasted', { n: patches.length }))
  }

  /** Rows from a file go below the ones already there, to be checked before "Add all rows". A supplier's invoice says
   * what each row still needs: those cells are marked straight away. */
  const addPatches = (patches: Partial<SheetRow>[], need?: SheetCol[][]) => {
    const cur = useSheet.getState().lines.filter((l) => l.saved || !isBlank(l.v))
    patches.forEach((p, i) => {
      const v = { ...blankRow(cur[cur.length - 1]?.v), ...p }
      const errors = need ? checkRow(v, need[i]) : {}
      cur.push({ ...fresh(cur[cur.length - 1]?.v), v, ...(need?.[i]?.length ? { need: need[i] } : {}), ...(Object.keys(errors).length ? { errors } : {}) })
    })
    setLines(cur)
  }
  const upload = async (file?: File) => {
    if (!file) return
    setFileBusy('upload')
    try {
      const { patches, invoice } = await readSheetFile(file)
      if (!patches.length) { toast.error(t('err.nothing_to_import')); return }
      addPatches(patches, invoice?.need)
      if (invoice) {
        const missing = invoice.need.filter((n) => n.length).length
        toast.success([t('sheet.loaded_invoice', { n: patches.length, file: file.name, free: invoice.free }), invoice.known ? t('sheet.invoice_known', { n: invoice.known }) : '', missing ? t('sheet.invoice_missing', { n: missing }) : ''].filter(Boolean).join(' '))
      } else toast.success(t('sheet.loaded', { n: patches.length, file: file.name }))
    } catch (e) {
      toast.error(errorMessage(e, t))
    } finally {
      setFileBusy(null)
      if (fileInput.current) fileInput.current.value = '' // the same file can be chosen again
    }
  }
  const download = async (what: 'template' | 'products') => {
    setFileBusy(what)
    try {
      const rows = what === 'products' ? await catalogueSheetRows() : []
      const day = new Date().toISOString().slice(0, 10)
      downloadBlob(what === 'products' ? `lattafa-products-${day}.xlsx` : 'lattafa-products-template.xlsx', await sheetWorkbook(rows, lang))
    } catch (e) {
      toast.error(errorMessage(e, t))
    } finally {
      setFileBusy(null)
    }
  }
  const removeLine = (id: string) => setLines(useSheet.getState().lines.filter((l) => l.id !== id))

  const clearAdded = () => setLines(lines.filter((l) => !l.saved))
  const clearAll = async () => {
    if (await confirm({ title: t('sheet.clear_all'), message: t('sheet.clear_confirm'), confirmLabel: t('sheet.clear_all'), danger: true })) setLines(lines.filter((l) => l.saved))
  }

  return (
    <div className="mx-auto max-w-[100rem] space-y-4 p-4">
      <PageHeader title={t('sheet.title')} subtitle={t('sheet.subtitle')} actions={<>
        <Button variant="secondary" icon={<FileSpreadsheet className="size-5" />} loading={fileBusy === 'template'} onClick={() => download('template')}>{t('sheet.download_template')}</Button>
        <Button variant="secondary" icon={<FileDown className="size-5" />} loading={fileBusy === 'products'} onClick={() => download('products')}>{t('sheet.download_products')}</Button>
        <Button variant="secondary" icon={<FileUp className="size-5" />} loading={fileBusy === 'upload'} onClick={() => fileInput.current?.click()}>{t('sheet.upload')}</Button>
        <input ref={fileInput} type="file" hidden accept=".xlsx,.xlsm,.csv,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={(e) => upload(e.target.files?.[0])} />
        {lines.some((l) => l.saved) && <Button variant="ghost" icon={<ListChecks className="size-5" />} onClick={clearAdded}>{t('sheet.clear_added')}</Button>}
        {drafts.length > 0 && <Button variant="ghost" icon={<Eraser className="size-5" />} onClick={clearAll}>{t('sheet.clear_all')}</Button>}
        <Button variant="primary" icon={<CornerDownLeft className="size-5" />} disabled={!drafts.length || busy.size > 0} loading={busy.size > 1}
          onClick={() => save(drafts.map((l) => l.id))}>{t('sheet.add_all', { n: drafts.length })}</Button>
      </>} />

      <Card className="flex flex-wrap gap-2 !py-3 text-xs text-fg-2">
        {['sheet.tip_enter', 'sheet.tip_move', 'sheet.tip_fill', 'sheet.tip_paste', 'sheet.tip_sizes', 'sheet.tip_invoice'].map((k) => (
          <span key={k} className="rounded-full bg-surface-2 px-3 py-1.5">{t(k)}</span>
        ))}
      </Card>

      <div className="overflow-auto rounded-2xl border border-line bg-surface shadow-soft" style={{ maxHeight: 'calc(100dvh - 15rem)' }}>
        <table className="min-w-max border-separate border-spacing-0 text-sm" onKeyDown={onKeyDown} onPaste={onPaste}>
          <thead className="sticky top-0 z-10 bg-surface-2">
            <tr>
              <th className="sticky start-0 z-10 w-12 border-b border-e border-line bg-surface-2 px-2 py-2 text-center text-xs font-semibold text-fg-2">#</th>
              <th className="w-28 border-b border-e border-line px-2 py-2 text-start text-xs font-semibold text-fg-2" />
              {COLS.map((c) => (
                <th key={c.key} scope="col" className={cn(c.w, 'whitespace-nowrap border-b border-e border-line px-2 py-2 text-start text-xs font-semibold', c.key === 'retail_iqd' || c.key === 'name_en' ? 'text-gold-text' : 'text-fg-2')}>
                  {t(`sheet.col_${c.key}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, r) => {
              const isBusy = busy.has(l.id)
              const blank = isBlank(l.v)
              const hasErr = !!(l.errors && Object.keys(l.errors).length) || !!l.message
              return (
                <Fragment key={l.id}>
                  <tr className={cn(l.saved && 'bg-ok-bg/40', hasErr && 'bg-danger-bg/30')}>
                    <td className="sticky start-0 z-[1] border-b border-e border-line bg-surface-2 px-2 text-center text-xs text-fg-2 num">{r + 1}</td>
                    <td className="whitespace-nowrap border-b border-e border-line px-2 text-xs">
                      {isBusy ? <Loader2 className="size-4 animate-spin text-gold-text" />
                        : l.saved ? <span className="inline-flex items-center gap-1 font-semibold text-success"><CheckCircle2 className="size-4" />{t(`sheet.${l.saved.status}`)}{l.saved.status === 'updated' && Number(l.v.stock) > 0 && <span className="num">+{l.v.stock}</span>}</span>
                          : hasErr ? <span className="inline-flex items-center gap-1 font-semibold text-danger"><AlertTriangle className="size-4" />{t('sheet.fix')}</span>
                            : !blank ? <span className="inline-flex items-center gap-1 text-fg-2"><CornerDownLeft className="size-3.5" />{t('sheet.press_enter')}</span> : null}
                      {!l.saved && !isBusy && !blank && (
                        <button type="button" tabIndex={-1} aria-label={`${t('sheet.remove_row')} ${r + 1}`} title={t('sheet.remove_row')} onClick={() => removeLine(l.id)}
                          className="ms-1.5 inline-grid size-6 place-items-center rounded-md align-middle text-fg-2 hover:bg-danger-bg hover:text-danger"><X className="size-3.5" /></button>
                      )}
                    </td>
                    {COLS.map((c, ci) => {
                      const err = l.errors?.[c.key]
                      const cell = `${r}:${ci}`
                      const base = cn('block h-10 w-full bg-transparent px-2 text-sm outline-none focus:bg-surface focus:ring-2 focus:ring-inset focus:ring-gold', err && 'ring-2 ring-inset ring-danger')
                      if (l.saved) {
                        return <td key={c.key} className="border-b border-e border-line p-0"><span tabIndex={0} data-cell={cell} className={cn(base, 'flex items-center truncate text-fg-2', c.kind === 'number' && 'num')} dir={c.dir}>{c.kind === 'choice' ? choiceLabel(c.key, l.v[c.key]) : l.v[c.key]}</span></td>
                      }
                      const label = `${t(`sheet.col_${c.key}`)} — ${r + 1}`
                      if (c.kind === 'choice') {
                        const options = CHOICE_COLUMNS[c.key]!
                        return (
                          <td key={c.key} className="border-b border-e border-line p-0">
                            <select data-cell={cell} aria-label={label} aria-invalid={!!err || undefined} title={err ? t(err.key, err.vars) : undefined}
                              className={cn(base, 'cursor-pointer appearance-none')} value={l.v[c.key]} onChange={(e) => setCell(r, c.key, e.target.value)}>
                              {!options.includes(l.v[c.key]) && <option value={l.v[c.key]}>⚠ {l.v[c.key]}</option>}
                              {options.map((o) => <option key={o} value={o}>{choiceLabel(c.key, o)}</option>)}
                            </select>
                          </td>
                        )
                      }
                      return (
                        <td key={c.key} className="border-b border-e border-line p-0">
                          <input data-cell={cell} aria-label={label} aria-invalid={!!err || undefined} title={err ? t(err.key, err.vars) : undefined}
                            className={cn(base, c.kind === 'number' && 'num text-end')} dir={c.kind === 'number' ? 'ltr' : c.dir} inputMode={c.kind === 'number' ? 'decimal' : undefined}
                            placeholder={r === 0 && blank ? c.ph : undefined} autoComplete="off" spellCheck={false}
                            value={l.v[c.key]} onChange={(e) => setCell(r, c.key, e.target.value)} />
                        </td>
                      )
                    })}
                  </tr>
                  {hasErr && (
                    <tr>
                      <td className="sticky start-0 border-b border-e border-line bg-surface-2" />
                      <td colSpan={COLS.length + 1} className="border-b border-line bg-danger-bg px-3 py-1.5 text-xs text-danger-fg">
                        {l.message && <span className="me-3">{errorMessage(new AppError(l.message), t)}</span>}
                        {COLS.filter((c) => l.errors?.[c.key]).map((c) => (
                          <span key={c.key} className="me-3"><b>{t(`sheet.col_${c.key}`).replace(/\s*\*$/, '')}:</b> {t(l.errors![c.key]!.key, l.errors![c.key]!.vars)}</span>
                        ))}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
