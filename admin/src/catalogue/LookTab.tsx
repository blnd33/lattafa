import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, ImagePlus, Save } from 'lucide-react'
import { Button, IconButton } from '@/components/ui/Button'
import { Badge, Card, Spinner } from '@/components/ui/Controls'
import { Field, Input, Textarea } from '@/components/ui/Field'
import { cn } from '@/components/ui/cn'
import { errorMessage, useT } from '@/i18n'
import { fileToResizedDataUrl } from '@/lib/image'
import { toast } from '@/store/toast'
import * as cat from './api'
import { Setting } from './Setting'

/**
 * How the wholesale catalogue looks.
 *
 * The colours and wordmark that ship are this system's house theme, **not** Lattafa's own brand kit — nobody has
 * supplied one, and inventing official branding is exactly what the brief forbids. So the catalogue carries a
 * "provisional" mark in its footer until whoever has the real kit puts it in here and turns the mark off.
 *
 * The homepage is a list of sections in the owner's order. The catalogue draws what is listed, in this order, and
 * nothing else — so moving "Collections" above "Featured" moves it on the real page.
 */
export function LookTab({ canEdit }: { canEdit: boolean }) {
  const t = useT()
  const look = useQuery({ queryKey: ['cat-appearance'], queryFn: cat.getAppearance })
  const [brand, setBrand] = useState<cat.Brand | null>(null)
  const [homepage, setHomepage] = useState<cat.Homepage | null>(null)
  const [footer, setFooter] = useState<cat.Footer | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    if (!look.data) return
    setBrand(look.data.brand)
    setHomepage(look.data.homepage)
    setFooter(look.data.footer)
  }, [look.data])

  if (look.isLoading || !brand || !homepage || !footer) return <div className="grid h-60 place-items-center"><Spinner className="size-9" /></div>

  const save = async (key: 'brand' | 'homepage' | 'footer', patch: Record<string, unknown>) => {
    setBusy(key)
    try {
      await cat.saveAppearance(key, patch)
      await look.refetch()
      toast.success(t('wc.look_saved'))
    } catch (e) { toast.error(errorMessage(e, t)) } finally { setBusy(null) }
  }

  const pickHero = async (file?: File) => {
    if (!file) return
    setBusy('hero')
    try {
      await cat.setHero(await fileToResizedDataUrl(file, 1600))
      await look.refetch()
      toast.success(t('wc.look_saved'))
    } catch (e) { toast.error(errorMessage(e, t)) } finally { setBusy(null) }
  }

  const move = (i: number, by: number) => {
    const next = [...homepage.sections]
    const to = i + by
    if (to < 0 || to >= next.length) return
    ;[next[i], next[to]] = [next[to]!, next[i]!]
    setHomepage({ ...homepage, sections: next })
  }

  return (
    <div className="space-y-4">
      {/* the theme */}
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-serif text-lg">{t('wc.the_look')}</h3>
            <p className="text-sm text-fg-2">{t('wc.the_look_hint')}</p>
          </div>
          {brand.provisional && <Badge tone="warn">{t('wc.provisional')}</Badge>}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(['ink', 'ivory', 'gold'] as const).map((key) => (
            <Field key={key} label={t(`wc.colour_${key}`)}>
              {(id) => (
                <div className="flex items-center gap-2">
                  {/* its own label: the field's own belongs to the hex box, and two controls named the same is a maze */}
                  <input type="color" aria-label={t('wc.pick_colour', { name: t(`wc.colour_${key}`) })} disabled={!canEdit} value={brand[key]}
                    onChange={(e) => setBrand({ ...brand, [key]: e.target.value })}
                    className="size-11 shrink-0 cursor-pointer rounded-xl border border-line bg-surface p-1" />
                  <Input id={id} dir="ltr" className="num uppercase" disabled={!canEdit} value={brand[key]} onChange={(e) => setBrand({ ...brand, [key]: e.target.value })} />
                </div>
              )}
            </Field>
          ))}
          <Field label={t('wc.wordmark')}>{(id) => <Input id={id} disabled={!canEdit} value={brand.wordmark} onChange={(e) => setBrand({ ...brand, wordmark: e.target.value })} />}</Field>
          <Field label={t('wc.tagline')}>{(id) => <Input id={id} disabled={!canEdit} value={brand.tagline} onChange={(e) => setBrand({ ...brand, tagline: e.target.value })} />}</Field>
        </div>

        <div className="mt-3 rounded-xl bg-surface-2 p-3">
          <Setting checked={brand.provisional} disabled={!canEdit} onChange={(v) => setBrand({ ...brand, provisional: v })}
            label={t('wc.provisional_on')} hint={t('wc.provisional_hint')} />
        </div>

        {canEdit && (
          <div className="mt-3 flex justify-end">
            <Button icon={<Save className="size-5" />} loading={busy === 'brand'} onClick={() => void save('brand', { ...brand })}>{t('common.save')}</Button>
          </div>
        )}
      </Card>

      {/* the homepage */}
      <Card>
        <h3 className="mb-1 font-serif text-lg">{t('wc.the_homepage')}</h3>
        <p className="mb-3 text-sm text-fg-2">{t('wc.the_homepage_hint')}</p>

        <div className="grid gap-3">
          <Field label={t('wc.headline')} hint={t('wc.headline_hint')}>
            {(id) => <Input id={id} disabled={!canEdit} value={homepage.headline} onChange={(e) => setHomepage({ ...homepage, headline: e.target.value })} />}
          </Field>
          <Field label={t('wc.lead')} hint={t('wc.headline_hint')}>
            {(id) => <Textarea id={id} rows={2} disabled={!canEdit} value={homepage.lead} onChange={(e) => setHomepage({ ...homepage, lead: e.target.value })} />}
          </Field>
        </div>

        <div className="mt-4">
          <p className="mb-2 text-sm font-medium">{t('wc.hero_picture')}</p>
          <div className="flex flex-wrap items-center gap-3">
            {homepage.hero
              ? <img src={homepage.hero} alt="" className="h-24 w-40 rounded-xl border border-line object-cover" />
              : <div className="grid h-24 w-40 place-items-center rounded-xl border border-dashed border-line text-xs text-fg-2">{t('wc.no_picture')}</div>}
            {canEdit && (
              <div className="flex gap-2">
                <label className="inline-flex">
                  <input type="file" hidden accept="image/*" onChange={(e) => { void pickHero(e.target.files?.[0]); e.target.value = '' }} />
                  <span className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-surface-2 px-4 text-sm font-semibold">
                    <ImagePlus className="size-5" />{busy === 'hero' ? <Spinner className="size-4" /> : t('wc.choose_picture')}
                  </span>
                </label>
                {homepage.hero && (
                  <Button variant="secondary" onClick={async () => { setBusy('hero'); try { await cat.setHero(null); await look.refetch() } finally { setBusy(null) } }}>
                    {t('common.remove')}
                  </Button>
                )}
              </div>
            )}
          </div>
          <p className="mt-2 text-xs text-fg-2">{t('wc.hero_hint')}</p>
        </div>

        <div className="mt-5">
          <p className="mb-2 text-sm font-medium">{t('wc.sections')}</p>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
            {homepage.sections.map((s, i) => (
              <li key={s.key} className={cn('flex items-center gap-3 px-3 py-2.5', !s.on && 'opacity-60')}>
                <span className="num w-5 text-xs text-fg-2">{i + 1}</span>
                <span className="min-w-0 flex-1 text-sm">{t(`wc.section_${s.key}`)}</span>
                {canEdit && (
                  <>
                    <Setting checked={s.on} onChange={(on) => setHomepage({ ...homepage, sections: homepage.sections.map((x) => (x.key === s.key ? { ...x, on } : x)) })} label={t('wc.section_on')} />
                    <IconButton label={t('wc.move_up')} variant="ghost" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="size-4" /></IconButton>
                    <IconButton label={t('wc.move_down')} variant="ghost" disabled={i === homepage.sections.length - 1} onClick={() => move(i, 1)}><ArrowDown className="size-4" /></IconButton>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>

        {canEdit && (
          <div className="mt-3 flex justify-end">
            <Button icon={<Save className="size-5" />} loading={busy === 'homepage'}
              onClick={() => void save('homepage', { headline: homepage.headline, lead: homepage.lead, sections: homepage.sections })}>
              {t('common.save')}
            </Button>
          </div>
        )}
      </Card>

      {/* the foot of the page */}
      <Card>
        <h3 className="mb-1 font-serif text-lg">{t('wc.the_footer')}</h3>
        <p className="mb-3 text-sm text-fg-2">{t('wc.the_footer_hint')}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {(['email', 'phone', 'instagram', 'website'] as const).map((key) => (
            <Field key={key} label={t(`wc.footer_${key}`)}>
              {(id) => <Input id={id} dir="ltr" disabled={!canEdit} value={footer[key]} onChange={(e) => setFooter({ ...footer, [key]: e.target.value })} />}
            </Field>
          ))}
        </div>
        <Field label={t('wc.footer_note')} className="mt-3">
          {(id) => <Textarea id={id} rows={2} disabled={!canEdit} value={footer.note} onChange={(e) => setFooter({ ...footer, note: e.target.value })} />}
        </Field>
        {canEdit && (
          <div className="mt-3 flex justify-end">
            <Button icon={<Save className="size-5" />} loading={busy === 'footer'} onClick={() => void save('footer', { ...footer })}>{t('common.save')}</Button>
          </div>
        )}
      </Card>
    </div>
  )
}
