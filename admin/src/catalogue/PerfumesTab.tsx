import { useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Eye, EyeOff, ImagePlus, Layers, Pencil, Plus, Star, Trash2 } from 'lucide-react'
import { Button, IconButton } from '@/components/ui/Button'
import { Badge, Card, EmptyState, PageHeader, Segmented, Spinner } from '@/components/ui/Controls'
import { Field, Input, SearchInput, Select, Textarea } from '@/components/ui/Field'
import { Modal, useConfirm } from '@/components/ui/Modal'
import { cn } from '@/components/ui/cn'
import { useCatalog } from '@/hooks/queries'
import { errorMessage, pick, plural, useT } from '@/i18n'
import { fileToResizedDataUrl } from '@/lib/image'
import type { CatalogItem } from '@/services/catalog'
import { toast } from '@/store/toast'
import { useUI } from '@/store/ui'
import * as cat from './api'
import { Setting } from './Setting'

/**
 * The perfumes as the wholesale catalogue shows them, and the collections they are grouped into.
 *
 * The line the brief draws in §8 is drawn on this screen too: everything from the POS is shown but greyed as
 * read-only, and everything editable here belongs to the catalogue. Changing a perfume's name or its category is
 * done in Products, where the tills and the delegates will see it; changing how it reads to a buyer in Türkiye is
 * done here, and touches nothing else.
 */
export function PerfumesTab({ canEdit, canTranslate }: { canEdit: boolean; canTranslate: boolean }) {
  const t = useT()
  const [tab, setTab] = useState<'perfumes' | 'collections'>('perfumes')

  return (
    <div className="space-y-4">
      <Segmented
        value={tab}
        onChange={setTab}
        ariaLabel={t('wc.tab_perfumes')}
        options={(['perfumes', 'collections'] as const).map((x) => ({ value: x, label: t(`wc.sub_${x}`) }))}
      />
      {tab === 'perfumes' ? <Perfumes canEdit={canEdit} canTranslate={canTranslate} /> : <Collections canEdit={canEdit} />}
    </div>
  )
}

/* ───────────────────────── the perfumes ───────────────────────── */

function Perfumes({ canEdit, canTranslate }: { canEdit: boolean; canTranslate: boolean }) {
  const t = useT()
  const lang = useUI((s) => s.lang)
  const [open, setOpen] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const { data: catalog = [], isLoading } = useCatalog()

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const all = (catalog as CatalogItem[]).filter((c) => c.product.active)
    if (!needle) return all
    return all.filter((c) => `${c.product.name.en} ${c.product.name.ar} ${c.product.name.ku} ${c.product.brand}`.toLowerCase().includes(needle))
  }, [catalog, q])

  if (open) return <OnePerfume id={open} canEdit={canEdit} canTranslate={canTranslate} onBack={() => setOpen(null)} />
  if (isLoading) return <div className="grid h-60 place-items-center"><Spinner className="size-9" /></div>

  return (
    <div className="space-y-4">
      <Card className="!py-3">
        <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('wc.search_perfumes')} />
        <p className="mt-2 text-xs text-fg-2">{t('wc.perfumes_hint')}</p>
      </Card>

      {!shown.length ? <Card><EmptyState title={t('wc.no_perfumes')} /></Card> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((c) => (
            <button key={c.product.id} type="button" onClick={() => setOpen(c.product.id)}
              className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3 text-start transition hover:border-gold">
              <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-surface-2">
                {c.product.image ? <img src={c.product.image} alt="" className="size-full object-cover" /> : <Layers className="size-5 text-fg-2" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{pick(c.product.name, lang)}</span>
                <span className="block truncate text-xs text-fg-2">{c.product.brand}</span>
              </span>
              <Pencil className="size-4 shrink-0 text-fg-2" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function OnePerfume({ id, canEdit, canTranslate, onBack }: { id: string; canEdit: boolean; canTranslate: boolean; onBack: () => void }) {
  const t = useT()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const [language, setLanguage] = useState('')
  const [text, setText] = useState<{ name: string; description: string } | null>(null)

  const perfume = useQuery({ queryKey: ['cat-perfume', id], queryFn: () => cat.getPerfume(id) })
  const languages = useQuery({ queryKey: ['cat-languages'], queryFn: cat.getLanguages })
  const p = perfume.data

  if (perfume.isLoading || !p) return <div className="grid h-60 place-items-center"><Spinner className="size-9" /></div>

  const chosen = language || languages.data?.find((l) => l.enabled && l.code !== 'en')?.code || 'en'
  const saved = p.translations.find((x) => x.language === chosen)
  const value = text ?? { name: saved?.name ?? '', description: saved?.description ?? '' }

  const refresh = () => qc.invalidateQueries({ queryKey: ['cat-perfume', id] })

  const set = async (body: { hidden?: boolean; featured?: boolean | null }) => {
    setBusy(true)
    try { await cat.setPerfume(id, body); await refresh() } catch (e) { toast.error(errorMessage(e, t)) } finally { setBusy(false) }
  }

  const addImage = async (file?: File) => {
    if (!file) return
    setBusy(true)
    try {
      await cat.addPerfumeImage(id, await fileToResizedDataUrl(file, 1400))
      await refresh()
    } catch (e) { toast.error(errorMessage(e, t)) } finally { setBusy(false) }
  }

  const saveText = async () => {
    setBusy(true)
    try {
      await cat.setPerfumeText(id, chosen, value)
      setText(null)
      await refresh()
      toast.success(t('wc.look_saved'))
    } catch (e) { toast.error(errorMessage(e, t)) } finally { setBusy(false) }
  }

  const pos = p.fromThePos

  return (
    <div className="space-y-4">
      <PageHeader
        title={pos.name.en || pos.name.ar || pos.name.ku}
        subtitle={<span className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">{pos.brand}</Badge>
          {p.hidden && <Badge tone="warn">{t('wc.hidden_here')}</Badge>}
          {(p.featured ?? pos.featured) && <Badge tone="gold"><Star className="size-3" />{t('wc.featured_here')}</Badge>}
        </span>}
        actions={<Button variant="ghost" icon={<ArrowLeft className="size-5 rtl:rotate-180" />} onClick={onBack}>{t('common.back')}</Button>}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* the shop's own — shown, never written from here */}
        <Card>
          <h3 className="mb-1 font-serif text-lg">{t('wc.from_the_pos')}</h3>
          <p className="mb-3 text-sm text-fg-2">{t('wc.from_the_pos_hint')}</p>
          <dl className="grid grid-cols-2 gap-3 text-sm opacity-80">
            <Fact label={t('wc.pos_name')} value={pos.name.en} />
            <Fact label={t('wc.pos_brand')} value={pos.brand} />
            <Fact label={t('wc.pos_kind')} value={t(`prod.cat_${pos.category}`)} />
            <Fact label={t('wc.pos_concentration')} value={pos.concentration} />
          </dl>
          {pos.description.en && <p className="mt-3 text-sm text-fg-2 opacity-80">{pos.description.en}</p>}
        </Card>

        {/* the catalogue's own */}
        <Card>
          <h3 className="mb-1 font-serif text-lg">{t('wc.in_the_catalogue')}</h3>
          <p className="mb-3 text-sm text-fg-2">{t('wc.in_the_catalogue_hint')}</p>
          <div className="space-y-3">
            <Setting checked={!p.hidden} disabled={!canEdit || busy} onChange={(v) => void set({ hidden: !v })}
              label={t('wc.show_here')} hint={t('wc.show_here_hint')} />
            <Setting checked={p.featured ?? pos.featured} disabled={!canEdit || busy} onChange={(v) => void set({ featured: v })}
              label={t('wc.feature_here')} hint={p.featured === null ? t('wc.follows_the_pos') : undefined} />
            {p.featured !== null && canEdit && (
              <Button size="sm" variant="ghost" onClick={() => void set({ featured: null })}>{t('wc.follow_the_pos_again')}</Button>
            )}
          </div>
        </Card>
      </div>

      {/* photographs */}
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-serif text-lg">{t('wc.photographs')}</h3>
            <p className="text-sm text-fg-2">{t('wc.photographs_hint')}</p>
          </div>
          {canEdit && (
            <label className="inline-flex">
              <input type="file" hidden accept="image/*" onChange={(e) => { void addImage(e.target.files?.[0]); e.target.value = '' }} />
              <span className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-surface-2 px-4 text-sm font-semibold">
                <ImagePlus className="size-5" />{busy ? <Spinner className="size-4" /> : t('wc.add_photograph')}
              </span>
            </label>
          )}
        </div>

        <div className="flex flex-wrap gap-3">
          {pos.image && (
            <figure className="w-28">
              <img src={pos.image} alt="" className="h-28 w-28 rounded-xl border border-line object-cover" />
              <figcaption className="mt-1 text-center text-[0.65rem] text-fg-2">{t('wc.the_pos_photo')}</figcaption>
            </figure>
          )}
          {p.images.map((img) => (
            <figure key={img.id} className="relative w-28">
              <img src={img.url} alt="" className="h-28 w-28 rounded-xl border border-line object-cover" />
              {canEdit && (
                <IconButton label={t('common.delete')} variant="ghost"
                  className="absolute -end-1 -top-1 !size-8 rounded-full bg-bg shadow"
                  onClick={async () => {
                    if (!(await confirm({ title: t('wc.remove_photo_q'), danger: true }))) return
                    try { await cat.deletePerfumeImage(img.id); await refresh() } catch (e) { toast.error(errorMessage(e, t)) }
                  }}><Trash2 className="size-3.5 text-danger-fg" /></IconButton>
              )}
            </figure>
          ))}
          {!pos.image && !p.images.length && <p className="text-sm text-fg-2">{t('wc.no_photographs')}</p>}
        </div>
      </Card>

      {/* what it says in each language */}
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-serif text-lg">{t('wc.its_words')}</h3>
            <p className="text-sm text-fg-2">{t('wc.its_words_hint')}</p>
          </div>
          <Select value={chosen} onChange={(e) => { setLanguage(e.target.value); setText(null) }} aria-label={t('wc.language')} className="!w-auto">
            {(languages.data ?? []).map((l) => <option key={l.code} value={l.code}>{l.native}</option>)}
          </Select>
        </div>

        <div className="grid gap-3">
          <Field label={t('wc.its_name')} hint={t('wc.falls_back_hint')}>
            {(id2) => <Input id={id2} dir="auto" disabled={!canTranslate} value={value.name} onChange={(e) => setText({ ...value, name: e.target.value })} />}
          </Field>
          <Field label={t('wc.its_description')} hint={t('wc.falls_back_hint')}>
            {(id2) => <Textarea id={id2} rows={3} dir="auto" disabled={!canTranslate} value={value.description} onChange={(e) => setText({ ...value, description: e.target.value })} />}
          </Field>
        </div>

        {canTranslate && (
          <div className="mt-3 flex justify-end">
            <Button loading={busy} disabled={text === null} onClick={() => void saveText()}>{t('common.save')}</Button>
          </div>
        )}
      </Card>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-fg-2">{label}</dt>
      <dd className="mt-0.5">{value || '—'}</dd>
    </div>
  )
}

/* ───────────────────────── collections ───────────────────────── */

function Collections({ canEdit }: { canEdit: boolean }) {
  const t = useT()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [editing, setEditing] = useState<cat.Collection | 'new' | null>(null)
  const [filling, setFilling] = useState<cat.Collection | null>(null)
  const collections = useQuery({ queryKey: ['cat-collections'], queryFn: cat.getCollections })

  const refresh = () => qc.invalidateQueries({ queryKey: ['cat-collections'] })

  if (collections.isLoading) return <div className="grid h-60 place-items-center"><Spinner className="size-9" /></div>

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-2 !py-3">
        <p className="text-sm text-fg-2">{t('wc.collections_hint')}</p>
        {canEdit && <Button icon={<Plus className="size-5" />} onClick={() => setEditing('new')}>{t('wc.add_collection')}</Button>}
      </Card>

      {!collections.data?.length ? <Card><EmptyState title={t('wc.no_collections')} hint={t('wc.no_collections_hint')} /></Card> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {collections.data.map((c) => (
            <Card key={c.id} className={cn(!c.enabled && 'opacity-60')}>
              {c.image && <img src={c.image} alt="" className="mb-3 h-28 w-full rounded-xl object-cover" />}
              {/* the badge sits under the name, not beside it: a long name must not be crushed into "Oud …" */}
              <h4 className="truncate font-serif text-lg">{c.name.en || c.slug}</h4>
              <p className="num mt-0.5 text-xs text-fg-2">{plural(t, 'wc.perfumes_in', c.perfumes ?? 0)}</p>
              {c.featured && <Badge tone="gold" className="mt-2">{t('wc.on_the_homepage')}</Badge>}
              {canEdit && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setFilling(c)}>{t('wc.choose_perfumes')}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>{t('common.edit')}</Button>
                  <IconButton label={t('common.delete')} variant="ghost" onClick={async () => {
                    if (!(await confirm({ title: t('wc.remove_collection_q', { name: c.name.en || c.slug }), danger: true }))) return
                    try { await cat.deleteCollection(c.id); await refresh() } catch (e) { toast.error(errorMessage(e, t)) }
                  }}><Trash2 className="size-4 text-danger-fg" /></IconButton>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {editing && <CollectionEditor collection={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void refresh() }} />}
      {filling && <CollectionProducts collection={filling} onClose={() => setFilling(null)} onSaved={() => { setFilling(null); void refresh() }} />}
    </div>
  )
}

function CollectionEditor({ collection, onClose, onSaved }: { collection: cat.Collection | null; onClose: () => void; onSaved: () => void }) {
  const t = useT()
  const languages = useQuery({ queryKey: ['cat-languages'], queryFn: cat.getLanguages })
  const [name, setName] = useState<Record<string, string>>(collection?.name ?? {})
  const [description, setDescription] = useState<Record<string, string>>(collection?.description ?? {})
  const [enabled, setEnabled] = useState(collection?.enabled ?? true)
  const [featured, setFeatured] = useState(collection?.featured ?? false)
  const [image, setImage] = useState<string | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      await cat.saveCollection({ name, description, enabled, featured, ...(image !== undefined ? { image } : {}) }, collection?.id)
      toast.success(t('wc.look_saved'))
      onSaved()
    } catch (e) { toast.error(errorMessage(e, t)) } finally { setBusy(false) }
  }

  return (
    <Modal open onClose={onClose} title={collection ? t('common.edit') : t('wc.add_collection')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
      <Button loading={busy} onClick={() => void save()}>{t('common.save')}</Button>
    </>}>
      <div className="space-y-3">
        <p className="text-sm text-fg-2">{t('wc.collection_name_hint')}</p>
        {(languages.data ?? []).filter((l) => l.enabled).map((l) => (
          <div key={l.code} className="grid gap-2 sm:grid-cols-2">
            <Field label={`${t('wc.its_name')} — ${l.native}`}>
              {(id) => <Input id={id} dir={l.rtl ? 'rtl' : 'ltr'} value={name[l.code] ?? ''} onChange={(e) => setName({ ...name, [l.code]: e.target.value })} />}
            </Field>
            <Field label={`${t('wc.its_description')} — ${l.native}`}>
              {(id) => <Input id={id} dir={l.rtl ? 'rtl' : 'ltr'} value={description[l.code] ?? ''} onChange={(e) => setDescription({ ...description, [l.code]: e.target.value })} />}
            </Field>
          </div>
        ))}

        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex">
            <input type="file" hidden accept="image/*" onChange={async (e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) setImage(await fileToResizedDataUrl(file, 1200))
            }} />
            <span className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-surface-2 px-4 text-sm font-semibold"><ImagePlus className="size-5" />{t('wc.choose_picture')}</span>
          </label>
          {(image ?? collection?.image) && <img src={image ?? collection?.image ?? ''} alt="" className="h-16 w-24 rounded-xl border border-line object-cover" />}
          {(image ?? collection?.image) && <Button variant="ghost" onClick={() => setImage(null)}>{t('common.remove')}</Button>}
        </div>

        <div className="space-y-2 rounded-xl bg-surface-2 p-3">
          <Setting checked={enabled} onChange={setEnabled} label={t('wc.collection_on')} />
          <Setting checked={featured} onChange={setFeatured} label={t('wc.on_the_homepage')} />
        </div>
      </div>
    </Modal>
  )
}

function CollectionProducts({ collection, onClose, onSaved }: { collection: cat.Collection; onClose: () => void; onSaved: () => void }) {
  const t = useT()
  const lang = useUI((s) => s.lang)
  const { data: catalog = [] } = useCatalog()
  const [chosen, setChosen] = useState<string[]>(collection.productIds ?? [])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)

  // the ones already in the collection float to the top when the dialog opens — but not again as you tap, or rows
  // would jump out from under your finger
  const already = useRef(collection.productIds ?? [])
  const all = (catalog as CatalogItem[]).filter((c) => c.product.active)
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const matching = needle ? all.filter((c) => `${c.product.name.en} ${c.product.brand}`.toLowerCase().includes(needle)) : all
    const rank = (id: string) => { const i = already.current.indexOf(id); return i < 0 ? already.current.length : i }
    return [...matching].sort((a, b) => rank(a.product.id) - rank(b.product.id))
  }, [all, q])

  const toggle = (id: string) => setChosen((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]))

  const save = async () => {
    setBusy(true)
    try {
      const n = await cat.setCollectionProducts(collection.id, chosen)
      toast.success(plural(t, 'wc.collection_filled', n))
      onSaved()
    } catch (e) { toast.error(errorMessage(e, t)) } finally { setBusy(false) }
  }

  return (
    <Modal open onClose={onClose} size="lg" title={collection.name.en || collection.slug} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
      <Button loading={busy} onClick={() => void save()}>{t('wc.save_n', { n: chosen.length })}</Button>
    </>}>
      <div className="space-y-3">
        <p className="text-sm text-fg-2">{t('wc.choose_perfumes_hint')}</p>
        <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('wc.search_perfumes')} />
        <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded-xl border border-line">
          {shown.map((c) => (
            <li key={c.product.id}>
              <button type="button" onClick={() => toggle(c.product.id)}
                className={cn(
                  'flex w-full items-center gap-3 px-3 py-2.5 text-start transition hover:bg-surface-2',
                  // gold-soft is a light colour whatever the theme, so a dark screen needs its own highlight
                  chosen.includes(c.product.id) && 'bg-gold-soft text-[#6b4e12] dark:bg-gold/15 dark:text-fg',
                )}>
                <span className="num w-6 text-xs text-gold-text">{chosen.indexOf(c.product.id) >= 0 ? chosen.indexOf(c.product.id) + 1 : ''}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{pick(c.product.name, lang)}</span>
                <span className="text-xs text-fg-2">{c.product.brand}</span>
                {chosen.includes(c.product.id) ? <Eye className="size-4 text-gold-text" /> : <EyeOff className="size-4 text-fg-2 opacity-40" />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  )
}
