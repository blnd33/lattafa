import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, ExternalLink, Eye, EyeOff, GripVertical, RotateCcw, Save, Smartphone, Sparkles, Star, type LucideIcon } from 'lucide-react'
import { PREVIEW, fromPrice, soldOut, whatsappNumber, type MenuData } from '@menu/api'
import { ProductImage } from '@/components/ui/Brand'
import { Button, IconButton } from '@/components/ui/Button'
import { Badge, Card, EmptyState, PageHeader, Segmented, Spinner, Switch } from '@/components/ui/Controls'
import { Field, Input, SearchInput } from '@/components/ui/Field'
import { cn } from '@/components/ui/cn'
import { RequireAny } from '@/features/NoAccess'
import { useAction } from '@/hooks/queries'
import { useAppAddresses } from '@/hooks/useAppAddresses'
import { pick, useT } from '@/i18n'
import { fmt } from '@/lib/money'
import { useUI } from '@/store/ui'
import { arranged, changes, draftOf, loadMenu, move, previewData, saveMenu, type Draft, type Flags, type ManagedProduct, type MenuManage } from './api'
import { HeroCard } from './HeroCard'

/** Admin panel → Customer menu: which perfumes guests see, which stand out, in what order — with a live preview. */
export function MenuPage() {
  return <RequireAny perms={['products.edit']}><MenuScreen /></RequireAny>
}

function MenuScreen() {
  const t = useT()
  const q = useQuery({ queryKey: ['menu-manage'], queryFn: loadMenu })
  if (q.data) return <Editor fresh={q.data} />
  return (
    <div className="grid h-80 place-items-center">
      {q.isError ? <Button onClick={() => void q.refetch()}>{t('ap.retry')}</Button> : <Spinner className="size-9" />}
    </div>
  )
}

type Filter = 'all' | 'shown' | 'hidden' | 'featured' | 'new'

function Editor({ fresh }: { fresh: MenuManage }) {
  const t = useT()
  const apps = useAppAddresses()
  const lang = useUI((s) => s.lang)
  // `base` = the menu as saved. Screens refresh after every sync; that must not wipe what is being arranged.
  const [base, setBase] = useState(fresh)
  const [d, setD] = useState<Draft>(() => draftOf(fresh))
  const body = useMemo(() => changes(base, d, base.canEditSettings), [base, d])
  const dirty = body !== null
  useEffect(() => {
    if (!dirty) { setBase(fresh); setD(draftOf(fresh)) }
  }, [fresh]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const rows = useMemo(() => arranged(base, d), [base, d])
  const preview = useMemo(() => previewData(base, d), [base, d])
  const waBad = d.settings.whatsapp.trim() !== '' && !whatsappNumber(d.settings.whatsapp)
  const [pane, setPane] = useState<'arrange' | 'preview'>('arrange')

  const save = useAction(saveMenu, { success: 'mn.saved' })
  const onSave = async () => {
    if (!body || waBad) return
    const r = await save(body)
    if (r) { setBase(r); setD(draftOf(r)) }
  }
  const undo = () => setD(draftOf(base))
  // photos/videos are saved straight away: take the server's list, keep everything else being arranged
  const adoptMedia = (m: MenuManage) => { setBase(m); setD((x) => ({ ...x, settings: { ...x.settings, hero: m.menu.hero } })) }

  const setFlag = (id: string, k: keyof Flags, v: boolean) => setD((x) => ({ ...x, flags: { ...x.flags, [id]: { ...x.flags[id], [k]: v } } }))
  const reorder = (from: number, to: number) => setD((x) => ({ ...x, custom: true, order: move(arranged(base, x).map((p) => p.id), from, to) }))
  const shown = rows.filter((p) => p.showOnMenu).length

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-6">
      <PageHeader title={t('mn.title')} subtitle={t('mn.subtitle')}
        actions={<a href={apps.menu} target="_blank" rel="noopener" className="inline-flex h-11 items-center gap-2 rounded-xl border border-line px-4 text-sm font-semibold transition hover:border-gold"><ExternalLink className="size-4" />{t('mn.open')}</a>} />
      <Segmented className="mb-4 lg:hidden" ariaLabel={t('mn.title')} value={pane} onChange={setPane}
        options={[{ value: 'arrange', label: t('mn.tab_arrange') }, { value: 'preview', label: t('mn.tab_preview') }]} />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className={cn('min-w-0 space-y-4', pane === 'preview' && 'max-lg:hidden')}>
          <HeroCard items={d.settings.hero} dim={d.settings.heroDim} ro={!base.canEditSettings} onChange={adoptMedia}
            onDim={(v) => setD((x) => ({ ...x, settings: { ...x.settings, heroDim: v } }))} />
          <SettingsCard base={base} d={d} setD={setD} waBad={waBad} />
          <ListCard rows={rows} shown={shown} custom={d.custom} setFlag={setFlag} reorder={reorder}
            onAuto={() => setD((x) => ({ ...x, custom: false }))} />
        </div>
        <div className={cn('lg:sticky lg:top-4', pane === 'arrange' && 'max-lg:hidden')}>
          <Preview data={preview} dirty={dirty} lang={lang} />
        </div>
      </div>
      {dirty && (
        <div className="sticky bottom-0 z-20 -mx-4 mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface/95 px-4 py-3 pb-safe backdrop-blur md:-mx-6 md:px-6" role="region" aria-label={t('mn.unsaved')}>
          <p className="text-sm font-medium">{t('mn.changes')}</p>
          <div className="flex gap-2">
            <Button variant="ghost" icon={<RotateCcw className="size-4" />} onClick={undo}>{t('mn.undo')}</Button>
            <Button variant="primary" icon={<Save className="size-5" />} loading={save.busy} disabled={waBad} onClick={() => void onSave()}>{t('mn.save')}</Button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ───────────────────────── settings ───────────────────────── */

function SettingsCard({ base, d, setD, waBad }: { base: MenuManage; d: Draft; setD: (f: (d: Draft) => Draft) => void; waBad: boolean }) {
  const t = useT()
  const ro = !base.canEditSettings
  const set = <K extends keyof Draft['settings']>(k: K, v: Draft['settings'][K]) => setD((x) => ({ ...x, settings: { ...x.settings, [k]: v } }))
  const phone = base.store.phone.trim()
  return (
    <Card>
      <h2 className="font-semibold">{t('mn.settings')}</h2>
      {ro && <p className="mt-0.5 text-xs text-fg-2">{t('mn.settings_ro')}</p>}
      <div className="mt-3 grid gap-x-6 gap-y-4 md:grid-cols-2">
        <div className="space-y-3">
          <SwitchRow label={t('mn.show_prices')} hint={t('mn.show_prices_hint')} checked={d.settings.showPrices} disabled={ro} onChange={(v) => set('showPrices', v)} />
          <SwitchRow label={t('mn.hide_sold_out')} hint={t('mn.hide_sold_out_hint')} checked={d.settings.hideSoldOut} disabled={ro} onChange={(v) => set('hideSoldOut', v)} />
        </div>
        <Field label={t('mn.whatsapp')} error={waBad ? t('mn.whatsapp_bad') : undefined}
          hint={!waBad && (phone ? t('mn.whatsapp_hint', { phone }) : t('mn.whatsapp_none'))}>
          {(id) => <Input id={id} dir="ltr" inputMode="tel" autoComplete="off" className="num" disabled={ro} invalid={waBad} maxLength={30}
            placeholder={phone || '0750 123 4567'} value={d.settings.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} />}
        </Field>
      </div>
    </Card>
  )
}

function SwitchRow({ label, hint, checked, disabled, onChange }: { label: string; hint: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-fg-2">{hint}</div>
      </div>
      <Switch checked={checked} onChange={onChange} label={label} disabled={disabled} />
    </div>
  )
}

/* ───────────────────────── the perfumes ───────────────────────── */

function ListCard({ rows, shown, custom, setFlag, reorder, onAuto }: {
  rows: ManagedProduct[]; shown: number; custom: boolean
  setFlag: (id: string, k: keyof Flags, v: boolean) => void
  reorder: (from: number, to: number) => void
  onAuto: () => void
}) {
  const t = useT()
  const lang = useUI((s) => s.lang)
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [said, setSaid] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)
  const listRef = useRef<HTMLOListElement>(null)

  const q = search.trim().toLowerCase()
  const visible = rows.filter((p) => {
    if (filter === 'shown' && !p.showOnMenu) return false
    if (filter === 'hidden' && p.showOnMenu) return false
    if (filter === 'featured' && !p.featured) return false
    if (filter === 'new' && !p.isNew) return false
    return !q || [p.name.en, p.name.ar, p.name.ku, p.brand].join(' ').toLowerCase().includes(q)
  })
  // only the whole list can be put in order (a filtered list has gaps)
  const canMove = filter === 'all' && !q
  const count = (f: Filter) => rows.filter((p) => (f === 'all' ? true : f === 'shown' ? p.showOnMenu : f === 'hidden' ? !p.showOnMenu : f === 'featured' ? p.featured : p.isNew)).length
  // a perfume's number on the menu (hidden ones have none)
  const place = new Map<string, number>()
  rows.filter((p) => p.showOnMenu).forEach((p, i) => place.set(p.id, i + 1))

  const step = (i: number, by: number) => {
    const to = i + by
    if (to < 0 || to >= rows.length) return
    const p = rows[i]
    reorder(i, to)
    setSaid(t('mn.moved', { name: pick(p.name, lang), n: placeIn(move(rows, i, to), to) }))
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-grip="${p.id}"]`)?.focus())
  }
  const onGripDown = (id: string) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return
    e.preventDefault() // no text selection while dragging
    setDragId(id)
  }
  // While dragging, follow the pointer on the whole window: rows move under it as the order changes, so React may move
  // the row's element (which would lose a pointer capture). Places are read from the page itself, never from stale state.
  const latest = useRef({ reorder, rows, lang, t })
  latest.current = { reorder, rows, lang, t }
  useEffect(() => {
    if (!dragId) return
    const items = () => [...(listRef.current?.querySelectorAll<HTMLElement>('[data-row]') ?? [])]
    const onMove = (e: PointerEvent) => {
      const all = items()
      const from = all.findIndex((el) => el.dataset.row === dragId)
      // the new place = how many of the other rows have their middle above the pointer
      const to = all.filter((el, i) => { if (i === from) return false; const b = el.getBoundingClientRect(); return b.top + b.height / 2 < e.clientY }).length
      if (from >= 0 && to !== from) latest.current.reorder(from, to)
    }
    const onUp = () => {
      const { rows: now, lang: l, t: tr } = latest.current
      const i = now.findIndex((p) => p.id === dragId)
      if (i >= 0) setSaid(tr('mn.moved', { name: pick(now[i].name, l), n: placeIn(now, i) }))
      setDragId(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [dragId])

  const filters: Filter[] = ['all', 'shown', 'hidden', 'featured', 'new']
  return (
    <Card pad={false}>
      <div className="space-y-3 border-b border-line p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">{t('mn.perfumes')}</h2>
          <span className="text-sm tabular-nums text-fg-2">{t('mn.summary', { shown, total: rows.length })}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput className="min-w-48 flex-1" placeholder={t('mn.search')} aria-label={t('mn.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
          <Segmented size="sm" ariaLabel={t('mn.filter')} value={filter} onChange={setFilter}
            options={filters.map((f) => ({ value: f, label: <>{t(`mn.f_${f}`)} <span className="num opacity-70">{count(f)}</span></> }))} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-2 px-3 py-2 text-xs text-fg-2">
          <span>{canMove ? t(custom ? 'mn.order_custom' : 'mn.order_auto') : t('mn.order_filtered')}</span>
          {custom && canMove && <Button size="sm" variant="ghost" icon={<RotateCcw className="size-4" />} onClick={onAuto}>{t('mn.order_reset')}</Button>}
        </div>
      </div>
      <p className="sr-only" aria-live="polite">{said}</p>
      {!rows.length ? <EmptyState title={t('mn.none')} className="py-10" /> : !visible.length ? <EmptyState title={t('mn.no_match')} className="py-10" /> : (
        <ol ref={listRef} aria-label={t('mn.perfumes')} className="divide-y divide-line">
          {visible.map((p) => {
            const i = rows.indexOf(p)
            const name = pick(p.name, lang)
            const out = soldOut(p)
            return (
              <li key={p.id} data-row={p.id} className={cn('flex items-center gap-2 px-2 py-2.5 sm:gap-3 sm:px-4', dragId === p.id && 'relative z-10 bg-gold-soft/60 shadow-lg dark:bg-gold/10')}>
                {canMove && (
                  <button type="button" data-grip={p.id} aria-label={t('mn.drag', { name })} title={t('mn.drag', { name })}
                    onPointerDown={onGripDown(p.id)}
                    onKeyDown={(e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); step(i, e.key === 'ArrowUp' ? -1 : 1) } }}
                    className={cn('grid h-11 w-7 shrink-0 touch-none place-items-center rounded-lg text-fg-2 hover:bg-surface-2 hover:text-fg', dragId === p.id ? 'cursor-grabbing' : 'cursor-grab')}>
                    <GripVertical className="size-5" />
                  </button>
                )}
                <span className="num w-6 shrink-0 text-center text-sm font-semibold text-fg-2">{place.get(p.id) ?? '—'}</span>
                <ProductImage product={p} className={cn('size-12 shrink-0 rounded-xl bg-gradient-to-b from-charcoal to-ink', !p.showOnMenu && 'opacity-40')} />
                {/* name and details, with the switches beside them when there is room and under them when not */}
                <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                  <div className={cn('min-w-0 flex-[1_1_12rem]', !p.showOnMenu && 'opacity-60')}>
                    <div className="truncate font-semibold">{name}</div>
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-fg-2">
                      <span className="truncate">{p.brand}</span>·<span className="num">{p.sizes.map((s) => s.label).join(' / ')}</span>·
                      <span><span className="num">{fmt(fromPrice(p))}</span> {t('unit.iqd')}</span>
                      {out && <Badge tone="warn" className="!py-0">{t('mn.sold_out')}</Badge>}
                    </div>
                  </div>
                  <div role="group" aria-label={name} className="flex shrink-0 flex-wrap items-center gap-1.5">
                    <Toggle on={p.showOnMenu} icon={p.showOnMenu ? Eye : EyeOff} onChange={(v) => setFlag(p.id, 'showOnMenu', v)}>{t('mn.on_menu')}</Toggle>
                    <Toggle on={p.featured} icon={Star} fill onChange={(v) => setFlag(p.id, 'featured', v)}>{t('mn.featured')}</Toggle>
                    <Toggle on={p.isNew} icon={Sparkles} onChange={(v) => setFlag(p.id, 'isNew', v)}>{t('mn.new')}</Toggle>
                  </div>
                </div>
                {canMove && (
                  <div className="flex shrink-0 flex-col">
                    <IconButton size="sm" variant="ghost" label={t('mn.up', { name })} disabled={i === 0} onClick={() => step(i, -1)}><ChevronUp className="size-5" /></IconButton>
                    <IconButton size="sm" variant="ghost" label={t('mn.down', { name })} disabled={i === rows.length - 1} onClick={() => step(i, 1)}><ChevronDown className="size-5" /></IconButton>
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </Card>
  )
}

/** The number a perfume has on the menu, as shown in the list (a hidden one: its place in the list). */
function placeIn(list: ManagedProduct[], i: number): number {
  return list[i].showOnMenu ? list.slice(0, i + 1).filter((p) => p.showOnMenu).length : i + 1
}

function Toggle({ on, icon: Icon, fill, onChange, children }: { on: boolean; icon: LucideIcon; fill?: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={() => onChange(!on)} title={typeof children === 'string' ? children : undefined}
      className={cn('inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-full border text-xs font-semibold transition sm:px-2.5',
        on ? 'border-gold bg-gold-soft text-[#6b4e12] dark:bg-gold/20 dark:text-gold-light' : 'border-line text-fg-2 hover:border-gold/60 hover:text-fg')}>
      <Icon className={cn('size-4 shrink-0', on && fill && 'fill-current')} /><span className="max-sm:sr-only">{children}</span>
    </button>
  )
}

/* ───────────────────────── live preview ───────────────────────── */

/** The real customer menu in a phone-sized frame, showing the unsaved arrangement (see menu/src/MenuApp.tsx). */
function Preview({ data, dirty, lang }: { data: MenuData; dirty: boolean; lang: string }) {
  const t = useT()
  const frame = useRef<HTMLIFrameElement>(null)
  const latest = useRef(data)
  latest.current = data
  const post = (withLang: boolean) => frame.current?.contentWindow?.postMessage({ type: PREVIEW.data, data: latest.current, ...(withLang ? { lang } : {}) }, location.origin)

  // the menu says when it is ready (also after a reload): send it everything, in the admin's language
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.source !== frame.current?.contentWindow || (e.data as { type?: string })?.type !== PREVIEW.ready) return
      post(true)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }) // re-bound each render so it sends the current language
  useEffect(() => {
    const id = setTimeout(() => post(false), 60)
    return () => clearTimeout(id)
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { post(true) }, [lang]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section aria-label={t('mn.preview')}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold"><Smartphone className="size-5 text-gold-text" />{t('mn.preview')}</h2>
        {dirty ? <Badge tone="warn">{t('mn.unsaved')}</Badge> : <Badge tone="ok">{t('mn.live')}</Badge>}
      </div>
      <div className="mx-auto w-full max-w-[420px] rounded-[2.25rem] border-[10px] border-ink bg-ink shadow-xl dark:border-[#2a241f]">
        <iframe ref={frame} title={t('mn.preview')} src="/menu/?preview=1" className="block h-[min(780px,calc(100dvh-11rem))] min-h-[480px] w-full rounded-[1.6rem] bg-[#14110F]" />
      </div>
      <p className="mt-2 text-center text-xs text-fg-2">{t('mn.preview_hint')}</p>
    </section>
  )
}
