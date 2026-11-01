/**
 * Code 128 barcode encoder (subset B, with subset C for long digit runs).
 * Used for product labels and the receipt barcode (so a receipt can be scanned
 * at the returns desk). Output is plain bar widths — rendered as SVG by <Barcode/>.
 */

// Each pattern is the six bar/space widths (b s b s b s) — index = symbol value 0..106
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
]

const START_B = 104
const START_C = 105
const CODE_B = 100
const STOP = 106

/** Returns the symbol values (including start, checksum and stop). */
export function encode128(text: string): number[] {
  const codes: number[] = []
  const digitsOnly = /^\d+$/.test(text)
  let i = 0
  let mode: 'B' | 'C'
  if (digitsOnly && text.length >= 4 && text.length % 2 === 0) {
    mode = 'C'
    codes.push(START_C)
  } else {
    mode = 'B'
    codes.push(START_B)
  }
  while (i < text.length) {
    if (mode === 'C') {
      if (i + 1 < text.length && /^\d\d$/.test(text.slice(i, i + 2))) {
        codes.push(parseInt(text.slice(i, i + 2), 10))
        i += 2
      } else {
        codes.push(CODE_B)
        mode = 'B'
      }
    } else {
      const c = text.charCodeAt(i)
      if (c < 32 || c > 126) throw new Error(`Code128: unsupported character "${text[i]}"`)
      codes.push(c - 32)
      i += 1
    }
  }
  let sum = codes[0]
  for (let k = 1; k < codes.length; k++) sum += codes[k] * k
  codes.push(sum % 103)
  codes.push(STOP)
  return codes
}

export interface BarcodeGeometry {
  /** total width in modules */
  width: number
  /** x, width pairs of every dark bar, in modules */
  bars: [number, number][]
}

export function code128Bars(text: string): BarcodeGeometry {
  const codes = encode128(text)
  const bars: [number, number][] = []
  let x = 10 // quiet zone
  for (const code of codes) {
    const pat = PATTERNS[code]
    for (let j = 0; j < pat.length; j++) {
      const w = parseInt(pat[j], 10)
      if (j % 2 === 0) bars.push([x, w])
      x += w
    }
  }
  return { width: x + 10, bars }
}

/** Standalone SVG string (for inserting in print windows / downloads). */
export function code128Svg(text: string, height = 48, moduleWidth = 1.6): string {
  const g = code128Bars(text)
  const w = g.width * moduleWidth
  const rects = g.bars.map(([x, bw]) => `<rect x="${x * moduleWidth}" y="0" width="${bw * moduleWidth}" height="${height}"/>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${height}" width="${w}" height="${height}" fill="#000" shape-rendering="crispEdges">${rects}</svg>`
}

/** EAN-13 check digit for a 12-digit body. */
export function ean13CheckDigit(body12: string): number {
  let s = 0
  for (let i = 0; i < 12; i++) s += parseInt(body12[i], 10) * (i % 2 === 0 ? 1 : 3)
  return (10 - (s % 10)) % 10
}

/** Generate an internal EAN-13 (prefix 200 = in-store use range) from a running number. */
export function internalEan13(seq: number): string {
  const body = ('200' + String(seq).padStart(9, '0')).slice(0, 12)
  return body + ean13CheckDigit(body)
}
