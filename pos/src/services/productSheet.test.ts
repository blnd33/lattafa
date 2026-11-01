import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/data/db'
import { completeSetup, loginWithPassword } from './auth'
import { setActor } from './context'
import { stockMap } from './stock'
import { blankRow, catalogueSheetRows, checkRow, pasteToPatches, readChoice, readNumber, readSheetFile, saveSheetRows, sheetWorkbook, type SheetRow } from './productSheet'

const row = (over: Partial<SheetRow>): SheetRow => ({ ...blankRow(), ...over })

beforeEach(async () => {
  await db.delete()
  await db.open()
  setActor(null)
  await completeSetup({
    store: { name: 'Lattafa Test', phone: '', address: '', city: 'Duhok' }, rate: 1460,
    admin: { name: 'Owner', username: 'owner', password: 'Owner1234', pin: '1111' }, demoData: true, deviceName: 'Counter 1',
  })
  setActor(await loginWithPassword('owner', 'Owner1234'))
})

describe('reading what is typed or pasted', () => {
  it('understands choices in English, Arabic and Kurdish', () => {
    expect(['رجالي', 'پیاوان', 'Male', 'for men'].map((v) => readChoice('gender', v))).toEqual(['men', 'men', 'men', 'men'])
    expect(readChoice('gender', 'نسائي')).toBe('women')
    expect(readChoice('gender', 'للجنسين')).toBe('unisex')
    expect(readChoice('unit', 'Fl Oz')).toBe('oz')
    expect(readChoice('category', 'عود')).toBe('oud')
    expect(readChoice('concentration', 'eau de parfum')).toBe('EDP')
    expect(readChoice('gender', 'robot')).toBe('robot') // not recognised: kept, and the row's check fails
  })

  it('reads numbers the way people write them', () => {
    expect(readNumber('35,000')).toBe(35000)
    expect(readNumber('٣٥٠٠٠')).toBe(35000)
    expect(readNumber('35000 IQD')).toBe(35000)
    expect(readNumber('3,4', true)).toBe(3.4)
    expect(readNumber('')).toBeNull()
    expect(readNumber('abc')).toBeNaN()
  })

  it('pastes cells from Excel into the columns, from the cell you are in', () => {
    const p = pasteToPatches('Asad\tأسد\t\tLattafa\tPerfume\tMale\tEDP\t100\tml\t20000\t33500\r\nYara\tيارا\t\tLattafa\tPerfume\tنسائي\tEDP\t100\tml\t18000\t31000\r\n', 'name_en')
    expect(p).toHaveLength(2)
    expect(p[0]).toMatchObject({ name_en: 'Asad', name_ar: 'أسد', brand: 'Lattafa', category: 'perfume', gender: 'men', size: '100', unit: 'ml', cost_iqd: '20000', retail_iqd: '33500' })
    expect(p[1].gender).toBe('women')
    // a column of prices pasted into the price column fills only that column
    expect(pasteToPatches('35000\n40000\n', 'retail_iqd')).toEqual([{ retail_iqd: '35000' }, { retail_iqd: '40000' }])
  })

  it('a pasted header row maps columns by name, in any order and language', () => {
    const p = pasteToPatches('الاسم\tالسعر\tالحجم\tالجنس\nأسد\t33500\t100\tرجالي\n', 'sku')
    expect(p).toEqual([{ name_ar: 'أسد', retail_iqd: '33500', size: '100', gender: 'men' }])
  })

  it('checks each cell', () => {
    expect(checkRow(row({}))).toMatchObject({ name_en: { key: 'sheet.err_name' }, retail_iqd: { key: 'sheet.err_retail' } })
    expect(checkRow(row({ name_ku: 'خەمرە', retail_iqd: '35000' }))).toEqual({})
    expect(checkRow(row({ name_en: 'X', retail_iqd: 'cheap', size: 'big', gender: 'robot' }))).toMatchObject({
      retail_iqd: { key: 'sheet.err_number' }, size: { key: 'sheet.err_number' }, gender: { key: 'sheet.err_gender' },
    })
  })
})

describe('Excel files', () => {
  const asFile = async (blob: Blob, name: string) => new File([await blob.arrayBuffer()], name, { type: blob.type })

  it('the template has the column titles and nothing to import yet', async () => {
    const r = await readSheetFile(await asFile(await sheetWorkbook([], 'en'), 'template.xlsx'))
    expect(r).toEqual({ patches: [], sheet: 'Products' })
  })

  it('download → change prices in Excel → upload: the rows come back as they went out (Arabic file)', async () => {
    const rows = await catalogueSheetRows()
    expect(rows.length).toBeGreaterThan(10)
    const kham = rows.find((x) => x.name_en === 'Khamrah' && x.size === '100')!
    expect(kham).toMatchObject({ unit: 'ml', gender: 'unisex', category: 'perfume' })
    const file = await asFile(await sheetWorkbook(rows, 'ar'), 'products.xlsx')
    const { patches, sheet } = await readSheetFile(file)
    expect(sheet).toBe('المنتجات')
    expect(patches).toHaveLength(rows.length)
    // choices were written as Arabic labels ("للجنسين", "عطر") and are read back as codes
    expect(patches.find((p) => p.sku === kham.sku)).toEqual({ ...kham })
  })

  it('a file of our own: title rows above the header, columns in any order, CSV too', async () => {
    const { writeXlsx } = await import('@/lib/xlsx')
    const own = await writeXlsx([{ name: 'Sheet1', header: false, columns: [{ width: 10 }, { width: 10 }, { width: 10 }], rows: [['Price list October'], [], ['Price', 'Name', 'Size'], [33500, 'Asad', 100], [31000, 'Yara', 100]] }])
    expect((await readSheetFile(await asFile(own, 'mine.xlsx'))).patches).toEqual([{ retail_iqd: '33500', name_en: 'Asad', size: '100' }, { retail_iqd: '31000', name_en: 'Yara', size: '100' }])
    const csv = new File(['sku,name_en,retail_iqd,unit\r\nX-1,Csv One,15000,oz\r\n'], 'old.csv', { type: 'text/csv' })
    expect((await readSheetFile(csv)).patches).toEqual([{ sku: 'X-1', name_en: 'Csv One', retail_iqd: '15000', unit: 'oz' }])
  })

  it('explains files it cannot use', async () => {
    const code = async (f: File) => { try { await readSheetFile(f) } catch (e) { return (e as { code: string }).code } }
    expect(await code(new File(['x'], 'old.xls'))).toBe('file_xls')
    expect(await code(new File(['not a zip'], 'broken.xlsx'))).toBe('file_bad')
    expect(await code(new File(['a,b\r\n1,2\r\n'], 'random.csv', { type: 'text/csv' }))).toBe('file_no_header')
  })
})

describe('Enter adds the row to the products', () => {
  it('a new perfume, then another size of it, becomes one product with two sizes', async () => {
    const [a] = await saveSheetRows([row({ name_en: 'Velvet Night', name_ar: 'ليلة مخملية', size: '100', retail_iqd: '40,000', cost_iqd: '25000', stock: '6' })])
    expect(a).toMatchObject({ ok: true, status: 'added', sku: 'LAT-VELVET-NIGHT-100ML' })
    const [b] = await saveSheetRows([row({ name_en: 'Velvet Night', size: '3.4', unit: 'oz', retail_iqd: '42000' })])
    expect(b).toMatchObject({ ok: true, status: 'added', sku: 'LAT-VELVET-NIGHT-3_4OZ' })
    const products = (await db.products.toArray()).filter((p) => p.name.en === 'Velvet Night')
    expect(products).toHaveLength(1)
    const sizes = await db.variants.where('productId').equals(products[0].id).toArray()
    expect(sizes.map((v) => [v.label, v.retailIQD, v.wholesaleIQD, v.minStock]).sort()).toEqual([['100 ml', 40000, 40000, 5], ['3.4 oz', 42000, 42000, 5]])
    expect((await stockMap())[sizes.find((v) => v.unit === 'ml')!.id]).toBe(6)
  })

  it('the same perfume and size again updates its prices instead of adding a copy', async () => {
    const before = await db.variants.count()
    const [r] = await saveSheetRows([row({ name_en: 'Khamrah', size: '100', retail_iqd: '47000', wholesale_iqd: '38000' })])
    expect(r).toMatchObject({ ok: true, status: 'updated' })
    expect(await db.variants.count()).toBe(before)
    const v = (await db.variants.toArray()).find((x) => x.sku === (r as { sku: string }).sku)!
    expect([v.retailIQD, v.wholesaleIQD]).toEqual([47000, 38000])
  })

  it('names typed only in Arabic or Kurdish are grouped by that name', async () => {
    await saveSheetRows([
      row({ name_ar: 'عطر الورد', size: '100', retail_iqd: '20000' }),
      row({ name_ar: 'عطر الورد', size: '50', retail_iqd: '12000' }),
      row({ name_ku: 'بۆنی گوڵ', size: '100', retail_iqd: '21000' }),
    ])
    const rose = (await db.products.toArray()).filter((p) => p.name.ar === 'عطر الورد')
    expect(rose).toHaveLength(1)
    expect(await db.variants.where('productId').equals(rose[0].id).count()).toBe(2)
    expect((await db.products.toArray()).some((p) => p.name.ku === 'بۆنی گوڵ')).toBe(true)
  })

  it('a barcode already in use stops only that row; the same size twice is caught before saving', async () => {
    const taken = (await db.variants.toArray())[0].barcode
    const res = await saveSheetRows([
      row({ name_en: 'Fresh One', size: '100', retail_iqd: '30000', barcode: taken }),
      row({ name_en: 'Fresh Two', size: '100', retail_iqd: '30000' }),
      row({ name_en: 'Fresh Two', size: '100', retail_iqd: '31000' }),
    ])
    expect(res[0]).toMatchObject({ ok: false, errors: { barcode: { key: 'sheet.err_barcode_taken' } } })
    expect(res[1]).toMatchObject({ ok: true, status: 'added' })
    expect(res[2]).toMatchObject({ ok: false, errors: { size: { key: 'sheet.err_dup', vars: { n: 2 } } } })
    expect((await db.products.toArray()).some((p) => p.name.en === 'Fresh One')).toBe(false)
  })
})

describe('a supplier invoice uploaded as it is', () => {
  const asFile = async (blob: Blob, name: string) => new File([await blob.arrayBuffer()], name, { type: blob.type })
  // laid out like the supplier's file: the shop added the cost in dinars (H), the selling price (I) and the rate (J1/K1)
  const HEAD = ['الباركود', 'القيمة', 'الحسم', 'السعر', 'الكمية', 'المادة', 'ت', 'cost price in dinnar ', 'selling price', 'Rate (D × )', 1600]
  const invoice = async (rows: (string | number)[][], head = HEAD) => {
    const { writeXlsx } = await import('@/lib/xlsx')
    return asFile(await writeXlsx([
      { name: 'Table 1', header: false, columns: head.map(() => ({ width: 10 })), rows: [head, ...rows] },
      { name: 'Table 2', header: false, columns: [{ width: 10 }], rows: [['اسم المستخدم : …'], ['صافي الدفع كتابة: …']] },
    ]), 'supplier-invoice.xlsx')
  }
  const line = (barcode: string, usd: number, qty: number, name: string, n: number, sell: number | '' = '', free = false) =>
    [barcode, free ? '' : Math.round(usd * qty), free ? '% 100' : '', usd, qty, name, n, Math.round(usd * 1600), free ? '' : sell]

  it('reads the names, leaves out the free pieces and says what is missing', async () => {
    const file = await invoice([
      line('6290360593722', 10, 12, 'عطر اطلس 55مل / لطافة', 1, 30000),
      line('6290360593722', 10, 1, 'عطر اطلس 55مل / لطافة', 2, '', true),
      line('', 12, 12, 'عطر اكير بانوفي 100مل / لطافة', 3, 33000),
      line('', 12, 1, 'عطر اكير بانوفي 100مل / لطافة', 4, '', true),
      line('6290360592220', 20, 12, 'عطر حابك للرجال 100مل / لطافة برايد 4د', 5, 31000),
      line('6290362349303', 20, 6, 'سيت هدايا خمرة', 6),
      line('6298043161305', 1.5, 12, 'معطر جسم ارت اوف نايتور11 /200مل لطافة برايد', 7),
      line('6290360599991', 12, 12, 'عطر مسمم / لطافة 4د', 8, 50000),
      line('6290360599992', 25, 6, 'عطر غنوة 100مل / نيش @', 9, 60000),
      ['', '', '', '', '', '***** انتهى *****'],
      ['', 29585, '', '', 2502],
    ])
    const r = await readSheetFile(file)
    expect(r.sheet).toBe('Table 1')
    expect(r.invoice).toMatchObject({ free: 2, known: 0 })
    expect(r.patches).toHaveLength(7)
    expect(r.patches[0]).toMatchObject({ name_ar: 'اطلس', brand: 'Lattafa', category: 'perfume', size: '55', unit: 'ml', cost_iqd: '16000', retail_iqd: '30000', stock: '12', barcode: '6290360593722' })
    expect(r.patches[1]).toMatchObject({ name_ar: 'اكير بانوفي', size: '100', stock: '12', barcode: '' })
    expect(r.patches[2]).toMatchObject({ name_ar: 'حابك للرجال', brand: 'Lattafa Pride', gender: 'men', size: '100' })
    expect(r.patches[3]).toMatchObject({ name_ar: 'سيت هدايا خمرة', category: 'set', size: '', retail_iqd: '', stock: '6' })
    expect(r.patches[4]).toMatchObject({ name_ar: 'معطر جسم ارت اوف نايتور11', category: 'mist', brand: 'Lattafa Pride', size: '200', cost_iqd: '2400' })
    expect(r.patches[5]).toMatchObject({ name_ar: 'مسمم', size: '' })
    expect(r.patches[6]).toMatchObject({ name_ar: 'غنوة', brand: 'Niche Emarati' })
    // a gift set needs only its price; a perfume or a mist also its size when the name has none
    expect(r.invoice!.need).toEqual([[], [], [], ['retail_iqd'], ['retail_iqd'], ['size'], []])
  })

  it('the selling price column may still have no title, and the cost may come from the dollar price × the rate', async () => {
    const head = ['الباركود', 'القيمة', 'الحسم', 'السعر', 'الكمية', 'المادة', 'ت', 'cost price in dinnar ', '', 'Rate (D × )', 1500]
    const r = await readSheetFile(await invoice([['6290360593722', 120, '', 10, 12, 'عطر اطلس 55مل / لطافة', 1, '', 30000]], head))
    expect(r.patches[0]).toMatchObject({ cost_iqd: '15000', retail_iqd: '30000' })
  })

  it('rows still missing a price or size wait; filled in, they are added with only the paid pieces in stock', async () => {
    const r = await readSheetFile(await invoice([
      line('6290360593722', 10, 12, 'عطر اطلس 55مل / لطافة', 1, 30000),
      line('6290360593722', 10, 1, 'عطر اطلس 55مل / لطافة', 2, '', true),
      line('6290360599991', 12, 12, 'عطر مسمم / لطافة 4د', 3, 50000),
    ]))
    const rows = r.patches.map((p) => row(p))
    const first = await saveSheetRows(rows, r.invoice!.need)
    expect(first[0]).toMatchObject({ ok: true, status: 'added' })
    expect(first[1]).toMatchObject({ ok: false, errors: { size: { key: 'sheet.err_needed' } } })
    const [second] = await saveSheetRows([{ ...rows[1], size: '100' }], [r.invoice!.need[1]])
    expect(second).toMatchObject({ ok: true, status: 'added' })
    const atlas = (await db.variants.where('barcode').equals('6290360593722').first())!
    expect([atlas.label, atlas.costIQD, atlas.retailIQD, atlas.wholesaleIQD]).toEqual(['55 ml', 16000, 30000, 30000])
    expect((await stockMap())[atlas.id]).toBe(12)
  })

  it('the next invoice: an item already on file gets its pieces added and its new prices, and keeps the rest', async () => {
    const first = await readSheetFile(await invoice([line('6290360593722', 10, 12, 'عطر اطلس 55مل / لطافة', 1, 30000)]))
    await saveSheetRows(first.patches.map((p) => row(p)), first.invoice!.need)
    const atlas = (await db.variants.where('barcode').equals('6290360593722').first())!
    await db.variants.update(atlas.id, { wholesaleIQD: 26000 })

    // the price went up; the selling price was left empty this time
    const next = await readSheetFile(await invoice([line('6290360593722', 11, 6, 'عطر اطلس 55مل / لطافة', 1), line('6290360593722', 11, 1, 'عطر اطلس 55مل / لطافة', 2, '', true)]))
    expect(next.invoice).toMatchObject({ known: 1, need: [[]] })
    expect(next.patches[0]).toMatchObject({ sku: atlas.sku, retail_iqd: '30000', wholesale_iqd: '26000', cost_iqd: '17600', stock: '6' })
    const before = await db.variants.count()
    const [res] = await saveSheetRows(next.patches.map((p) => row(p)), next.invoice!.need)
    expect(res).toMatchObject({ ok: true, status: 'updated', sku: atlas.sku })
    expect(await db.variants.count()).toBe(before)
    const after = (await db.variants.get(atlas.id))!
    expect([after.costIQD, after.retailIQD, after.wholesaleIQD]).toEqual([17600, 30000, 26000])
    expect((await stockMap())[atlas.id]).toBe(18)
    const mv = (await db.stockMovements.where('variantId').equals(atlas.id).toArray()).map((m) => [m.type, m.qty]).sort()
    expect(mv).toEqual([['opening', 12], ['purchase', 6]])
  })

  it('an item without a barcode is found again by its name and size; a note in the barcode cell is not a barcode', async () => {
    const items = (qty: number) => [
      line('', 12, qty, 'عطر اكير بانوفي 100مل / لطافة', 1, 33000),
      line('الباركود مكرر في اترنال عود', 13, qty, 'عطر ماسا 100مل / لطافة 4د', 2, 35000),
    ]
    const first = await readSheetFile(await invoice(items(12)))
    expect(first.patches.map((p) => p.barcode)).toEqual(['', ''])
    expect((await saveSheetRows(first.patches.map((p) => row(p)), first.invoice!.need)).every((x) => x.ok)).toBe(true)
    const next = await readSheetFile(await invoice(items(6)))
    expect(next.invoice!.known).toBe(2)
    const res = await saveSheetRows(next.patches.map((p) => row(p)), next.invoice!.need)
    expect(res.map((x) => x.ok && x.status)).toEqual(['updated', 'updated'])
    const stock = await stockMap()
    for (const x of res) expect(stock[(await db.variants.where('sku').equals((x as { sku: string }).sku).first())!.id]).toBe(18)
  })
})
