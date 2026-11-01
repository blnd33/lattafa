/**
 * Resize an uploaded product photo in the browser (max side 1000 px — sharp on the customer menu's big view —
 * WebP/JPEG) and return a small data URL — keeps IndexedDB light and works fully offline. A cut-out bottle keeps
 * its see-through background in WebP, so it sits on the dark menu cards; only the JPEG fallback gets white behind it.
 */
export async function fileToResizedDataUrl(file: File, maxSide = 1000, quality = 0.82): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('not_an_image')
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * scale))
  const h = Math.max(1, Math.round(bmp.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas_unavailable')
  ctx.drawImage(bmp, 0, 0, w, h)
  const webp = canvas.toDataURL('image/webp', quality)
  if (webp.startsWith('data:image/webp')) { bmp.close(); return webp }
  // this browser can't make WebP: JPEG has no see-through, so white goes behind the photo
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  return canvas.toDataURL('image/jpeg', quality)
}

/** Save text as a file (CSV / JSON) using a temporary link. */
export function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8') {
  downloadBlob(filename, new Blob([text], { type: mime }))
}

/** Save any file (e.g. an Excel workbook) using a temporary link. */
export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
