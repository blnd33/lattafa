import { useId, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Film, Image as ImageIcon, ImagePlus, Trash2 } from 'lucide-react'
import type { HeroMedia } from '@menu/api'
import { Button, IconButton } from '@/components/ui/Button'
import { Card } from '@/components/ui/Controls'
import { useConfirm } from '@/components/ui/Modal'
import { useAction } from '@/hooks/queries'
import { errorMessage, useT } from '@/i18n'
import { toast } from '@/store/toast'
import { deleteHero, move, orderHero, type MenuManage } from './api'
import { HERO_ACCEPT, HERO_MAX, prepare, uploadHero } from './media'

const ON_MEDIA = 'bg-black/65 text-white hover:bg-black/85'

/**
 * The photos/videos behind the top of the customer menu. Adding, deleting and reordering them is saved straight away
 * (they are files on the server); how much they are darkened goes with "Save menu" like the other settings.
 */
export function HeroCard({ items, dim, ro, onDim, onChange }: {
  items: HeroMedia[]; dim: number; ro: boolean
  onDim: (v: number) => void
  /** the menu as the server has it after a change */
  onChange: (m: MenuManage) => void
}) {
  const t = useT()
  const confirm = useConfirm()
  const dimId = useId()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<{ name: string; done: number; sending: boolean } | null>(null)
  const del = useAction(deleteHero, { success: 'mn.hero_deleted' })
  const order = useAction(orderHero)
  const full = items.length >= HERO_MAX
  const pickFiles = () => input.current?.click()

  const add = async (files: File[]) => {
    let count = items.length
    for (const file of files) { // several at once: one after the other
      if (count >= HERO_MAX) { toast.error(t('err.media_full', { n: HERO_MAX })); break }
      setBusy({ name: file.name, done: 0, sending: false })
      try {
        const p = await prepare(file)
        setBusy({ name: file.name, done: 0, sending: true })
        const m = await uploadHero(p, (done) => setBusy({ name: file.name, done, sending: true }))
        onChange(m)
        count = m.menu.hero.length
        toast.success(t('mn.hero_added'))
      } catch (e) {
        toast.error(errorMessage(e, t))
      }
    }
    setBusy(null)
  }
  const remove = async (m: HeroMedia, i: number) => {
    if (!(await confirm({ title: t('mn.hero_delete_q', { n: i + 1 }), message: t('mn.hero_delete_hint'), confirmLabel: t('common.delete'), danger: true }))) return
    const r = await del(m.id)
    if (r && typeof r === 'object') onChange(r)
  }
  const step = async (i: number, by: number) => {
    const r = await order(move(items.map((m) => m.id), i, i + by))
    if (r && typeof r === 'object') onChange(r)
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-60">
          <h2 className="font-semibold">{t('mn.hero')}</h2>
          <p className="mt-0.5 text-xs text-fg-2">{t('mn.hero_hint')}</p>
          {ro && <p className="mt-1 text-xs text-fg-2">{t('mn.settings_ro')}</p>}
        </div>
        {!ro && items.length > 0 && <Button icon={<ImagePlus className="size-5" />} disabled={full || !!busy} onClick={pickFiles}>{t('mn.hero_add')}</Button>}
        <input ref={input} type="file" accept={HERO_ACCEPT} multiple hidden tabIndex={-1}
          onChange={(e) => { const files = [...(e.target.files ?? [])]; e.target.value = ''; void add(files) }} />
      </div>

      {busy && (
        <div className="mt-3 rounded-xl bg-surface-2 p-3" role="status">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">{t(busy.sending ? 'mn.hero_sending' : 'mn.hero_preparing', { name: busy.name })}</span>
            {busy.sending && <span className="num shrink-0 text-fg-2">{Math.round(busy.done * 100)}%</span>}
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
            <div className={busy.sending ? 'h-full rounded-full bg-gold transition-[width]' : 'h-full w-1/3 animate-pulse rounded-full bg-gold/60'} style={busy.sending ? { width: `${busy.done * 100}%` } : undefined} />
          </div>
        </div>
      )}

      {!items.length ? (
        <button type="button" disabled={ro || !!busy} onClick={pickFiles}
          className="mt-3 flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line px-4 py-8 text-center text-sm text-fg-2 transition enabled:hover:border-gold enabled:hover:text-fg disabled:opacity-60">
          <ImagePlus className="size-8 text-gold-text" />
          {!ro && <span className="font-semibold text-fg">{t('mn.hero_add')}</span>}
          <span className="max-w-sm">{t('mn.hero_empty')}</span>
        </button>
      ) : (
        <ul aria-label={t('mn.hero')} className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {items.map((m, i) => (
            <li key={m.id} className="relative aspect-video overflow-hidden rounded-xl border border-line bg-ink">
              {m.type === 'video'
                ? <video src={m.src} poster={m.poster ?? undefined} muted playsInline preload="metadata" className="size-full object-cover" />
                : <img src={m.src} alt="" loading="lazy" className="size-full object-cover" />}
              <span className="absolute start-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/65 px-2 py-0.5 text-[11px] font-semibold text-white">
                {m.type === 'video' ? <Film className="size-3.5" /> : <ImageIcon className="size-3.5" />}
                <span className="num">{i + 1}</span> · {t(m.type === 'video' ? 'mn.hero_video' : 'mn.hero_photo')}
              </span>
              {!ro && (
                <div className="absolute inset-x-1.5 bottom-1.5 flex items-center justify-between gap-1">
                  <div className="flex gap-1">
                    <IconButton size="sm" className={ON_MEDIA} label={t('mn.hero_earlier', { n: i + 1 })} disabled={i === 0 || order.busy} onClick={() => void step(i, -1)}><ChevronLeft className="size-5 rtl:rotate-180" /></IconButton>
                    <IconButton size="sm" className={ON_MEDIA} label={t('mn.hero_later', { n: i + 1 })} disabled={i === items.length - 1 || order.busy} onClick={() => void step(i, 1)}><ChevronRight className="size-5 rtl:rotate-180" /></IconButton>
                  </div>
                  <IconButton size="sm" className="bg-black/65 text-white hover:bg-danger" label={t('mn.hero_delete', { n: i + 1 })} disabled={del.busy} onClick={() => void remove(m, i)}><Trash2 className="size-4" /></IconButton>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {items.length > 0 && (
        <div className="mt-4">
          <label htmlFor={dimId} className="flex items-baseline justify-between gap-3 text-sm font-medium">
            <span>{t('mn.hero_dim')}</span><span className="num text-fg-2">{dim}%</span>
          </label>
          <input id={dimId} type="range" min={0} max={85} step={5} value={dim} disabled={ro} onChange={(e) => onDim(Number(e.target.value))}
            className="mt-2 w-full accent-[#D4A548] disabled:opacity-60" />
          <p className="text-xs text-fg-2">{t('mn.hero_dim_hint')}</p>
        </div>
      )}
      {!ro && full && <p className="mt-2 text-xs text-fg-2">{t('mn.hero_full', { n: HERO_MAX })}</p>}
    </Card>
  )
}
