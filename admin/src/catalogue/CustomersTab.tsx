import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Ban, Copy, KeyRound, Pencil, Plus, ShieldOff, Store, Trash2 } from 'lucide-react'
import { Button, IconButton } from '@/components/ui/Button'
import { Badge, Card, EmptyState, PageHeader, Segmented, Spinner } from '@/components/ui/Controls'
import { Field, Input, SearchInput, Select, Textarea } from '@/components/ui/Field'
import { Modal, useConfirm } from '@/components/ui/Modal'
import { cn } from '@/components/ui/cn'
import { errorMessage, useT } from '@/i18n'
import { toast } from '@/store/toast'
import * as cat from './api'
import { CustomerTerms } from './CustomerTerms'
import { Setting } from './Setting'

const STATUS_TONE = { active: 'ok', suspended: 'warn', closed: 'neutral' } as const

/** The businesses that buy wholesale: the list, and everything about one of them. */
export function CustomersTab({ canEditPrices, canEditRules }: { canEditPrices: boolean; canEditRules: boolean }) {
  const t = useT()
  const [open, setOpen] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [editing, setEditing] = useState<cat.Buyer | 'new' | null>(null)
  const qc = useQueryClient()

  const buyers = useQuery({
    queryKey: ['cat-buyers', search, status],
    queryFn: () => cat.getBuyers({ q: search || undefined, status: status || undefined }),
  })
  const countries = useQuery({ queryKey: ['cat-countries'], queryFn: cat.getCountries })

  if (open) {
    return (
      <BuyerDetail
        id={open}
        canEditPrices={canEditPrices}
        canEditRules={canEditRules}
        countries={countries.data ?? []}
        onBack={() => { setOpen(null); void qc.invalidateQueries({ queryKey: ['cat-buyers'] }) }}
        onEdit={(b) => setEditing(b)}
      />
    )
  }

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-2 !py-3">
        <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('wc.search_buyers')} className="min-w-52 flex-1" />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t('wc.status')} className="!w-auto">
          <option value="">{t('wc.all_statuses')}</option>
          {(['active', 'suspended', 'closed'] as const).map((s) => <option key={s} value={s}>{t(`wc.status_${s}`)}</option>)}
        </Select>
        <Button icon={<Plus className="size-5" />} onClick={() => setEditing('new')}>{t('wc.add_buyer')}</Button>
      </Card>

      {buyers.isLoading ? <div className="grid h-60 place-items-center"><Spinner className="size-9" /></div>
        : !buyers.data?.length ? <Card><EmptyState title={t('wc.no_buyers')} hint={search ? undefined : t('wc.no_buyers_hint')} /></Card> : (
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full min-w-[44rem] text-sm">
              <thead className="bg-surface-2 text-xs text-fg-2">
                <tr>
                  <th className="px-3 py-2.5 text-start font-semibold">{t('wc.col_business')}</th>
                  <th className="px-3 py-2.5 text-start font-semibold">{t('wc.col_country')}</th>
                  <th className="px-3 py-2.5 text-start font-semibold">{t('wc.col_contact')}</th>
                  <th className="px-3 py-2.5 text-end font-semibold">{t('wc.col_codes')}</th>
                  <th className="px-3 py-2.5 text-start font-semibold">{t('wc.status')}</th>
                </tr>
              </thead>
              <tbody>
                {buyers.data.map((b) => (
                  <tr key={b.id} className="cursor-pointer border-t border-line hover:bg-surface-2" onClick={() => setOpen(b.id)}>
                    <td className="px-3 py-2.5 font-medium">{b.businessName}</td>
                    <td className="px-3 py-2.5 text-fg-2">{b.country?.name.en ?? b.country?.iso2 ?? '—'}</td>
                    <td className="px-3 py-2.5 text-fg-2">
                      <span className="block truncate">{b.contactPerson || '—'}</span>
                      {b.whatsapp && <span className="num block text-xs" dir="ltr">{b.whatsapp}</span>}
                    </td>
                    <td className="num px-3 py-2.5 text-end">{b.liveCodes ?? 0}</td>
                    <td className="px-3 py-2.5"><Badge tone={STATUS_TONE[b.status]}>{t(`wc.status_${b.status}`)}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      {editing && (
        <BuyerEditor
          buyer={editing === 'new' ? null : editing}
          countries={countries.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={(id) => {
            setEditing(null)
            void qc.invalidateQueries({ queryKey: ['cat-buyers'] })
            void qc.invalidateQueries({ queryKey: ['cat-buyer', id] })
          }}
        />
      )}
    </div>
  )
}

function BuyerDetail({ id, countries, canEditPrices, canEditRules, onBack, onEdit }: {
  id: string
  countries: cat.CatCountry[]
  canEditPrices: boolean
  canEditRules: boolean
  onBack: () => void
  onEdit: (b: cat.Buyer) => void
}) {
  const t = useT()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [tab, setTab] = useState<'details' | 'codes' | 'terms'>('details')
  const buyer = useQuery({ queryKey: ['cat-buyer', id], queryFn: () => cat.getBuyer(id) })
  const b = buyer.data

  if (buyer.isLoading || !b) return <div className="grid h-60 place-items-center"><Spinner className="size-9" /></div>

  const setStatus = async (status: cat.CustomerStatus) => {
    if (status !== 'active' && !(await confirm({
      title: t('wc.hold_q', { name: b.businessName }),
      message: t('wc.hold_hint'),
      danger: true,
    }))) return
    try {
      await cat.setBuyerStatus(b.id, status)
      await qc.invalidateQueries({ queryKey: ['cat-buyer', id] })
      toast.success(t('wc.status_changed'))
    } catch (e) { toast.error(errorMessage(e, t)) }
  }

  /**
   * Removes the business altogether — for one entered by mistake.
   *
   * Its codes, sessions, agreed prices and discount go with it. A business that has ever ordered cannot be
   * removed, and the server says so by name; closing it is the answer there, and the message says that too.
   */
  const remove = async () => {
    if (!(await confirm({
      title: t('wc.remove_buyer_q', { name: b.businessName }),
      message: t('wc.remove_buyer_hint'),
      confirmLabel: t('common.delete'),
      danger: true,
    }))) return
    try {
      await cat.deleteBuyer(b.id)
      toast.success(t('wc.buyer_removed', { name: b.businessName }))
      onBack()
    } catch (e) { toast.error(errorMessage(e, t)) }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={<span className="flex items-center gap-2"><Store className="size-5 text-gold-text" />{b.businessName}</span>}
        subtitle={<Badge tone={STATUS_TONE[b.status]}>{t(`wc.status_${b.status}`)}</Badge>}
        actions={<>
          <Button variant="ghost" icon={<ArrowLeft className="size-5 rtl:rotate-180" />} onClick={onBack}>{t('common.back')}</Button>
          <Button variant="secondary" icon={<Pencil className="size-5" />} onClick={() => onEdit(b)}>{t('common.edit')}</Button>
          {b.status === 'active'
            ? <Button variant="secondary" icon={<Ban className="size-5" />} onClick={() => void setStatus('suspended')}>{t('wc.put_on_hold')}</Button>
            : <Button variant="secondary" onClick={() => void setStatus('active')}>{t('wc.let_back_in')}</Button>}
          {/* last, and the only one that is not reversible */}
          {!b.ordersCount && <IconButton label={t('common.delete')} variant="ghost" onClick={() => void remove()}><Trash2 className="size-5 text-danger-fg" /></IconButton>}
        </>}
      />

      <Segmented
        value={tab}
        onChange={setTab}
        ariaLabel={t('wc.buyer_sections')}
        options={(['details', 'codes', 'terms'] as const).map((x) => ({ value: x, label: t(`wc.tab_${x}`) }))}
      />

      {tab === 'details' && <BuyerFacts buyer={b} canEditRules={canEditRules} />}
      {tab === 'codes' && <Codes buyer={b} countries={countries} onChanged={() => void qc.invalidateQueries({ queryKey: ['cat-buyer', id] })} />}
      {tab === 'terms' && <CustomerTerms customerId={b.id} canEdit={canEditPrices} />}
    </div>
  )
}

function BuyerFacts({ buyer, canEditRules }: { buyer: cat.Buyer; canEditRules: boolean }) {
  const t = useT()
  const qc = useQueryClient()
  const exemptions = useQuery({ queryKey: ['cat-exemptions', buyer.id], queryFn: () => cat.getExemptions(buyer.id) })
  const [busy, setBusy] = useState(false)

  const toggle = async (kind: cat.Exemption, on: boolean) => {
    const now = new Set(exemptions.data ?? [])
    if (on) now.add(kind); else now.delete(kind)
    setBusy(true)
    try {
      await cat.setExemptions(buyer.id, [...now])
      await qc.invalidateQueries({ queryKey: ['cat-exemptions', buyer.id] })
    } catch (e) { toast.error(errorMessage(e, t)) } finally { setBusy(false) }
  }

  const fact = (label: string, value: string, dir?: 'ltr') => (
    <div>
      <dt className="text-xs text-fg-2">{label}</dt>
      <dd className={cn('text-sm', dir === 'ltr' && 'num')} dir={dir}>{value || '—'}</dd>
    </div>
  )

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <h3 className="mb-3 font-serif text-lg">{t('wc.the_business')}</h3>
        <dl className="grid grid-cols-2 gap-3">
          {fact(t('wc.contact'), buyer.contactPerson)}
          {fact(t('wc.country'), buyer.country?.name.en ?? buyer.country?.iso2 ?? '')}
          {fact(t('wc.phone'), buyer.phone, 'ltr')}
          {fact(t('wc.whatsapp'), buyer.whatsapp, 'ltr')}
          {fact(t('wc.email'), buyer.email, 'ltr')}
          {fact(t('wc.orders'), String(buyer.ordersCount))}
        </dl>
        {buyer.address && <p className="mt-3 whitespace-pre-line text-sm text-fg-2">{buyer.address}</p>}
        {buyer.notes && (
          <div className="mt-3 rounded-xl bg-surface-2 p-3">
            <div className="mb-1 text-xs font-medium text-fg-2">{t('wc.our_notes')}</div>
            <p className="whitespace-pre-line text-sm">{buyer.notes}</p>
          </div>
        )}
      </Card>

      <Card>
        <h3 className="mb-1 font-serif text-lg">{t('wc.let_off')}</h3>
        <p className="mb-3 text-sm text-fg-2">{t('wc.let_off_hint')}</p>
        {exemptions.isLoading ? <Spinner className="size-6" /> : (
          <div className="space-y-2">
            {cat.EXEMPTIONS.map((kind) => (
              <Setting
                key={kind}
                kind="check"
                checked={(exemptions.data ?? []).includes(kind)}
                disabled={!canEditRules || busy}
                onChange={(v) => void toggle(kind, v)}
                label={t(`wc.exempt_${kind}`)}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

function Codes({ buyer, countries, onChanged }: { buyer: cat.Buyer; countries: cat.CatCountry[]; onChanged: () => void }) {
  const t = useT()
  const confirm = useConfirm()
  const [fresh, setFresh] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [restrict, setRestrict] = useState('')
  const codes = buyer.codes ?? []

  const make = async () => {
    setBusy('new')
    try {
      const { plain } = await cat.generateCode(buyer.id, { countryId: restrict || null })
      setFresh(plain)
      onChanged()
    } catch (e) { toast.error(errorMessage(e, t)) } finally { setBusy(null) }
  }

  const act = async (code: cat.AccessCode, what: 'pause' | 'resume' | 'revoke') => {
    if (what === 'revoke' && !(await confirm({ title: t('wc.revoke_q'), message: t('wc.revoke_hint'), danger: true }))) return
    setBusy(code.id)
    try {
      if (what === 'revoke') await cat.revokeCode(code.id)
      else await cat.setCodeActive(code.id, what === 'resume')
      onChanged()
    } catch (e) { toast.error(errorMessage(e, t)) } finally { setBusy(null) }
  }

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-end gap-2 !py-3">
        <Field label={t('wc.restrict_to')} hint={t('wc.restrict_hint')} className="min-w-52 flex-1">
          {(id) => (
            <Select id={id} value={restrict} onChange={(e) => setRestrict(e.target.value)}>
              <option value="">{t('wc.buyers_own_country')}</option>
              {countries.map((c) => <option key={c.id} value={c.id}>{c.name.en || c.iso2}</option>)}
            </Select>
          )}
        </Field>
        <Button icon={<KeyRound className="size-5" />} loading={busy === 'new'} onClick={() => void make()}>{t('wc.new_code')}</Button>
      </Card>

      {!codes.length ? <Card><EmptyState title={t('wc.no_codes')} hint={t('wc.no_codes_hint')} /></Card> : (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {codes.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 px-3 py-3">
              <span className="num font-semibold tracking-wider" dir="ltr">{c.display}</span>
              {c.revoked ? <Badge tone="danger">{t('wc.code_revoked')}</Badge>
                : c.active ? <Badge tone="ok">{t('wc.code_live')}</Badge>
                  : <Badge tone="warn">{t('wc.code_paused')}</Badge>}
              {c.countryId && <Badge tone="neutral">{countries.find((x) => x.id === c.countryId)?.iso2 ?? '—'}</Badge>}
              <span className="num text-xs text-fg-2">{t('wc.used_n', { n: c.uses })}</span>
              <div className="ms-auto flex gap-1">
                {!c.revoked && (busy === c.id ? <Spinner className="size-5" /> : (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => void act(c, c.active ? 'pause' : 'resume')}>
                      {t(c.active ? 'wc.pause' : 'wc.resume')}
                    </Button>
                    <IconButton label={t('wc.revoke')} variant="ghost" onClick={() => void act(c, 'revoke')}><ShieldOff className="size-4 text-danger-fg" /></IconButton>
                  </>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}

      <FreshCode code={fresh} business={buyer.businessName} onClose={() => setFresh(null)} />
    </div>
  )
}

/** A code is readable exactly once. This is that once. */
function FreshCode({ code, business, onClose }: { code: string | null; business: string; onClose: () => void }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  if (!code) return null
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
    } catch { toast.error(t('wc.copy_failed')) }
  }
  return (
    <Modal open onClose={onClose} size="sm" title={t('wc.code_for', { name: business })} footer={<Button onClick={onClose}>{t('wc.written_down')}</Button>}>
      <div className="space-y-3 text-center">
        <p className="text-sm text-fg-2">{t('wc.code_once')}</p>
        <div className="num select-all rounded-xl bg-surface-2 py-4 text-2xl font-semibold tracking-[0.2em]" dir="ltr">{code}</div>
        <Button variant="secondary" icon={<Copy className="size-5" />} onClick={() => void copy()}>{copied ? t('wc.copied') : t('wc.copy')}</Button>
      </div>
    </Modal>
  )
}

function BuyerEditor({ buyer, countries, onClose, onSaved }: { buyer: cat.Buyer | null; countries: cat.CatCountry[]; onClose: () => void; onSaved: (id: string) => void }) {
  const t = useT()
  const [f, setF] = useState({
    businessName: buyer?.businessName ?? '',
    contactPerson: buyer?.contactPerson ?? '',
    email: buyer?.email ?? '',
    phone: buyer?.phone ?? '',
    whatsapp: buyer?.whatsapp ?? '',
    countryId: buyer?.countryId ?? '',
    address: buyer?.address ?? '',
    status: (buyer?.status ?? 'active') as cat.CustomerStatus,
    notes: buyer?.notes ?? '',
  })
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))

  const save = async () => {
    if (!f.businessName.trim()) return toast.error(t('wc.business_needed'))
    setBusy(true)
    try {
      const saved = await cat.saveBuyer({ ...f, countryId: f.countryId || null }, buyer?.id)
      toast.success(t('wc.buyer_saved'))
      onSaved(saved.id)
    } catch (e) { toast.error(errorMessage(e, t)) } finally { setBusy(false) }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={buyer ? t('wc.edit_buyer') : t('wc.add_buyer')}
      footer={<>
        <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
        <Button loading={busy} onClick={() => void save()}>{t('common.save')}</Button>
      </>}
    >
      <div className="space-y-3">
        <Field label={t('wc.business_name')}>{(id) => <Input id={id} value={f.businessName} onChange={(e) => set('businessName', e.target.value)} />}</Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('wc.contact')}>{(id) => <Input id={id} value={f.contactPerson} onChange={(e) => set('contactPerson', e.target.value)} />}</Field>
          <Field label={t('wc.country')}>
            {(id) => (
              <Select id={id} value={f.countryId} onChange={(e) => set('countryId', e.target.value)}>
                <option value="">—</option>
                {countries.map((c) => <option key={c.id} value={c.id}>{c.name.en || c.iso2}</option>)}
              </Select>
            )}
          </Field>
          <Field label={t('wc.phone')}>{(id) => <Input id={id} dir="ltr" className="num" value={f.phone} onChange={(e) => set('phone', e.target.value)} />}</Field>
          <Field label={t('wc.whatsapp')}>{(id) => <Input id={id} dir="ltr" className="num" value={f.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} />}</Field>
          <Field label={t('wc.email')}>{(id) => <Input id={id} dir="ltr" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} />}</Field>
          <Field label={t('wc.status')}>
            {(id) => (
              <Select id={id} value={f.status} onChange={(e) => set('status', e.target.value as cat.CustomerStatus)}>
                {(['active', 'suspended', 'closed'] as const).map((s) => <option key={s} value={s}>{t(`wc.status_${s}`)}</option>)}
              </Select>
            )}
          </Field>
        </div>
        <Field label={t('wc.address')}>{(id) => <Textarea id={id} rows={2} value={f.address} onChange={(e) => set('address', e.target.value)} />}</Field>
        <Field label={t('wc.our_notes')} hint={t('wc.notes_hint')}>
          {(id) => <Textarea id={id} rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} />}
        </Field>
      </div>
    </Modal>
  )
}
