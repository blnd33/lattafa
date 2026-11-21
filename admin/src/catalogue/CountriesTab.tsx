import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Globe, Languages, Pencil, Plus, Star, Trash2 } from 'lucide-react'
import { Button, IconButton } from '@/components/ui/Button'
import { Badge, Card, EmptyState, Spinner, Switch } from '@/components/ui/Controls'
import { Field, Input, Select } from '@/components/ui/Field'
import { Modal, useConfirm } from '@/components/ui/Modal'
import { cn } from '@/components/ui/cn'
import { errorMessage, useT } from '@/i18n'
import { toast } from '@/store/toast'
import * as cat from './api'
import { Setting } from './Setting'

/**
 * Where the wholesale catalogue is open, and in what words it opens there.
 *
 * Both are rows, not code: add Türkiye, point it at Turkish, set its smallest order, and the catalogue opens there
 * the same evening. Nothing on this screen knows the name of a single country.
 */
export function CountriesTab({ canEdit }: { canEdit: boolean }) {
  const t = useT()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const countries = useQuery({ queryKey: ['cat-countries'], queryFn: cat.getCountries })
  const languages = useQuery({ queryKey: ['cat-languages'], queryFn: cat.getLanguages })
  const [editing, setEditing] = useState<cat.CatCountry | 'new' | null>(null)
  const [langOpen, setLangOpen] = useState(false)

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['cat-countries'] })
    void qc.invalidateQueries({ queryKey: ['cat-languages'] })
  }

  const remove = useMutation({
    mutationFn: (c: cat.CatCountry) => cat.deleteCountry(c.id),
    onSuccess: () => { refresh(); toast.success(t('wc.country_removed')) },
    onError: (e) => toast.error(errorMessage(e, t)),
  })

  if (countries.isLoading || languages.isLoading) return <div className="grid h-60 place-items-center"><Spinner className="size-9" /></div>

  const live = (languages.data ?? []).filter((l) => l.enabled)
  const languageOf = (code: string) => languages.data?.find((l) => l.code === code)

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-2 !py-3">
        <p className="text-sm text-fg-2">{t('wc.countries_hint')}</p>
        <div className="flex gap-2">
          <Button variant="secondary" icon={<Languages className="size-5" />} onClick={() => setLangOpen(true)}>{t('wc.languages')}</Button>
          {canEdit && <Button icon={<Plus className="size-5" />} onClick={() => setEditing('new')}>{t('wc.add_country')}</Button>}
        </div>
      </Card>

      {!countries.data?.length ? <Card><EmptyState title={t('wc.no_countries')} hint={t('wc.no_countries_hint')} /></Card> : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[46rem] text-sm">
            <thead className="bg-surface-2 text-xs text-fg-2">
              <tr>
                <th className="px-3 py-2.5 text-start font-semibold">{t('wc.col_country')}</th>
                <th className="px-3 py-2.5 text-start font-semibold">{t('wc.col_language')}</th>
                <th className="px-3 py-2.5 text-end font-semibold">{t('wc.col_min_order')}</th>
                <th className="px-3 py-2.5 text-end font-semibold">{t('wc.col_buyers')}</th>
                <th className="px-3 py-2.5 text-start font-semibold">{t('wc.col_open')}</th>
                <th className="w-24 px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {countries.data.map((c) => {
                const lang = languageOf(c.language)
                const speechless = c.enabled && !lang?.enabled
                return (
                  <tr key={c.id} className="border-t border-line">
                    <td className="px-3 py-2.5">
                      <span className="font-medium">{c.name.en || c.iso2}</span>
                      <span className="num ms-2 text-xs text-fg-2">{c.iso2}</span>
                      {c.isDefault && <Badge tone="gold" className="ms-2"><Star className="size-3" />{t('wc.first_offered')}</Badge>}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={cn(speechless && 'text-danger-fg')}>{lang?.native ?? c.language}</span>
                      {speechless && <span className="ms-2 text-xs text-danger-fg">{t('wc.language_off')}</span>}
                    </td>
                    <td className="num px-3 py-2.5 text-end">{c.minOrderCents ? `$${c.minOrderCents / 100}` : '—'}</td>
                    <td className="num px-3 py-2.5 text-end text-fg-2">{c.customers ?? 0}</td>
                    <td className="px-3 py-2.5">
                      <Badge tone={c.enabled ? 'ok' : 'neutral'}>{t(c.enabled ? 'wc.open' : 'wc.closed')}</Badge>
                    </td>
                    <td className="px-3 py-2.5">
                      {canEdit && (
                        <div className="flex justify-end gap-1">
                          <IconButton label={t('common.edit')} variant="ghost" onClick={() => setEditing(c)}><Pencil className="size-4" /></IconButton>
                          <IconButton
                            label={t('common.delete')}
                            variant="ghost"
                            onClick={async () => {
                              if (await confirm({ title: t('wc.remove_country', { name: c.name.en || c.iso2 }), message: t('wc.remove_country_q'), danger: true })) remove.mutate(c)
                            }}
                          ><Trash2 className="size-4 text-danger-fg" /></IconButton>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <CountryEditor
          country={editing === 'new' ? null : editing}
          languages={languages.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh() }}
        />
      )}
      {langOpen && <LanguageEditor languages={languages.data ?? []} canEdit={canEdit} onClose={() => setLangOpen(false)} onChanged={refresh} />}
      {!live.length && <p className="text-sm text-danger-fg">{t('wc.no_language_on')}</p>}
    </div>
  )
}

function CountryEditor({ country, languages, onClose, onSaved }: { country: cat.CatCountry | null; languages: cat.CatLanguage[]; onClose: () => void; onSaved: () => void }) {
  const t = useT()
  const [iso2, setIso2] = useState(country?.iso2 ?? '')
  const [names, setNames] = useState<Record<string, string>>(country?.name ?? {})
  const [language, setLanguage] = useState(country?.language ?? languages.find((l) => l.enabled)?.code ?? '')
  const [enabled, setEnabled] = useState(country?.enabled ?? true)
  const [isDefault, setIsDefault] = useState(country?.isDefault ?? false)
  const [minOrder, setMinOrder] = useState(cat.toDollars(country?.minOrderCents ?? 0) || '')
  const [sort, setSort] = useState(String(country?.sort ?? 0))
  const [busy, setBusy] = useState(false)

  const badMin = minOrder.trim() !== '' && cat.toCents(minOrder) === null

  const save = async () => {
    if (badMin) return toast.error(t('wc.bad_number'))
    setBusy(true)
    try {
      await cat.saveCountry({
        iso2: iso2.trim().toUpperCase(),
        name: names,
        language,
        enabled,
        isDefault,
        sort: Number(sort) || 0,
        minOrderCents: minOrder.trim() === '' ? 0 : (cat.toCents(minOrder) ?? 0),
      }, country?.id)
      toast.success(t('wc.country_saved'))
      onSaved()
    } catch (e) { toast.error(errorMessage(e, t)) } finally { setBusy(false) }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={country ? t('wc.edit_country') : t('wc.add_country')}
      footer={<>
        <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
        <Button loading={busy} onClick={() => void save()} icon={<Check className="size-5" />}>{t('common.save')}</Button>
      </>}
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('wc.iso2')} hint={t('wc.iso2_hint')}>
            {(id) => <Input id={id} dir="ltr" className="num uppercase" maxLength={2} value={iso2} onChange={(e) => setIso2(e.target.value)} placeholder="TR" />}
          </Field>
          <Field label={t('wc.opens_in')}>
            {(id) => (
              <Select id={id} value={language} onChange={(e) => setLanguage(e.target.value)}>
                {languages.map((l) => <option key={l.code} value={l.code}>{l.native} {l.enabled ? '' : `— ${t('wc.language_off')}`}</option>)}
              </Select>
            )}
          </Field>
        </div>

        <div>
          <div className="mb-1.5 text-sm font-medium">{t('wc.country_name')}</div>
          <p className="mb-2 text-xs text-fg-2">{t('wc.country_name_hint')}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {languages.map((l) => (
              <Field key={l.code} label={l.native}>
                {(id) => (
                  <Input id={id} dir={l.rtl ? 'rtl' : 'ltr'} value={names[l.code] ?? ''}
                    onChange={(e) => setNames((n) => ({ ...n, [l.code]: e.target.value }))} />
                )}
              </Field>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('wc.min_order')} hint={t('wc.min_order_hint')}>
            {(id) => (
              <div className="flex items-center gap-1">
                <span className="text-fg-2">$</span>
                <Input id={id} dir="ltr" inputMode="decimal" className={cn('num', badMin && 'ring-2 ring-inset ring-danger')} value={minOrder} onChange={(e) => setMinOrder(e.target.value)} placeholder="0" />
              </div>
            )}
          </Field>
          <Field label={t('wc.sort')} hint={t('wc.sort_hint')}>
            {(id) => <Input id={id} dir="ltr" inputMode="numeric" className="num" value={sort} onChange={(e) => setSort(e.target.value)} />}
          </Field>
        </div>

        <div className="space-y-3 rounded-xl bg-surface-2 p-3">
          <Setting checked={enabled} onChange={setEnabled} label={t('wc.open_here')} />
          <Setting checked={isDefault} onChange={setIsDefault} disabled={!enabled} label={t('wc.offer_first')} />
        </div>
      </div>
    </Modal>
  )
}

function LanguageEditor({ languages, canEdit, onClose, onChanged }: { languages: cat.CatLanguage[]; canEdit: boolean; onClose: () => void; onChanged: () => void }) {
  const t = useT()
  const [adding, setAdding] = useState(false)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [native, setNative] = useState('')
  const [rtl, setRtl] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const toggle = async (l: cat.CatLanguage, enabled: boolean) => {
    setBusy(l.code)
    try {
      await cat.saveLanguage({ code: l.code, enabled })
      onChanged()
    } catch (e) { toast.error(errorMessage(e, t)) } finally { setBusy(null) }
  }

  const add = async () => {
    setBusy('new')
    try {
      await cat.saveLanguage({ code: code.trim().toLowerCase(), name: name.trim() || code, native: native.trim() || name.trim() || code, rtl, enabled: true })
      setAdding(false); setCode(''); setName(''); setNative(''); setRtl(false)
      onChanged()
      toast.success(t('wc.language_added'))
    } catch (e) { toast.error(errorMessage(e, t)) } finally { setBusy(null) }
  }

  return (
    <Modal open onClose={onClose} title={t('wc.languages')} footer={<Button variant="secondary" onClick={onClose}>{t('common.close')}</Button>}>
      <div className="space-y-3">
        <p className="text-sm text-fg-2">{t('wc.languages_hint')}</p>
        <ul className="divide-y divide-line rounded-xl border border-line">
          {languages.map((l) => (
            <li key={l.code} className="flex items-center gap-3 px-3 py-2.5">
              <Globe className="size-4 shrink-0 text-fg-2" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{l.native}</div>
                <div className="num text-xs text-fg-2">{l.name} · {l.code}{l.rtl ? ' · RTL' : ''}</div>
              </div>
              {busy === l.code ? <Spinner className="size-5" /> : (
                <Switch checked={l.enabled} disabled={!canEdit} onChange={(v) => void toggle(l, v)} label={t('wc.language_on')} />
              )}
            </li>
          ))}
        </ul>

        {canEdit && (adding ? (
          <div className="space-y-3 rounded-xl bg-surface-2 p-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <Field label={t('wc.lang_code')}>{(id) => <Input id={id} dir="ltr" className="num" value={code} onChange={(e) => setCode(e.target.value)} placeholder="es" />}</Field>
              <Field label={t('wc.lang_name')}>{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="Spanish" />}</Field>
              <Field label={t('wc.lang_native')}>{(id) => <Input id={id} value={native} onChange={(e) => setNative(e.target.value)} placeholder="Español" />}</Field>
            </div>
            <Setting checked={rtl} onChange={setRtl} label={t('wc.lang_rtl')} />
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setAdding(false)}>{t('common.cancel')}</Button>
              <Button loading={busy === 'new'} disabled={!code.trim()} onClick={() => void add()}>{t('wc.add')}</Button>
            </div>
          </div>
        ) : <Button variant="secondary" icon={<Plus className="size-5" />} onClick={() => setAdding(true)}>{t('wc.add_language')}</Button>)}
      </div>
    </Modal>
  )
}
