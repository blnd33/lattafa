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
