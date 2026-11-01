/**
 * A small, dependency-free Excel (.xlsx) writer and reader — just enough for product lists.
 *
 * An .xlsx file is a zip of XML files. Writing: one or more sheets of text/number cells, bold coloured header rows,
 * column widths, a frozen header, right-to-left sheets, "text" columns (so Excel keeps barcode zeros) and dropdown
 * lists. Reading: the cell values of a sheet as text, whatever wrote the file (Excel, Google Sheets, LibreOffice,
 * Numbers). Compression uses the browser's own CompressionStream / DecompressionStream ("deflate-raw").
 */

/* ───────── zip ───────── */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 }
  return t
})()
export function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(stream))
  return new Uint8Array(await out.arrayBuffer())
}
const deflate = (d: Uint8Array) => pipe(d, new CompressionStream('deflate-raw'))
const inflate = (d: Uint8Array) => pipe(d, new DecompressionStream('deflate-raw'))

export async function zip(files: { name: string; data: Uint8Array }[]): Promise<Uint8Array> {
  const enc = new TextEncoder()
  const chunks: Uint8Array[] = [], central: Uint8Array[] = []
  let offset = 0
  const now = new Date()
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()
  for (const f of files) {
    const name = enc.encode(f.name)
    const packed = await deflate(f.data)
    const crc = crc32(f.data)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 8, true)
    local.setUint16(10, time, true); local.setUint16(12, date, true); local.setUint32(14, crc, true)
    local.setUint32(18, packed.length, true); local.setUint32(22, f.data.length, true); local.setUint16(26, name.length, true)
    chunks.push(new Uint8Array(local.buffer), name, packed)
    const cd = new DataView(new ArrayBuffer(46))
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true); cd.setUint16(10, 8, true)
    cd.setUint16(12, time, true); cd.setUint16(14, date, true); cd.setUint32(16, crc, true); cd.setUint32(20, packed.length, true)
    cd.setUint32(24, f.data.length, true); cd.setUint16(28, name.length, true); cd.setUint32(42, offset, true)
    central.push(new Uint8Array(cd.buffer), name)
    offset += 30 + name.length + packed.length
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true)
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true)
  const all = [...chunks, ...central, new Uint8Array(end.buffer)]
  const out = new Uint8Array(all.reduce((a, c) => a + c.length, 0))
  let p = 0
  for (const c of all) { out.set(c, p); p += c.length }
  return out
}

/** The files of a zip, by name (only stored and deflated entries — what every spreadsheet program writes). */
export async function unzip(buf: Uint8Array): Promise<Map<string, Uint8Array>> {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) throw new Error('not_zip')
  const count = v.getUint16(eocd + 10, true)
  let p = v.getUint32(eocd + 16, true)
  const dec = new TextDecoder()
  const out = new Map<string, Uint8Array>()
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('bad_zip')
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true)
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true)
    const local = v.getUint32(p + 42, true)
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen))
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true)
    const raw = buf.subarray(start, start + size)
    if (method === 0) out.set(name, raw)
    else if (method === 8) out.set(name, await inflate(raw))
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

/* ───────── writing ───────── */

export type CellValue = string | number | null | undefined
export interface SheetColumn { width: number; text?: boolean; number?: boolean }
export interface SheetSpec {
  name: string
  columns: SheetColumn[]
  /** first row = header (bold, gold) unless `header` is false */
  rows: CellValue[][]
  header?: boolean
  rtl?: boolean
  /** dropdown lists: column index → allowed values (shown as a list in the cell) */
  lists?: Record<number, string[]>
  /** extra rows styled as headings (bold), by row index */
  bold?: number[]
}

const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // characters XML 1.0 does not allow at all
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
export const colName = (i: number) => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s }

// cell styles (index into cellXfs): 0 normal · 1 header · 2 text · 3 number · 4 wrapped · 5 bold
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FF1A1714"/><name val="Calibri"/></font><font><b/><sz val="13"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD4A548"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

function sheetXml(s: SheetSpec): string {
  const header = s.header !== false
  const colStyle = (c?: SheetColumn) => (c?.text ? 2 : c?.number ? 3 : 0)
  const rows = s.rows.map((cells, r) => {
    const xs = cells.map((v, c) => {
      if (v === null || v === undefined || v === '') return ''
      const ref = `${colName(c)}${r + 1}`
      const style = header && r === 0 ? 1 : s.bold?.includes(r) ? 5 : s.columns[c]?.width && s.columns[c].width > 60 ? 4 : colStyle(s.columns[c])
      if (typeof v === 'number' && Number.isFinite(v) && !(s.columns[c]?.text)) return `<c r="${ref}" s="${style}"><v>${v}</v></c>`
      return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(String(v))}</t></is></c>`
    }).join('')
    return `<row r="${r + 1}">${xs}</row>`
  }).join('')
  const cols = s.columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"${colStyle(c) ? ` style="${colStyle(c)}"` : ''}/>`).join('')
  const pane = header ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>' : ''
  const lists = Object.entries(s.lists ?? {}).map(([c, values]) => {
    const col = colName(Number(c))
    return `<dataValidation type="list" allowBlank="1" showErrorMessage="0" sqref="${col}2:${col}5000"><formula1>"${xmlEsc(values.join(','))}"</formula1></dataValidation>`
  })
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"${s.rtl ? ' rightToLeft="1"' : ''}>${pane}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${rows}</sheetData>${lists.length ? `<dataValidations count="${lists.length}">${lists.join('')}</dataValidations>` : ''}
<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`
}

/** Builds an .xlsx file from sheets of plain values. */
export async function writeXlsx(sheets: SheetSpec[]): Promise<Blob> {
  const enc = new TextEncoder()
  // sheet names: max 31 characters, none of []:*?/\ and unique
  const names = sheets.map((s, i) => (s.name.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31).trim() || `Sheet${i + 1}`))
  const files = [
    { name: '[Content_Types].xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
    { name: '_rels/.rels', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${names.map((n, i) => `<sheet name="${xmlEsc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', text: STYLES },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, text: sheetXml(s) })),
  ]
  const bytes = await zip(files.map((f) => ({ name: f.name, data: enc.encode(f.text) })))
  return new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

/* ───────── reading ───────── */

const xmlUnesc = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e: string) => {
  const k = e.toLowerCase()
  if (k === 'amp') return '&'
  if (k === 'lt') return '<'
  if (k === 'gt') return '>'
  if (k === 'quot') return '"'
  if (k === 'apos') return "'"
  const code = k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10)
  return Number.isFinite(code) ? String.fromCodePoint(code) : m
})
const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1]
/** All the text runs inside a string item, leaving out phonetic guides (<rPh>). */
const runsText = (xml: string) => xmlUnesc([...xml.replace(/<(\w+:)?rPh\b[\s\S]*?<\/(\w+:)?rPh>/g, '').matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((m) => m[1]).join(''))
const colIndex = (ref: string) => { let n = 0; for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1 }
/** 35000 → "35000", 3.3999999999999999 → "3.4", 6.291108730515E+12 → "6291108730515". */
const numText = (v: string) => { const n = Number(v); return Number.isFinite(n) ? (Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(12)))) : v }

export interface XlsxSheet { name: string; rows: string[][] }

/** Every sheet of an .xlsx file, as rows of cell text. */
export async function readXlsx(data: ArrayBuffer | Uint8Array): Promise<XlsxSheet[]> {
  const files = await unzip(data instanceof Uint8Array ? data : new Uint8Array(data))
  const text = (path: string) => { const f = files.get(path) ?? files.get(path.replace(/^\//, '')); return f ? new TextDecoder().decode(f) : '' }
  const book = text('xl/workbook.xml')
  if (!book) throw new Error('not_xlsx')
  const rels = new Map([...text('xl/_rels/workbook.xml.rels').matchAll(/<(?:\w+:)?Relationship\b[^>]*>/g)].map((m) => [attr(m[0], 'Id') ?? '', attr(m[0], 'Target') ?? '']))
  const shared = [...text('xl/sharedStrings.xml').matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g)].map((m) => runsText(m[1]))
  const sheets: XlsxSheet[] = []
  for (const m of book.matchAll(/<(?:\w+:)?sheet\b[^>]*>/g)) {
    const target = rels.get(attr(m[0], 'r:id') ?? attr(m[0], '\\w+:id') ?? '') ?? ''
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
    const xml = text(path)
    const rows: string[][] = []
    let next = 0
    for (const rm of xml.matchAll(/<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g)) {
      const r = Number(attr(rm[1], 'r') ?? next + 1) - 1
      next = r + 1
      const cells: string[] = []
      let col = 0
      for (const cm of (rm[2] ?? '').matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
        const ref = attr(cm[1], 'r')
        const c = ref ? colIndex(ref) : col
        col = c + 1
        const type = attr(cm[1], 't') ?? 'n'
        const inner = cm[2] ?? ''
        const v = /<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/.exec(inner)?.[1]
        let value = ''
        if (type === 's') value = shared[Number(v)] ?? ''
        else if (type === 'inlineStr') value = runsText(inner)
        else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE'
        else if (type === 'str' || type === 'e') value = xmlUnesc(v ?? '')
        else value = v === undefined ? '' : numText(v)
        cells[c] = value
      }
      rows[r] = Array.from(cells, (x) => x ?? '')
    }
    sheets.push({ name: xmlUnesc(attr(m[0], 'name') ?? ''), rows: Array.from(rows, (x) => x ?? []) })
  }
  return sheets
}
