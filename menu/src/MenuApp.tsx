import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, ChevronDown, MapPin, Pause, Phone, Play, RefreshCw, Search, Star, WifiOff } from 'lucide-react'
import { BrandMark, CodaLink, Logo, ProductImage } from '@/components/ui/Brand'
import { cn } from '@/components/ui/cn'
import type { Lang } from '@/data/types'
import { fmt } from '@/lib/money'
import { useUI } from '@/store/ui'
import { cachedMenu, DEFAULT_MENU, fetchMenu, fromPrice, isPreview, menuSettings, PREVIEW, priceBands, soldOut, type HeroMedia, type MenuData, type MenuProduct, type MenuSettings, type PreviewMessage } from './api'
import { htmlLangOf, isRtlLang, useMenuT, type MenuT } from './i18n'
import { OrderBar } from './OrderBar'
import { ProductSheet } from './ProductSheet'

const FAMILIES = ['all', 'oud', 'woody', 'floral', 'oriental', 'fresh', 'sweet'] as const
const GENDERS = ['all', 'men', 'women', 'unisex'] as const
type PriceKey = 'any' | 'p1' | 'p2' | 'p3'
type Bands = [number, number] | null
const priceRange = (k: PriceKey, b: Bands): [number, number] =>
  !b || k === 'any' ? [0, Infinity] : k === 'p1' ? [0, b[0]] : k === 'p2' ? [b[0], b[1]] : [b[1], Infinity]

interface Filters { q: string; brand: string; price: PriceKey; gender: (typeof GENDERS)[number]; family: (typeof FAMILIES)[number] }
const NO_FILTERS: Filters = { q: '', brand: 'all', price: 'any', gender: 'all', family: 'all' }

const nameOf = (p: MenuProduct, lang: Lang) => p.name[lang] || p.name.en || p.name.ar || p.name.ku

/** The public perfume menu: what guests open from the QR code in the shop. Read-only, no sign-in. */
export function MenuApp() {
  const t = useMenuT()
  const lang = useUI((s) => s.lang)
  const [preview] = useState(isPreview)
  const [data, setData] = useState<MenuData | null>(() => (preview ? null : cachedMenu()))
  const [state, setState] = useState<'loading' | 'ok' | 'offline' | 'error'>('loading')
  const [f, setF] = useState<Filters>(NO_FILTERS)
  const [open, setOpen] = useState<MenuProduct | null>(null)

  const load = () => {
    if (preview) return
    setState('loading')
    fetchMenu().then((d) => { setData(d); setState('ok') }).catch(() => setState(cachedMenu() ? 'offline' : 'error'))
  }
  useEffect(load, []) // eslint-disable-line react-hooks/exhaustive-deps

  // live preview inside the admin panel: show what the admin page sends (the unsaved arrangement), never fetch
  useEffect(() => {
    if (!preview) return
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.source !== window.parent) return
      const m = e.data as PreviewMessage
      if (m?.type !== PREVIEW.data) return
      setData(m.data)
      setState('ok')
      setOpen((o) => (o ? (m.data.products.find((p) => p.id === o.id) ?? null) : null))
      if (m.lang) useUI.getState().setLang(m.lang)
    }
    window.addEventListener('message', onMessage)
    window.parent.postMessage({ type: PREVIEW.ready }, location.origin)
    return () => window.removeEventListener('message', onMessage)
  }, [preview])

  // the menu always wears the brand's dark look; language/direction follow the shared preference
  useEffect(() => {
    const root = document.documentElement
    root.classList.add('dark')
    root.dir = isRtlLang(lang) ? 'rtl' : 'ltr'
    root.lang = htmlLangOf(lang)
  }, [lang])
  useEffect(() => { if (data?.store.name) document.title = `${data.store.name} — Menu` }, [data?.store.name])

  const products = data?.products ?? []
  const prices = data ? menuSettings(data).showPrices : true
  const brands = useMemo(() => [...new Set(products.map((p) => p.brand))].sort(), [products])
  const bands = useMemo(() => (prices ? priceBands(products.map(fromPrice)) : null), [products, prices])
  const active = JSON.stringify(f) !== JSON.stringify(NO_FILTERS)
  const results = useMemo(() => {
    const q = f.q.trim().toLowerCase()
    const [lo, hi] = priceRange(f.price, bands)
    return products.filter((p) => {
      if (f.gender !== 'all' && p.gender !== f.gender) return false
      if (f.family !== 'all' && !p.scentFamilies.includes(f.family)) return false
      if (f.brand !== 'all' && p.brand !== f.brand) return false
      const price = fromPrice(p)
      if (price < lo || price >= hi) return false
      if (!q) return true
      const hay = [p.name.en, p.name.ar, p.name.ku, p.brand, ...p.notes.top, ...p.notes.heart, ...p.notes.base, ...p.scentFamilies].join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [products, f, bands])

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <Header t={t} storeName={data?.store.name} tagline={data?.store.tagline || t('tagline')} />
      <main>
        <Hero t={t} menu={data ? menuSettings(data) : DEFAULT_MENU} />
        <section id="collection" className="mx-auto max-w-6xl scroll-mt-20 px-4 pb-16 sm:px-6">
          {state === 'offline' && <Notice icon={<WifiOff className="size-4" />}>{t('offline')}</Notice>}
          {state === 'error' && !data && (
            <div className="grid place-items-center gap-4 py-20 text-center">
              <p className="text-fg-2">{t('error')}</p>
              <button type="button" onClick={load} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-gold/60 px-5 font-semibold text-gold-light hover:bg-gold/10"><RefreshCw className="size-4" />{t('retry')}</button>
            </div>
          )}
          {state === 'loading' && !data && <p className="py-20 text-center text-fg-2" role="status">{t('loading')}</p>}
          {data && (
            <>
              <FilterBar t={t} f={f} setF={setF} brands={brands} bands={bands} />
              {products.length === 0 ? (
                <p className="py-16 text-center text-fg-2">{t('empty')}</p>
              ) : active ? (
                <Section title={t('all_perf')} count={t('results', { n: results.length })}>
                  {results.length ? <Grid items={results} t={t} lang={lang} prices={prices} onOpen={setOpen} /> : (
                    <div className="grid place-items-center gap-4 py-16 text-center">
                      <img src="/logo.png" alt="" className="h-16 opacity-30" />
                      <p className="text-fg-2">{t('none')}</p>
                      <button type="button" onClick={() => setF(NO_FILTERS)} className="min-h-11 rounded-full border border-gold/60 px-5 font-semibold text-gold-light hover:bg-gold/10">{t('reset')}</button>
                    </div>
                  )}
                </Section>
              ) : (
                <>
                  {products.some((p) => p.featured) && <Section title={t('featured')}><Strip items={products.filter((p) => p.featured)} t={t} lang={lang} prices={prices} onOpen={setOpen} /></Section>}
                  {products.some((p) => p.isNew) && <Section title={t('new_arr')}><Strip items={products.filter((p) => p.isNew)} t={t} lang={lang} prices={prices} onOpen={setOpen} /></Section>}
                  <Section title={t('all_perf')} count={t('results', { n: products.length })}><Grid items={products} t={t} lang={lang} prices={prices} onOpen={setOpen} /></Section>
                </>
              )}
            </>
          )}
        </section>
      </main>
      <Footer t={t} store={data?.store} />
      {open && data && <ProductSheet product={open} data={data} onClose={() => setOpen(null)} />}
      {data && <OrderBar products={data.products} lang={lang} />}
    </div>
  )
}

/* ───────────────────────── pieces ───────────────────────── */

function Header({ t, storeName, tagline }: { t: MenuT; storeName?: string; tagline: string }) {
  // see-through over the picture at the top of the page, a solid bar once the guest scrolls
  const [solid, setSolid] = useState(false)
  useEffect(() => {
    const onScroll = () => setSolid(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return (
    <header className={cn('sticky top-0 z-30 border-b pt-safe transition-colors duration-300', solid ? 'border-line/60 bg-bg/85 backdrop-blur' : 'border-transparent bg-transparent')}>
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
          <Logo className="h-9 shrink-0 sm:h-10" />
          <div className="min-w-0">
            <div className="truncate font-serif text-[0.95rem] font-semibold leading-tight text-gold-light sm:text-lg">{storeName || 'Lattafa'}</div>
            <div className="truncate text-[11px] uppercase tracking-[0.18em] text-fg-2">{tagline}</div>
          </div>
        </div>
        <LangPicker t={t} />
      </div>
    </header>
  )
}

function LangPicker({ t }: { t: MenuT }) {
  const lang = useUI((s) => s.lang)
  const setLang = useUI((s) => s.setLang)
  const opts: [Lang, string][] = [['en', 'EN'], ['ar', 'عربي'], ['ku', 'کوردی']]
  return (
    <div role="group" aria-label={t('lang')} className="flex shrink-0 gap-1 rounded-full border border-line bg-surface p-1">
      {opts.map(([l, label]) => (
        <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)}
          className={cn('min-h-9 rounded-full px-2 text-sm font-semibold transition sm:px-3', lang === l ? 'bg-gold text-ink' : 'text-fg-2 hover:text-fg')}>{label}</button>
      ))}
    </div>
  )
}

const SLIDE_MS = 7000
const HEADER = 'calc(env(safe-area-inset-top) + 4rem + 1px)' // the sticky header's height: the hero slides under it

/**
 * The top of the menu: the shop's own photos/videos (admin panel → Customer menu) filling the screen behind the title,
 * under the see-through header and darkened so the title stays readable. With more than one they take turns; until
 * any are added, warm gold light drifts slowly over the dark. Phones keep the title low, clear of the picture.
 */
function Hero({ t, menu }: { t: MenuT; menu: MenuSettings }) {
  const media = menu.hero
  const n = media.length
  const [i, setI] = useState(0)
  const k = n ? i % n : 0
  const ref = useRef<HTMLElement>(null)
  const [paused, setPaused] = useState(false)
  const [inView, setInView] = useState(true)
  // no moving pictures for people who asked their phone for less motion, nor big videos on "data saver"
  const [still] = useState(() => {
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    return reduce || !!(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData
  })
  const moving = !still && (n > 1 || media.some((m) => m.type === 'video'))
  const run = moving && !paused && inView

  useEffect(() => {
    if (n < 2 || !run) return
    const id = setTimeout(() => setI((x) => (x + 1) % n), SLIDE_MS)
    return () => clearTimeout(id)
  }, [k, n, run])
  // scrolled away: stop, so a video doesn't drain the battery behind the list
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver !== 'function') return
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting))
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <section ref={ref} className="relative isolate overflow-hidden" style={{ marginTop: `calc(-1 * ${HEADER})` }}>
      <div className="absolute inset-0 -z-10 bg-[#0e0b08]" aria-hidden>
        {n ? media.map((m, j) => (
          <div key={m.id} className={cn('absolute inset-0 transition-opacity duration-[1200ms]', j === k ? 'opacity-100' : 'opacity-0')}>
            {m.type === 'image' || (still && m.poster)
              ? <img src={m.type === 'image' ? m.src : m.poster!} alt="" draggable={false} loading={j === 0 ? 'eager' : 'lazy'}
                  className={cn('size-full object-cover', n > 1 && j === k && 'motion-safe:animate-kenburns', !run && '[animation-play-state:paused]')} />
              : <HeroVideo m={m} play={j === k && run} current={j === k} />}
          </div>
        )) : <Ambient />}
        {n > 0 && <div className="absolute inset-0 bg-black" style={{ opacity: menu.heroDim / 100 }} />}
        {/* shade where the words sit: under the header, at the start side on big screens, and the lower part on phones */}
        <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/60 to-transparent" />
        <div className="absolute inset-0 hidden bg-gradient-to-r from-black/65 via-black/20 to-transparent md:block rtl:bg-gradient-to-l" />
        <div className="absolute inset-x-0 bottom-0 h-[72%] bg-gradient-to-t from-bg via-bg/75 to-transparent md:h-48 md:via-bg/40" />
      </div>

      <div className="mx-auto flex min-h-[max(32rem,82svh)] max-w-6xl items-end px-4 pb-20 sm:px-6 md:min-h-[min(88svh,52rem)] md:items-center md:pb-24"
        style={{ paddingTop: `calc(${HEADER} + 3rem)` }}>
        <div className="max-w-xl">
          <p className="mb-4 flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.22em] text-gold-light"><span className="h-px w-8 bg-gold/70" />{t('kicker')}</p>
          <h1 className="text-balance font-serif text-[2.6rem] font-semibold leading-[1.05] text-white drop-shadow-[0_2px_24px_rgba(0,0,0,.45)] sm:text-6xl lg:text-7xl">
            {t('hero_a')}<br /><span className="text-gold">{t('hero_b')}</span>
          </h1>
          <p className="mt-5 max-w-md text-[0.95rem] leading-relaxed text-white/85 sm:text-base">{t('hero_p')}</p>
          <a href="#collection" className="mt-8 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-gold-light to-gold px-6 font-semibold text-ink shadow-[0_10px_30px_rgba(212,165,72,.3)] transition hover:brightness-105 sm:inline-flex sm:w-auto">
            {t('cta')}<ArrowRight className="size-5 rtl:rotate-180" />
          </a>
        </div>
      </div>

      {(n > 1 || moving) && (
        <div className="absolute inset-x-0 bottom-3 z-10">
          <div className="relative mx-auto flex h-11 max-w-6xl items-center justify-center px-4 sm:px-6">
            {n > 1 && media.map((m, j) => (
              <button key={m.id} type="button" onClick={() => setI(j)} aria-label={t('slide', { n: j + 1, total: n })} aria-current={j === k}
                className="grid h-11 place-items-center px-1.5">
                <span className={cn('block h-1.5 rounded-full transition-all', j === k ? 'w-6 bg-gold' : 'w-1.5 bg-white/55 hover:bg-white/80')} />
              </button>
            ))}
            {moving && (
              <button type="button" onClick={() => setPaused((p) => !p)} aria-label={paused ? t('bg_play') : t('bg_pause')}
                className="absolute end-4 grid size-11 place-items-center rounded-full border border-white/20 bg-black/35 text-white backdrop-blur transition hover:bg-black/55 sm:end-6">
                {paused ? <Play className="size-4 rtl:-scale-x-100" /> : <Pause className="size-4" />}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

const GRAIN = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`

/** Until the shop adds its own photos/videos: warm gold light drifting slowly over the dark, the logo faint behind it. */
function Ambient() {
  return (
    <div className="absolute inset-0 overflow-hidden">
      <div className="absolute -end-[25%] -top-[35%] aspect-square w-[min(120vw,72rem)] rounded-full bg-[radial-gradient(closest-side,rgba(212,165,72,.32),rgba(212,165,72,.08)_55%,transparent)] motion-safe:animate-glow-a" />
      <div className="absolute -bottom-[40%] -start-[30%] aspect-square w-[min(130vw,66rem)] rounded-full bg-[radial-gradient(closest-side,rgba(139,74,43,.5),transparent)] motion-safe:animate-glow-b" />
      <div className="absolute end-[12%] top-[30%] aspect-square w-[min(70vw,30rem)] rounded-full bg-[radial-gradient(closest-side,rgba(242,214,150,.16),transparent)] [animation-delay:-11s] motion-safe:animate-glow-b" />
      <Logo className="absolute end-[7%] top-1/2 hidden h-[62%] -translate-y-1/2 opacity-[0.08] md:block" />
      <div className="absolute inset-0 opacity-[0.08] mix-blend-overlay" style={{ backgroundImage: GRAIN }} />
    </div>
  )
}

function HeroVideo({ m, play, current }: { m: HeroMedia; play: boolean; current: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const v = ref.current
    if (!v) return
    // plays while it's its turn and the page is in view (a guest switching apps and back gets it moving again)
    const run = () => {
      try {
        if (play && !document.hidden) void v.play()?.catch(() => { /* the phone refused autoplay: the first frame stays */ })
        else v.pause()
      } catch { /* not a real browser */ }
    }
    run()
    document.addEventListener('visibilitychange', run)
    return () => document.removeEventListener('visibilitychange', run)
  }, [play])
  // only the video on screen loads (paused: just enough for its first frame); the others wait their turn
  return <video ref={ref} src={m.src} poster={m.poster ?? undefined} muted loop playsInline autoPlay={play} preload={play ? 'auto' : current ? 'metadata' : 'none'} className="size-full object-cover" />
}

function FilterBar({ t, f, setF, brands, bands }: { t: MenuT; f: Filters; setF: (f: Filters) => void; brands: string[]; bands: Bands }) {
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF({ ...f, [k]: v })
  return (
    <div className="sticky top-[calc(env(safe-area-inset-top)+4rem+1px)] z-20 -mx-4 mb-6 space-y-3 bg-bg/90 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
      <div className={cn('grid gap-2', bands ? 'sm:grid-cols-[1fr_auto_auto]' : 'sm:grid-cols-[1fr_auto]')}>
        <label className="relative block">
          <span className="sr-only">{t('search_ph')}</span>
          <Search className="pointer-events-none absolute start-3.5 top-1/2 size-5 -translate-y-1/2 text-fg-2" />
          <input type="search" value={f.q} onChange={(e) => set('q', e.target.value)} placeholder={t('search_ph')}
            className="h-12 w-full rounded-2xl border border-line bg-surface ps-11 pe-4 text-base outline-none placeholder:text-fg-2 focus:border-gold" />
        </label>
        <Select value={f.brand} onChange={(v) => set('brand', v)} label={t('brand_all')} options={[['all', t('brand_all')], ...brands.map((b): [string, string] => [b, b])]} />
        {bands && <Select value={f.price} onChange={(v) => set('price', v as PriceKey)} label={t('price_any')} options={[['any', t('price_any')], ['p1', t('p1', { a: fmt(bands[0]) })], ['p2', t('p2', { a: fmt(bands[0]), b: fmt(bands[1]) })], ['p3', t('p3', { b: fmt(bands[1]) })]]} />}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label={t('g_all')} className="flex gap-1 rounded-full border border-line bg-surface p-1">
          {GENDERS.map((g) => (
            <button key={g} type="button" aria-pressed={f.gender === g} onClick={() => set('gender', g)}
              className={cn('min-h-9 rounded-full px-3.5 text-sm font-medium transition', f.gender === g ? 'bg-gold text-ink' : 'text-fg-2 hover:text-fg')}>{t(`g_${g}`)}</button>
          ))}
        </div>
        <div className="scroll-hide -mx-1 flex max-w-full gap-2 overflow-x-auto px-1">
          {FAMILIES.map((x) => (
            <button key={x} type="button" aria-pressed={f.family === x} onClick={() => set('family', x)}
              className={cn('min-h-9 shrink-0 rounded-full border px-3.5 text-sm font-medium transition', f.family === x ? 'border-gold bg-gold/15 text-gold-light' : 'border-line text-fg-2 hover:text-fg')}>{t(`f_${x}`)}</button>
          ))}
        </div>
      </div>
    </div>
  )
}

function Select({ value, onChange, options, label }: { value: string; onChange: (v: string) => void; options: [string, string][]; label: string }) {
  return (
    <label className="relative block">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="h-12 w-full appearance-none rounded-2xl border border-line bg-surface ps-4 pe-10 text-sm font-medium outline-none focus:border-gold sm:w-48">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute end-3.5 top-1/2 size-4 -translate-y-1/2 text-fg-2" />
    </label>
  )
}

function Section({ title, count, children }: { title: string; count?: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <div className="mb-4 flex items-baseline justify-between gap-3 border-b border-line/60 pb-2">
        <h2 className="font-serif text-2xl font-semibold">{title}</h2>
        {count && <span className="num text-sm text-fg-2">{count}</span>}
      </div>
      {children}
    </section>
  )
}

interface CardsProps { items: MenuProduct[]; t: MenuT; lang: Lang; prices: boolean; onOpen: (p: MenuProduct) => void }

function Strip({ items, ...rest }: CardsProps) {
  return (
    <div className="scroll-hide -mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6">
      {items.map((p) => <div key={p.id} className="w-[min(15rem,62vw)] shrink-0 snap-start"><Card p={p} {...rest} /></div>)}
    </div>
  )
}

function Grid({ items, ...rest }: CardsProps) {
  return <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">{items.map((p) => <Card key={p.id} p={p} {...rest} />)}</div>
}

function Card({ p, t, lang, prices, onOpen }: Omit<CardsProps, 'items'> & { p: MenuProduct }) {
  const out = soldOut(p)
  return (
    <button type="button" onClick={() => onOpen(p)} aria-label={nameOf(p, lang)}
      className="group flex h-full w-full flex-col overflow-hidden rounded-3xl border border-line bg-surface text-start transition hover:-translate-y-0.5 hover:border-gold/60 focus-visible:border-gold">
      <div className="relative">
        <ProductImage product={p} className={cn('aspect-[4/5] w-full bg-gradient-to-b from-charcoal to-ink', out && 'opacity-50')} imgClassName="transition duration-500 group-hover:scale-[1.03]" />
        <div className="absolute start-2.5 top-2.5 flex gap-1.5">
          {p.isNew && <span className="rounded-full bg-gold px-2.5 py-0.5 text-[11px] font-bold text-ink">{t('new')}</span>}
          {p.featured && <span className="grid size-6 place-items-center rounded-full bg-ink/70 text-gold" aria-label={t('featured')}><Star className="size-3.5 fill-current" /></span>}
        </div>
        {out && <span className="absolute end-2.5 top-2.5 rounded-full bg-ink/80 px-2.5 py-0.5 text-[11px] font-semibold text-fg-2">{t('sold_out')}</span>}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3 sm:p-4">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gold">{p.brand}</span>
        <span className="font-serif text-base font-semibold leading-snug sm:text-lg">{nameOf(p, lang)}</span>
        <span className="text-xs text-fg-2"><span className="num">{p.sizes.map((s) => s.label).join(' / ')}</span> · {t(`g_${p.gender}`)} · {p.concentration}</span>
        {prices && <span className="mt-auto pt-2 text-sm"><small className="text-fg-2">{t('from')} </small><b className="num text-base text-gold-light">{fmt(fromPrice(p))}</b> <small className="text-fg-2">{t('iqd')}</small></span>}
      </div>
    </button>
  )
}

function Notice({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return <p role="status" className="mb-4 flex items-center gap-2 rounded-2xl border border-warning/40 bg-warn-bg px-4 py-2.5 text-sm text-warn-fg">{icon}{children}</p>
}

function Footer({ t, store }: { t: MenuT; store?: MenuData['store'] }) {
  return (
    <footer className="border-t border-line/60 bg-surface/40 pb-safe">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 sm:grid-cols-2 sm:px-6">
        <div className="space-y-2">
          <BrandMark size="sm" />
          <p className="flex items-center gap-2 text-sm text-fg-2"><MapPin className="size-4 shrink-0" />{store?.address || t('foot1')}</p>
          {store?.phone && <p className="flex items-center gap-2 text-sm text-fg-2"><Phone className="size-4 shrink-0" /><a href={`tel:${store.phone.replace(/\s/g, '')}`} className="num hover:text-gold-light" dir="ltr">{store.phone}</a></p>}
        </div>
        <p className="text-sm text-fg-2 sm:text-end">{t('foot2')}</p>
      </div>
      <p className="border-t border-line/40 px-4 py-4 text-center text-xs text-fg-2">
        Developed by <CodaLink className="text-gold-light" /> — Build What's Next — <span dir="ltr" className="num">+964 750 730 8005</span> — <b className="text-gold-light">@codatechagency</b>
      </p>
    </footer>
  )
}
