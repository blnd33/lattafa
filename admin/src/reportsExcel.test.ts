/**
 * The Excel file of a report, written and then read back (runs in Node, where the file streams it needs exist).
 */
import { describe, expect, it, vi } from 'vitest'
import { translate } from '@/i18n'
import { readXlsx } from '@/lib/xlsx'
import { REPORTS, type ReportTable } from './reports/api'
import { downloadXlsx, type ExportCtx } from './reports/export'

const saved: { name: string; blob: Blob }[] = []
vi.mock('@/lib/image', async (orig) => ({ ...(await orig<typeof import('@/lib/image')>()), downloadBlob: (name: string, blob: Blob) => { saved.push({ name, blob }) } }))

const t = (k: string, v?: Record<string, string | number>) => translate('en', k, v)

const byProduct: ReportTable = {
  type: 'sales-by-product', from: new Date(2026, 9, 1).getTime(), to: new Date(2026, 9, 31, 23, 59, 59, 999).getTime(), financial: true, summary: [],
  columns: [
    { key: 'product', label: 'rc.product', type: 'name' }, { key: 'size', label: 'rc.size', type: 'text' }, { key: 'units', label: 'rc.units', type: 'int' },
    { key: 'revenue', label: 'rc.revenue', type: 'iqd' }, { key: 'margin', label: 'rc.margin', type: 'pct' },
  ],
  rows: [
    { id: 'v2', product: { en: 'Khamrah', ar: 'خمرة', ku: 'خەمرە' }, size: '100 ml', units: 5, revenue: 225000, margin: 40.5 },
    { id: 'v1', product: { en: 'Asad', ar: 'أسد', ku: 'ئەسەد' }, size: '100 ml', units: 3, revenue: 120000, margin: 40 },
  ],
  totals: { units: 8, revenue: 345000, margin: 40.3 },
}

describe('report → Excel', () => {
  it('opens with the table, its totals and the details', async () => {
    const ctx: ExportCtx = { t, lang: 'en', shop: 'Lattafa Duhok', by: 'Rand Owner', def: REPORTS.find((r) => r.id === 'sales-by-product')! }
    await downloadXlsx(byProduct, ctx)
    expect(saved[0].name).toBe('lattafa-sales-by-product-2026-10-01-2026-10-31.xlsx')
    const [sheet, about] = await readXlsx(await saved[0].blob.arrayBuffer())
    expect(sheet.rows[0]).toEqual(['Product', 'Size', 'Bottles', 'Takings', 'Margin'])
    expect(sheet.rows[1]).toEqual(['Khamrah', '100 ml', '5', '225000', '40.5']) // numbers stay numbers, so Excel can add them up
    expect(sheet.rows[3]).toEqual(['Total', '', '8', '345000', '40.3'])
    expect(about.rows[0][0]).toBe('Sales by product')
    expect(about.rows[1][0]).toBe('Lattafa Duhok')
  })

  it('keeps each amount’s currency beside it, and reads right to left in Kurdish', async () => {
    saved.length = 0
    const ku = (k: string, v?: Record<string, string | number>) => translate('ku', k, v)
    const expenses: ReportTable = {
      type: 'expenses', from: 0, to: 0, financial: true, summary: [], totals: { amountIQD: 855000 },
      columns: [{ key: 'category', label: 'rc.category', type: 'enum:exp.cat_' }, { key: 'amount', label: 'rc.amount', type: 'money' }, { key: 'amountIQD', label: 'rc.amountIQD', type: 'iqd' }],
      rows: [{ id: 'e1', category: 'rent', amount: 500, currency: 'USD', amountIQD: 730000 }, { id: 'e2', category: 'electricity', amount: 125000, currency: 'IQD', amountIQD: 125000 }],
    }
    await downloadXlsx(expenses, { t: ku, lang: 'ku', shop: 'Lattafa', by: 'Rand', def: REPORTS.find((r) => r.id === 'expenses')! })
    const [sheet] = await readXlsx(await saved[0].blob.arrayBuffer())
    expect(sheet.rows[0]).toEqual(['جۆر', 'بڕ', 'دراو', 'بە دینار'])
    expect(sheet.rows[1]).toEqual(['کرێ', '500', 'USD', '730000'])
    expect(sheet.rows[2]).toEqual(['کارەبا و مۆلیدە', '125000', 'IQD', '125000'])
  })
})
