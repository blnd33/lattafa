import { AppError } from '@/services/context'
import { api } from '@/services/api'
import type { MenuManage } from './api'

/**
 * Photos/videos behind the top of the customer menu: checked and prepared in the browser, then sent to the server in
 * pieces (backend/app/Services/MenuMedia.php) — so a video gets through any upload limit and a dropped connection
 * carries on where it stopped.
 */
export const HERO_MAX = 6
export const HERO_ACCEPT = 'image/jpeg,image/png,image/webp,video/mp4,video/webm'
const LIMIT = { image: 10 * 1024 * 1024, video: 60 * 1024 * 1024 }

export interface Prepared { blob: Blob; type: 'image' | 'video'; poster: string | null }

/** Big photos are made lighter (guests open the menu on mobile data); a video must play in a browser. */
export async function prepare(file: File): Promise<Prepared> {
  const type = file.type.startsWith('video/') ? 'video' : file.type.startsWith('image/') ? 'image' : null
  if (!type || !HERO_ACCEPT.split(',').includes(file.type)) throw new AppError('media_type')
  if (file.size > LIMIT[type]) throw new AppError('media_too_big', { mb: LIMIT[type] / 1024 / 1024 })
  if (type === 'image') return { blob: await shrink(file), type, poster: null }
  return { blob: file, type, poster: await firstFrame(file) }
}

/** A photo at most 2400 px on its longest side, as WebP (or JPEG where the browser can't make WebP). */
async function shrink(file: File, maxSide = 2400): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
  // already small and light: keep it exactly as it is
  if (scale === 1 && file.size < 1.5 * 1024 * 1024 && file.type !== 'image/png') { bmp.close(); return file }
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bmp.width * scale))
  canvas.height = Math.max(1, Math.round(bmp.height * scale))
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close()
  const as = (mime: string) => new Promise<Blob | null>((ok) => canvas.toBlob(ok, mime, 0.85))
  const webp = await as('image/webp')
  return webp && webp.type === 'image/webp' ? webp : ((await as('image/jpeg')) ?? file)
}

/** The video's first moment as a small JPEG — and proof that a browser can play it (iPhone "High Efficiency" videos can't). */
async function firstFrame(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  const v = document.createElement('video')
  v.muted = true
  v.playsInline = true
  v.preload = 'auto'
  try {
    await new Promise<void>((ok, fail) => {
      const timer = setTimeout(() => fail(new AppError('media_unplayable')), 20_000)
      v.onloadeddata = () => { clearTimeout(timer); ok() }
      v.onerror = () => { clearTimeout(timer); fail(new AppError('media_unplayable')) }
      v.src = url
    })
    if (!v.videoWidth) throw new AppError('media_unplayable')
    await new Promise<void>((ok) => { v.onseeked = () => ok(); v.currentTime = Math.min(0.5, (v.duration || 1) / 2) })
    const scale = Math.min(1, 1280 / v.videoWidth)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(v.videoWidth * scale)
    canvas.height = Math.round(v.videoHeight * scale)
    canvas.getContext('2d')!.drawImage(v, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.8)
  } finally {
    v.removeAttribute('src')
    v.load()
    URL.revokeObjectURL(url)
  }
}

/** Sends the file piece by piece (`onProgress` 0…1) and returns the menu as it is now. */
export async function uploadHero(p: Prepared, onProgress: (done: number) => void): Promise<MenuManage> {
  const mime = p.blob.type || (p.type === 'video' ? 'video/mp4' : 'image/jpeg')
  const { uploadId, chunkBytes } = await api<{ uploadId: string; chunkBytes: number }>('POST', '/menu/media', { mime, size: p.blob.size })
  let at = 0
  let retries = 0
  while (at < p.blob.size) {
    try {
      const r = await api<{ received: number }>('PUT', `/menu/media/${uploadId}/part?at=${at}`, p.blob.slice(at, at + chunkBytes), { timeoutMs: 120_000 })
      at = r.received
      retries = 0
    } catch (e) {
      // the server already has more than we thought (an answer got lost): carry on from there
      if (e instanceof AppError && e.code === 'media_offset' && typeof e.params.at === 'number') { at = e.params.at; continue }
      if (e instanceof AppError && e.code === 'offline' && retries < 3) { retries++; await new Promise((ok) => setTimeout(ok, 1500 * retries)); continue }
      throw e
    }
    onProgress(at / p.blob.size)
  }
  return api<MenuManage>('POST', `/menu/media/${uploadId}/finish`, { poster: p.poster }, { timeoutMs: 60_000 })
}
