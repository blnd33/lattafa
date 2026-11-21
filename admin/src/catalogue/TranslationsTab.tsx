import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Save } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, EmptyState, Spinner } from '@/components/ui/Controls'
import { Select, SearchInput, Textarea } from '@/components/ui/Field'
import { cn } from '@/components/ui/cn'
import { errorMessage, useT } from '@/i18n'
import { toast } from '@/store/toast'
import * as cat from './api'

/**
 * The catalogue's own words, one language at a time.
 *
 * English is beside every box, because a translator who cannot see what they are translating writes nonsense. A box
 * left empty is not a blank button — the word falls back to English, which is why clearing one is a perfectly good
 * thing to do.
 *
 * Nothing here is ever machine-translated, and a perfume's own name and description are not touched: those are the
 * shop's, and they live with the product.
 */
export function TranslationsTab({ canEdit }: { canEdit: boolean }) {
  const t = useT()
  const qc = useQueryClient()
  const progress = useQuery({ queryKey: ['cat-progress'], queryFn: cat.getProgress })
  const [language, setLanguage] = useState('')
  const [search, setSearch] = useState('')
  const [only, setOnly] = useState<'all' | 'missing'>('all')
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const languages = progress.data ?? []
  const chosen = language || languages.find((l) => l.language !== 'en')?.language || languages[0]?.language || ''

  const sheet = useQuery({
    queryKey: ['cat-translations', chosen],
    queryFn: () => cat.getTranslations(chosen),
    enabled: !!chosen,
  })

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return (sheet.data?.rows ?? []).filter((r) => {
      const value = edits[r.key] ?? r.value
      if (only === 'missing' && value.trim() !== '') return false
      if (!needle) return true
      return `${r.key} ${r.en} ${value}`.toLowerCase().includes(needle)
    })
  }, [sheet.data, search, only, edits])

  const changed = Object.entries(edits).filter(([key, value]) => {
    const row = sheet.data?.rows.find((r) => r.key === key)
    return row !== undefined && value.trim() !== row.value
  })

  const save = async () => {
    if (!changed.length) return
    setBusy(true)
    try {
      const n = await cat.saveTranslations(chosen, Object.fromEntries(changed.map(([k, v]) => [k, v.trim()])))
      setEdits({})
      await Promise.all([sheet.refetch(), qc.invalidateQueries({ queryKey: ['cat-progress'] })])
      toast.success(t('wc.translations_saved', { n }))
    } catch (e) { toast.error(errorMessage(e, t)) } finally { setBusy(false) }
  }

  if (progress.isLoading) return <div className="grid h-60 place-items-center"><Spinner className="size-9" /></div>

  const mine = languages.find((l) => l.language === chosen)
  // Counted from what is on screen, so the bar moves as words are typed rather than only after Save. English is the
  // exception: it ships complete in the code, and a box left empty there means "as written", not "missing".
  const done = chosen === 'en' ? (mine?.total ?? 0)
    : sheet.data ? sheet.data.rows.filter((r) => (edits[r.key] ?? r.value).trim() !== '').length
      : (mine?.done ?? 0)

  return (
    <div className="space-y-4">
      <Card className="!py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={chosen} onChange={(e) => { setLanguage(e.target.value); setEdits({}) }} aria-label={t('wc.language')} className="!w-auto min-w-44">
            {languages.map((l) => <option key={l.language} value={l.language}>{l.native} — {l.done}/{l.total}</option>)}
          </Select>
          <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('wc.search_words')} className="min-w-52 flex-1" />
          <Select value={only} onChange={(e) => setOnly(e.target.value as 'all' | 'missing')} aria-label={t('wc.show')} className="!w-auto">
            <option value="all">{t('wc.all_words')}</option>
            <option value="missing">{t('wc.missing_only')}</option>
          </Select>
          {canEdit && (
            <Button icon={<Save className="size-5" />} loading={busy} disabled={!changed.length} onClick={() => void save()}>
              {changed.length ? t('wc.save_n', { n: changed.length }) : t('common.save')}
            </Button>
          )}
        </div>
        {mine && (
          <div className="mt-3 flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-gold transition-[width]" style={{ width: `${mine.total ? Math.round((done / mine.total) * 100) : 0}%` }} />
            </div>
            <span className="num text-xs text-fg-2">{done}/{mine.total}</span>
          </div>
        )}
        {chosen === 'en' && <p className="mt-2 text-xs text-fg-2">{t('wc.english_hint')}</p>}
      </Card>

      {sheet.isLoading ? <div className="grid h-60 place-items-center"><Spinner className="size-9" /></div>
        : !rows.length ? <Card><EmptyState title={t('wc.no_words')} hint={only === 'missing' ? t('wc.nothing_missing') : undefined} /></Card> : (
          <div className="overflow-hidden rounded-2xl border border-line bg-surface">
            <ul className="divide-y divide-line">
              {rows.map((r) => {
                const value = edits[r.key] ?? r.value
                const empty = value.trim() === ''
                return (
                  <li key={r.key} className="grid gap-2 p-3 sm:grid-cols-2 sm:gap-4">
                    <div className="min-w-0">
                      <div className="num text-[11px] uppercase tracking-wide text-fg-2">{r.key}</div>
                      <div dir="ltr" className="mt-0.5 text-sm">{r.en}</div>
                    </div>
                    <Textarea
                      rows={1}
                      dir="auto"
                      aria-label={`${r.key} — ${chosen}`}
                      className={cn('min-h-11 resize-y', empty && 'bg-warn-bg/40')}
                      value={value}
                      readOnly={!canEdit}
                      placeholder={t('wc.falls_back')}
                      onChange={(e) => setEdits((x) => ({ ...x, [r.key]: e.target.value }))}
                    />
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      <p className="text-xs text-fg-2">{t('wc.translations_hint')}</p>
    </div>
  )
}
