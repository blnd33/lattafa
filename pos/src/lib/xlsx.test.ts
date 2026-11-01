import { describe, expect, it } from 'vitest'
import { colName, crc32, readXlsx, unzip, writeXlsx, zip } from './xlsx'

const bytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer())

describe('xlsx', () => {
  it('zip basics: CRC-32 and a round trip through deflate', async () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
    const files = await unzip(await zip([{ name: 'a.txt', data: new TextEncoder().encode('hello '.repeat(200)) }, { name: 'ب.txt', data: new Uint8Array([1, 2, 3]) }]))
    expect(new TextDecoder().decode(files.get('a.txt'))).toBe('hello '.repeat(200))
    expect([...files.get('ب.txt')!]).toEqual([1, 2, 3])
    expect([colName(0), colName(25), colName(26), colName(27)]).toEqual(['A', 'Z', 'AA', 'AB'])
  })

  it('writes a workbook and reads the same values back', async () => {
    const blob = await writeXlsx([
      {
        name: 'Products', rtl: true, lists: { 2: ['men', 'women'] },
        columns: [{ width: 20 }, { width: 10, number: true }, { width: 10 }, { width: 18, text: true }],
        rows: [['Name', 'Price', 'For', 'Barcode'], ['خمرة & <Khamrah>', 36000, 'men', '0062911'], ['Asad "100"', 3.4, '', 6291108730515], [], ['Last', null, 'women', '']],
      },
      { name: 'Help: notes', header: false, columns: [{ width: 80 }], rows: [['line one'], ['line two']] },
    ])
    expect(blob.type).toContain('spreadsheetml')
    const sheets = await readXlsx(await bytes(blob))
    expect(sheets.map((s) => s.name)).toEqual(['Products', 'Help  notes']) // ":" is not allowed in a sheet name
    expect(sheets[0].rows).toEqual([
      ['Name', 'Price', 'For', 'Barcode'],
      ['خمرة & <Khamrah>', '36000', 'men', '0062911'], // a text column keeps leading zeros
      ['Asad "100"', '3.4', '', '6291108730515'],
      [],
      ['Last', '', 'women'],
    ])
    expect(sheets[1].rows).toEqual([['line one'], ['line two']])
  })

  it('reads files as Excel writes them: shared strings, rich text, prefixes, floats, booleans', async () => {
    const enc = new TextEncoder()
    const file = await zip([
      { name: 'xl/workbook.xml', data: enc.encode('<x:workbook xmlns:x="m" xmlns:r="rel"><x:sheets><x:sheet name="Data &amp; more" sheetId="1" r:id="rId7"/></x:sheets></x:workbook>') },
      { name: 'xl/_rels/workbook.xml.rels', data: enc.encode('<Relationships><Relationship Id="rId7" Target="worksheets/data.xml" Type="ws"/></Relationships>') },
      { name: 'xl/sharedStrings.xml', data: enc.encode('<sst><si><t>Name</t></si><si><r><t>Kham</t></r><r><t xml:space="preserve">rah </t></r><rPh><t>x</t></rPh></si><si><t>عطر &#1575;</t></si></sst>') },
      { name: 'xl/worksheets/data.xml', data: enc.encode('<x:worksheet><x:sheetData><x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="C1" t="str"><x:v>=1</x:v></x:c></x:row><x:row r="3"><x:c r="A3" t="s"><x:v>1</x:v></x:c><x:c r="B3"><x:v>3.3999999999999999</x:v></x:c><x:c r="C3" t="b"><x:v>1</x:v></x:c><x:c r="D3"><x:v>6.291108730515E+12</x:v></x:c><x:c r="E3" t="s"><x:v>2</x:v></x:c></x:row></x:sheetData></x:worksheet>') },
    ])
    const [s] = await readXlsx(file)
    expect(s.name).toBe('Data & more')
    expect(s.rows).toEqual([['Name', '', '=1'], [], ['Khamrah ', '3.4', 'TRUE', '6291108730515', 'عطر ا']])
  })

  it('refuses something that is not a workbook', async () => {
    await expect(readXlsx(new TextEncoder().encode('just text, not a zip'))).rejects.toThrow()
  })
})
