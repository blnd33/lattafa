import { useEffect, useRef, useState } from 'react'
import { ImagePlus, Plus, Trash2, Wand2, X } from 'lucide-react'
import { BottleArt, ProductImage } from '@/components/ui/Brand'
import { Button, IconButton } from '@/components/ui/Button'
import { Segmented, Switch } from '@/components/ui/Controls'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Modal, useConfirm } from '@/components/ui/Modal'
import { cn } from '@/components/ui/cn'
import { useT } from '@/i18n'
import type { BottleShape, Gender, I18nText, Product, SizeUnit } from '@/data/types'
import { fileToResizedDataUrl } from '@/lib/image'
import { parseAmount } from '@/lib/money'
import { cleanDecimal, otherUnit, SIZE_UNITS, sizeLabel, trimNum } from '@/lib/size'
import { deleteProduct, distinctBrands, nextBarcode, saveProduct, type CatalogItem, type VariantInput } from '@/services/catalog'
import { useAction } from '@/hooks/queries'
import { useCan } from '@/hooks/useAuth'
import { toast } from '@/store/toast'
import { useQuery } from '@tanstack/react-query'

const CATEGORIES = ['perfume', 'oud', 'mist', 'oil', 'set', 'home']
const CONCENTRATIONS = ['EDP', 'EDT', 'Parfum', 'Extrait', 'Oil', 'Mist', 'Set']
const FAMILIES = ['oud', 'woody', 'floral', 'oriental', 'fresh', 'sweet']
const GENDERS: Gender[] = ['men', 'women', 'unisex']
const SHAPES: BottleShape[] = ['rect', 'tall', 'round', 'flask']

interface VarForm { id?: string; label: string; size: string; unit: SizeUnit; sku: string; barcode: string; cost: string; retail: string; wholesale: string; min: string; opening: string; isTester: boolean; existing: boolean }

interface Form {
  id?: string
  name: I18nText
  description: I18nText
  brand: string
  category: string
  gender: Gender
  concentration: string
  families: string[]
  notes: { top: string; heart: string; base: string }
  season: Product['season']
  longevity: number
  sillage: number
  image: string | null
  art: Product['art']
  showOnMenu: boolean
  featured: boolean
  isNew: boolean
  active: boolean
  variants: VarForm[]
}

const blankVariant = (): VarForm => ({ label: '100 ml', size: '100', unit: 'ml', sku: '', barcode: '', cost: '', retail: '', wholesale: '', min: '5', opening: '', isTester: false, existing: false })
const blank = (): Form => ({
  name: { en: '', ar: '', ku: '' }, description: { en: '', ar: '', ku: '' }, brand: 'Lattafa', category: 'perfume', gender: 'unisex', concentration: 'EDP',
  families: [], notes: { top: '', heart: '', base: '' }, season: 'all', longevity: 3, sillage: 3, image: null, art: { c1: '#8B4A2B', c2: '#3A1E12', shape: 'rect' },
  showOnMenu: true, featured: false, isNew: true, active: true, variants: [blankVariant()],
})
const fromItem = (c: CatalogItem): Form => ({
  id: c.product.id, name: { ...c.product.name }, description: { ...c.product.description }, brand: c.product.brand, category: c.product.category, gender: c.product.gender,
  concentration: c.product.concentration, families: [...c.product.scentFamilies],
  notes: { top: c.product.notes.top.join(', '), heart: c.product.notes.heart.join(', '), base: c.product.notes.base.join(', ') },
  season: c.product.season, longevity: c.product.longevity, sillage: c.product.sillage, image: c.product.image, art: { ...c.product.art },
  showOnMenu: c.product.showOnMenu, featured: c.product.featured, isNew: c.product.isNew, active: c.product.active,
  variants: c.variants.map((v) => ({ id: v.id, label: v.label, size: v.size > 0 ? trimNum(v.size) : '', unit: v.unit, sku: v.sku, barcode: v.barcode, cost: String(v.costIQD), retail: String(v.retailIQD), wholesale: String(v.wholesaleIQD), min: String(v.minStock), opening: '', isTester: v.isTester, existing: true })),
})
const list = (s: string) => s.split(/[,،]/).map((x) => x.trim().toLowerCase()).filter(Boolean)
const sizeToken = (v: VarForm) => (v.size ? `${v.size.replace('.', '')}${v.unit === 'oz' ? 'OZ' : ''}` : '')
const slug = (s: string) => s.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 4) || 'ITEM'

type Tab = 'basic' | 'sizes' | 'details' | 'menu'

export function ProductEditor({ value, onClose }: { value: CatalogItem | 'new' | null; onClose: () => void }) {
  const t = useT()
  const confirm = useConfirm()
  const canPrices = useCan('prices.edit')
  const canDelete = useCan('products.delete')
  const [f, setF] = useState<Form>(blank)
  const [tab, setTab] = useState<Tab>('basic')
  const [key, setKey] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const save = useAction(saveProduct, { success: 'prod.saved' })
  const del = useAction(deleteProduct)
  const { data: brands = [] } = useQuery({ queryKey: ['brands'], queryFn: distinctBrands })

  const id = value ? (value === 'new' ? 'new' : value.product.id) : null
  useEffect(() => { if (id !== key) { setKey(id); setTab('basic'); setF(value === 'new' || !value ? blank() : fromItem(value)) } }, [id, key, value])
  if (!value) return null

  const isNew = value === 'new'
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }))
  const setVar = (i: number, patch: Partial<VarForm>) => setF((p) => ({ ...p, variants: p.variants.map((v, j) => (j === i ? { ...v, ...patch } : v)) }))

  const addSize = () => setF((p) => {
    const v = blankVariant()
    const last = p.variants[p.variants.length - 1]
    v.label = ''; v.size = ''; v.unit = last?.unit ?? 'ml' // next size starts in the same unit as the previous one
    return { ...p, variants: [...p.variants, v] }
  })
  const genSku = (i: number) => { const v = f.variants[i]; setVar(i, { sku: `LTF-${slug(f.name.en || f.brand)}-${sizeToken(v) || i + 1}` }) }
  /** Changing the size or the unit also refreshes the label ("100 ml" → "3.4 oz") unless someone typed a custom one. */
  const setSize = (i: number, patch: { size?: string; unit?: SizeUnit }) => setF((p) => ({
    ...p,
    variants: p.variants.map((v, j) => {
      if (j !== i) return v
      const next = { ...v, ...patch }
      const wasAuto = !v.label || v.label === sizeLabel(parseAmount(v.size), v.unit)
      return { ...next, label: wasAuto ? sizeLabel(parseAmount(next.size), next.unit) : v.label }
    }),
  }))
  const genBarcode = async (i: number) => setVar(i, { barcode: await nextBarcode() })

  const onFile = async (file?: File) => {
    if (!file) return
    try { set('image', await fileToResizedDataUrl(file)) } catch { toast.error(t('prod.image_failed')) }
  }

  const submit = async () => {
    const variants: VariantInput[] = f.variants.map((v) => ({
      id: v.id, label: v.label.trim() || sizeLabel(parseAmount(v.size), v.unit), size: parseAmount(v.size), unit: v.unit, sku: v.sku, barcode: v.barcode, costIQD: Math.round(parseAmount(v.cost)),
      retailIQD: Math.round(parseAmount(v.retail)), wholesaleIQD: Math.round(parseAmount(v.wholesale) || parseAmount(v.retail)), minStock: Math.round(parseAmount(v.min)),
      isTester: v.isTester, active: true, openingStock: v.existing ? undefined : Math.round(parseAmount(v.opening)),
    }))
    const product = {
      id: f.id, name: f.name, description: f.description, brand: f.brand.trim(), category: f.category, gender: f.gender, concentration: f.concentration,
      scentFamilies: f.families, notes: { top: list(f.notes.top), heart: list(f.notes.heart), base: list(f.notes.base) }, season: f.season,
      longevity: f.longevity, sillage: f.sillage, image: f.image, art: f.art, showOnMenu: f.showOnMenu, featured: f.featured, isNew: f.isNew, active: f.active,
    }
    if (await save({ product, variants })) onClose()
  }

  const remove = async () => {
    if (!f.id) return
    if (!(await confirm({ title: t('prod.delete_title'), message: t('prod.delete_msg'), danger: true, confirmLabel: t('common.delete') }))) return
    const r = await del(f.id)
    if (r) { toast.success(t(r === 'deleted' ? 'prod.deleted' : 'prod.deactivated')); onClose() }
  }

  const preview: Pick<Product, 'image' | 'art'> = { image: f.image, art: f.art }
  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? t('prod.new') : t('prod.edit')}
      size="xl"
      className="md:h-[min(46rem,92dvh)]"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          {canDelete && !isNew ? <Button variant="ghost" className="text-danger" icon={<Trash2 className="size-5" />} onClick={remove}>{t('common.delete')}</Button> : <span />}
          <Button size="lg" variant="primary" loading={save.busy} onClick={submit}>{t('common.save')}</Button>
        </div>
      }
    >
      <div className="space-y-5">
        <Segmented value={tab} onChange={setTab} options={(['basic', 'sizes', 'details', 'menu'] as Tab[]).map((x) => ({ value: x, label: t(`prod.tab_${x}`) }))} />

        {tab === 'basic' && (
          <div className="grid gap-5 md:grid-cols-[11rem_1fr]">
            <div className="space-y-2">
              <ProductImage product={preview} className="aspect-[3/4] rounded-2xl border border-line" />
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />
              <Button block variant="secondary" icon={<ImagePlus className="size-5" />} onClick={() => fileRef.current?.click()}>{t('prod.upload')}</Button>
              {f.image && <Button block variant="ghost" className="text-danger" icon={<X className="size-4" />} onClick={() => set('image', null)}>{t('prod.remove_image')}</Button>}
              {!f.image && (
                <div className="space-y-2 rounded-xl bg-surface-2 p-2.5">
                  <div className="text-xs font-medium text-fg-2">{t('prod.art')}</div>
                  <div className="flex items-center gap-2"><input type="color" aria-label="c1" value={f.art.c1} onChange={(e) => set('art', { ...f.art, c1: e.target.value })} className="size-9 cursor-pointer rounded-lg border border-line bg-transparent" /><input type="color" aria-label="c2" value={f.art.c2} onChange={(e) => set('art', { ...f.art, c2: e.target.value })} className="size-9 cursor-pointer rounded-lg border border-line bg-transparent" /></div>
                  <div className="grid grid-cols-4 gap-1.5">{SHAPES.map((s) => <button key={s} type="button" aria-pressed={f.art.shape === s} onClick={() => set('art', { ...f.art, shape: s })} className={cn('h-14 rounded-lg border bg-surface p-1', f.art.shape === s ? 'border-gold' : 'border-line')}><BottleArt c1={f.art.c1} c2={f.art.c2} shape={s} /></button>)}</div>
                </div>
              )}
            </div>
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label={`${t('prod.name')} · English`}>{(i) => <Input id={i} value={f.name.en} onChange={(e) => set('name', { ...f.name, en: e.target.value })} data-autofocus />}</Field>
                <Field label={`${t('prod.name')} · العربية`}>{(i) => <Input id={i} dir="rtl" value={f.name.ar} onChange={(e) => set('name', { ...f.name, ar: e.target.value })} />}</Field>
                <Field label={`${t('prod.name')} · کوردی`}>{(i) => <Input id={i} dir="rtl" value={f.name.ku} onChange={(e) => set('name', { ...f.name, ku: e.target.value })} />}</Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('prod.brand')}>{(i) => <><Input id={i} list="brand-list" value={f.brand} onChange={(e) => set('brand', e.target.value)} /><datalist id="brand-list">{brands.map((b) => <option key={b} value={b} />)}</datalist></>}</Field>
                <Field label={t('prod.category')}>{(i) => <Select id={i} value={f.category} onChange={(e) => set('category', e.target.value)}>{CATEGORIES.map((c) => <option key={c} value={c}>{t(`prod.cat_${c}`)}</option>)}</Select>}</Field>
                <Field label={t('prod.gender')}>{(i) => <Select id={i} value={f.gender} onChange={(e) => set('gender', e.target.value as Gender)}>{GENDERS.map((g) => <option key={g} value={g}>{t(`gender.${g}`)}</option>)}</Select>}</Field>
                <Field label={t('prod.concentration')}>{(i) => <Select id={i} value={f.concentration} onChange={(e) => set('concentration', e.target.value)}>{CONCENTRATIONS.map((c) => <option key={c}>{c}</option>)}</Select>}</Field>
              </div>
              {!isNew && <div className="flex items-center justify-between rounded-xl bg-surface-2 p-3.5"><span className="text-sm font-medium">{t('prod.active')}</span><Switch checked={f.active} onChange={(v) => set('active', v)} label={t('prod.active')} /></div>}
            </div>
          </div>
        )}

        {tab === 'sizes' && (
          <div className="space-y-3">
            <p className="text-sm text-fg-2">{t('prod.sizes_hint')}</p>
            {f.variants.map((v, i) => (
              <div key={v.id ?? `n${i}`} className="space-y-3 rounded-2xl border border-line p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold">{t('prod.size')} {i + 1}</div>
                  {f.variants.length > 1 && <IconButton label={t('common.remove')} variant="ghost" className="text-danger" onClick={() => set('variants', f.variants.filter((_, j) => j !== i))}><Trash2 className="size-5" /></IconButton>}
                </div>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Field label={t('prod.size_label')}>{(k) => <Input id={k} value={v.label} placeholder="100 ml" onChange={(e) => setVar(i, { label: e.target.value })} />}</Field>
                  <Field label={t('prod.size_value')}>{(k) => <Input id={k} inputMode="decimal" className="num" value={v.size} placeholder={v.unit === 'oz' ? '3.4' : '100'} onChange={(e) => setSize(i, { size: cleanDecimal(e.target.value) })} />}</Field>
                  <Field label={t('prod.unit')} hint={otherUnit(parseAmount(v.size), v.unit) || undefined}>{() => <Segmented ariaLabel={t('prod.unit')} value={v.unit} onChange={(u) => setSize(i, { unit: u })} options={SIZE_UNITS.map((u) => ({ value: u, label: u }))} />}</Field>
                  <Field label="SKU">{(k) => <div className="flex gap-1.5"><Input id={k} className="num" value={v.sku} onChange={(e) => setVar(i, { sku: e.target.value })} /><IconButton label={t('prod.generate')} onClick={() => genSku(i)}><Wand2 className="size-4" /></IconButton></div>}</Field>
                  <Field label={t('prod.barcode')}>{(k) => <div className="flex gap-1.5"><Input id={k} className="num" value={v.barcode} onChange={(e) => setVar(i, { barcode: e.target.value })} /><IconButton label={t('prod.generate')} onClick={() => genBarcode(i)}><Wand2 className="size-4" /></IconButton></div>}</Field>
                  <Field label={t('prod.retail')}>{(k) => <Input id={k} inputMode="numeric" className="num" disabled={!canPrices && v.existing} value={v.retail} onChange={(e) => setVar(i, { retail: e.target.value.replace(/[^\d]/g, '') })} />}</Field>
                  <Field label={t('prod.wholesale')}>{(k) => <Input id={k} inputMode="numeric" className="num" disabled={!canPrices && v.existing} value={v.wholesale} onChange={(e) => setVar(i, { wholesale: e.target.value.replace(/[^\d]/g, '') })} />}</Field>
                  <Field label={t('prod.cost')}>{(k) => <Input id={k} inputMode="numeric" className="num" disabled={!canPrices && v.existing} value={v.cost} onChange={(e) => setVar(i, { cost: e.target.value.replace(/[^\d]/g, '') })} />}</Field>
                  <Field label={t('prod.min_stock')}>{(k) => <Input id={k} inputMode="numeric" className="num" value={v.min} onChange={(e) => setVar(i, { min: e.target.value.replace(/\D/g, '') })} />}</Field>
                  {!v.existing && <Field label={t('prod.opening_stock')} className="col-span-2 md:col-span-1">{(k) => <Input id={k} inputMode="numeric" className="num" value={v.opening} onChange={(e) => setVar(i, { opening: e.target.value.replace(/\D/g, '') })} />}</Field>}
                </div>
              </div>
            ))}
            <Button variant="secondary" icon={<Plus className="size-5" />} onClick={addSize}>{t('prod.add_size')}</Button>
          </div>
        )}

        {tab === 'details' && (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              {(['en', 'ar', 'ku'] as const).map((l) => (
                <Field key={l} label={`${t('prod.description')} · ${l === 'en' ? 'English' : l === 'ar' ? 'العربية' : 'کوردی'}`}>{(i) => <Textarea id={i} rows={4} dir={l === 'en' ? 'ltr' : 'rtl'} value={f.description[l]} onChange={(e) => set('description', { ...f.description, [l]: e.target.value })} />}</Field>
              ))}
            </div>
            <div>
              <div className="mb-2 text-sm font-medium">{t('prod.scent_family')}</div>
              <div className="flex flex-wrap gap-2">{FAMILIES.map((x) => <button key={x} type="button" aria-pressed={f.families.includes(x)} onClick={() => set('families', f.families.includes(x) ? f.families.filter((y) => y !== x) : [...f.families, x])} className={cn('min-h-11 rounded-full border px-4 text-sm font-medium', f.families.includes(x) ? 'border-gold bg-gold-soft text-[#6b4e12] dark:bg-gold/15 dark:text-gold-light' : 'border-line')}>{t(`family.${x}`)}</button>)}</div>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {(['top', 'heart', 'base'] as const).map((k) => <Field key={k} label={t(`prod.notes_${k}`)} hint={t('prod.notes_hint')}>{(i) => <Input id={i} value={f.notes[k]} onChange={(e) => set('notes', { ...f.notes, [k]: e.target.value })} />}</Field>)}
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t('prod.season')}>{(i) => <Select id={i} value={f.season} onChange={(e) => set('season', e.target.value as Product['season'])}>{(['all', 'winter', 'summer'] as const).map((s) => <option key={s} value={s}>{t(`prod.season_${s}`)}</option>)}</Select>}</Field>
              <Field label={`${t('prod.longevity')} (1–5)`}>{(i) => <Input id={i} type="number" min={1} max={5} className="num" value={f.longevity} onChange={(e) => set('longevity', Math.min(5, Math.max(1, Number(e.target.value) || 1)))} />}</Field>
              <Field label={`${t('prod.sillage')} (1–5)`}>{(i) => <Input id={i} type="number" min={1} max={5} className="num" value={f.sillage} onChange={(e) => set('sillage', Math.min(5, Math.max(1, Number(e.target.value) || 1)))} />}</Field>
            </div>
          </div>
        )}

        {tab === 'menu' && (
          <div className="space-y-3">
            <p className="text-sm text-fg-2">{t('prod.menu_hint')}</p>
            {([['showOnMenu', 'prod.show_on_menu'], ['featured', 'prod.featured'], ['isNew', 'prod.is_new']] as const).map(([k, label]) => (
              <div key={k} className="flex items-center justify-between rounded-xl bg-surface-2 p-3.5"><span className="text-sm font-medium">{t(label)}</span><Switch checked={f[k]} onChange={(v) => set(k, v)} label={t(label)} /></div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}
