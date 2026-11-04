import { useEffect, useMemo, useState } from 'react'
import { SyncCard } from './SyncCard'
import { useQuery } from '@tanstack/react-query'
import { AlertOctagon, Download, Printer, RotateCcw, Save, Upload } from 'lucide-react'
import { Card, PageHeader, Segmented, Spinner, Switch } from '@/components/ui/Controls'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Modal, useConfirm } from '@/components/ui/Modal'
import { useT } from '@/i18n'
import { APP, SESSION_KEY } from '@/data/app'
import type { AppSettings, Sale } from '@/data/types'
import { downloadText } from '@/lib/image'
import { parseAmount } from '@/lib/money'
import { exportBackup, importBackup, isBackupFile, wipeAll } from '@/services/backup'
import { updateSettings } from '@/services/settings'
import { useAction, useSettings } from '@/hooks/queries'
import { useCan } from '@/hooks/useAuth'
import { toast } from '@/store/toast'
import { useUI } from '@/store/ui'
import { printReceipt } from '@/features/sell/Receipt'

type Tab = 'store' | 'money' | 'rules' | 'security' | 'data'

const clone = <T,>(x: T): T => structuredClone(x)

/** A fake sale used to preview / test-print the receipt layout. */
function sampleSale(s: AppSettings): Sale {
  return {
    id: 'sample', number: `${s.device.code}-000000`, shiftId: null, userId: 'x', userName: 'Cashier', customerId: null, customerName: '', channel: 'store', status: 'completed',
    items: [
      { variantId: 'a', productId: 'a', name: { en: 'Khamrah', ar: 'خمرة', ku: 'خەمرە' }, brand: 'Lattafa', label: '100 ml', sku: 'X', barcode: '0', qty: 1, unitPriceIQD: 45000, unitCostIQD: 0, discountPct: 0, discountIQD: 0, lineTotalIQD: 45000, returnedQty: 0 },
      { variantId: 'b', productId: 'b', name: { en: 'Yara', ar: 'يارا', ku: 'یارا' }, brand: 'Lattafa', label: '100 ml', sku: 'Y', barcode: '0', qty: 2, unitPriceIQD: 38000, unitCostIQD: 0, discountPct: 10, discountIQD: 7600, lineTotalIQD: 68400, returnedQty: 0 },
    ],
    subtotalIQD: 121000, itemDiscountIQD: 7600, orderDiscountIQD: 0, orderDiscount: null, giftWrapIQD: 2000, taxIQD: 0, roundingIQD: 100, pointsRedeemedIQD: 0, totalIQD: 115500,
    payments: [{ method: 'cash_iqd', amountIQD: 115500, tendered: 120000, currency: 'IQD', rate: s.currency.rate, reference: '' }],
    paidIQD: 115500, changeIQD: 4500, dueIQD: 0, pointsEarned: 115, pointsRedeemed: 0, exchangeRate: s.currency.rate, note: '', approvedBy: null, deviceId: s.device.id, createdAt: Date.now(), voidedAt: null, voidReason: '',
  }
}

export function SettingsPage() {
  const t = useT()
  const lang = useUI((s) => s.lang)
  const canEdit = useCan('settings.edit')
  const canBackup = useCan('backup.manage')
  const confirm = useConfirm()
  const { data: saved, isLoading } = useSettings()
  const [draft, setDraft] = useState<AppSettings | null>(null)
  const [tab, setTab] = useState<Tab>('store')
  const save = useAction(updateSettings, { success: 'settings.saved' })
  const backup = useAction(exportBackup)
  const [restore, setRestore] = useState<{ file: ReturnType<typeof JSON.parse>; name: string } | null>(null)
  const [wipe, setWipe] = useState(false)
  const [phrase, setPhrase] = useState('')
  const { data: storage } = useQuery({ queryKey: ['storage'], queryFn: async () => { const e = await navigator.storage?.estimate?.(); return e ? { used: e.usage ?? 0, quota: e.quota ?? 0 } : null } })

  useEffect(() => { if (saved && !draft) setDraft(clone(saved)) }, [saved, draft])
  const dirty = useMemo(() => !!saved && !!draft && JSON.stringify(saved) !== JSON.stringify(draft), [saved, draft])
  if (isLoading || !draft || !saved) return <div className="grid h-full place-items-center"><Spinner className="size-9" /></div>

  const up = (fn: (d: AppSettings) => void) => setDraft((d) => { const n = clone(d!); fn(n); return n })
  const ro = !canEdit
  const submit = async () => {
    const { key: _k, setupDone: _s, device: _d, ...patch } = draft
    void _k; void _s; void _d
    if (await save(patch)) setDraft(null)
  }

  const doBackup = async () => {
    const b = await backup()
    if (b) downloadText(`lattafa-pos-backup-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`, JSON.stringify(b), 'application/json')
  }
  const onRestoreFile = async (f?: File) => {
    if (!f) return
    try { const j = JSON.parse(await f.text()); if (!isBackupFile(j)) throw new Error('bad'); setRestore({ file: j, name: f.name }) } catch { toast.error(t('err.invalid_backup')) }
  }
  const doRestore = async () => {
    if (!restore) return
    await importBackup(restore.file)
    localStorage.removeItem(SESSION_KEY); localStorage.removeItem('lattafa-cart')
    location.reload()
  }
  const doWipe = async () => {
    await wipeAll()
    localStorage.removeItem(SESSION_KEY); localStorage.removeItem('lattafa-cart')
    location.hash = '#/setup'
    location.reload()
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 pb-28 md:p-6 md:pb-28">
      <PageHeader title={t('settings.title')} subtitle={ro ? t('settings.read_only') : t('settings.subtitle')} />
      {/* "Data" is this till's own copy (backup file, sync, wipe): it means nothing in the admin panel */}
      <Segmented value={tab} onChange={setTab} options={(['store', 'money', 'rules', 'security', 'data'] as Tab[]).filter((x) => x !== 'data' || APP !== 'admin').map((x) => ({ value: x, label: t(`settings.tab_${x}`) }))} />

      {tab === 'store' && (
        <>
          <Card className="grid gap-4 sm:grid-cols-2">
            <h2 className="font-semibold sm:col-span-2">{t('settings.store')}</h2>
            <Field label={t('setup.store_name')}>{(i) => <Input id={i} disabled={ro} value={draft.store.name} onChange={(e) => up((d) => { d.store.name = e.target.value })} />}</Field>
            <Field label={t('settings.tagline')}>{(i) => <Input id={i} disabled={ro} value={draft.store.tagline} onChange={(e) => up((d) => { d.store.tagline = e.target.value })} />}</Field>
            <Field label={t('common.phone')}>{(i) => <Input id={i} disabled={ro} type="tel" className="num" value={draft.store.phone} onChange={(e) => up((d) => { d.store.phone = e.target.value })} />}</Field>
            <Field label={t('common.city')}>{(i) => <Input id={i} disabled={ro} value={draft.store.city} onChange={(e) => up((d) => { d.store.city = e.target.value })} />}</Field>
            <Field label={t('common.address')} className="sm:col-span-2">{(i) => <Input id={i} disabled={ro} value={draft.store.address} onChange={(e) => up((d) => { d.store.address = e.target.value })} />}</Field>
          </Card>
          <Card className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{t('settings.receipt')}</h2><Button variant="secondary" icon={<Printer className="size-5" />} onClick={() => printReceipt(sampleSale(draft), draft, lang)}>{t('settings.test_print')}</Button></div>
            <Field label={t('settings.receipt_header')}>{(i) => <Textarea id={i} rows={2} disabled={ro} value={draft.receipt.header} onChange={(e) => up((d) => { d.receipt.header = e.target.value })} />}</Field>
            <div className="grid gap-4 md:grid-cols-3">
              {(['en', 'ar', 'ku'] as const).map((l) => <Field key={l} label={`${t('settings.receipt_footer')} · ${l.toUpperCase()}`}>{(i) => <Input id={i} disabled={ro} dir={l === 'en' ? 'ltr' : 'rtl'} value={draft.receipt.footer[l]} onChange={(e) => up((d) => { d.receipt.footer[l] = e.target.value })} />}</Field>)}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t('settings.paper')}>{(i) => <Select id={i} disabled={ro} value={draft.receipt.paperMm} onChange={(e) => up((d) => { d.receipt.paperMm = Number(e.target.value) as 58 | 80 })}><option value={80}>80 mm</option><option value={58}>58 mm</option></Select>}</Field>
              <Field label={t('settings.copies')}>{(i) => <Input id={i} disabled={ro} inputMode="numeric" className="num" value={draft.receipt.copies} onChange={(e) => up((d) => { d.receipt.copies = Math.min(5, Math.max(1, Math.round(parseAmount(e.target.value)) || 1)) })} />}</Field>
              <Field label={t('settings.qr_url')} hint={t('settings.qr_hint')} className="md:col-span-2">{(i) => <Input id={i} disabled={ro} dir="ltr" placeholder="https://…" value={draft.receipt.qrUrl} onChange={(e) => up((d) => { d.receipt.qrUrl = e.target.value })} />}</Field>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {([['showLogo', 'settings.show_logo'], ['showQr', 'settings.show_qr'], ['autoPrint', 'settings.auto_print']] as const).map(([k, l]) => (
                <label key={k} className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 p-3.5 text-sm font-medium">{t(l)}<Switch disabled={ro} checked={draft.receipt[k]} onChange={(v) => up((d) => { d.receipt[k] = v })} label={t(l)} /></label>
              ))}
            </div>
            {/* printing with no dialog is the browser's doing, not ours — say how, where the switch is */}
            {draft.receipt.autoPrint && (
              <p className="rounded-xl bg-surface-2 p-3 text-xs leading-relaxed text-fg-2">
                {t('settings.kiosk_hint')}
                <code className="mx-1 select-all rounded bg-ink/10 px-1.5 py-0.5 font-mono text-[11px] dark:bg-white/10" dir="ltr">--kiosk-printing</code>
              </p>
            )}
          </Card>
        </>
      )}

      {tab === 'money' && (
        <Card className="grid gap-4 sm:grid-cols-2">
          <h2 className="font-semibold sm:col-span-2">{t('settings.currency')}</h2>
          <Field label={t('setup.rate')} hint={t('setup.rate_hint')}>{(i) => <Input id={i} disabled={ro} inputMode="numeric" className="num" value={draft.currency.rate} onChange={(e) => up((d) => { d.currency.rate = parseAmount(e.target.value) })} />}</Field>
          <Field label={t('settings.rounding')} hint={t('settings.rounding_hint')}>{(i) => <Select id={i} disabled={ro} value={draft.currency.rounding} onChange={(e) => up((d) => { d.currency.rounding = Number(e.target.value) as AppSettings['currency']['rounding'] })}>{[0, 250, 500, 1000].map((r) => <option key={r} value={r}>{r ? `${r} ${t('unit.iqd')}` : t('settings.no_rounding')}</option>)}</Select>}</Field>
          <label className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 p-3.5 text-sm font-medium">{t('settings.usd_enabled')}<Switch disabled={ro} checked={draft.currency.usdEnabled} onChange={(v) => up((d) => { d.currency.usdEnabled = v })} label={t('settings.usd_enabled')} /></label>
          <Field label={t('settings.tax')} hint={t('settings.tax_hint')}>{(i) => <Input id={i} disabled={ro} inputMode="decimal" className="num" value={draft.tax.pct} onChange={(e) => up((d) => { d.tax.pct = Math.min(100, parseAmount(e.target.value)) })} />}</Field>
        </Card>
      )}

      {tab === 'rules' && (
        <>
          <Card className="grid gap-4 sm:grid-cols-2">
            <h2 className="font-semibold sm:col-span-2">{t('settings.sales_rules')}</h2>
            <label className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 p-3.5 text-sm font-medium">{t('settings.require_shift')}<Switch disabled={ro} checked={draft.sales.requireShift} onChange={(v) => up((d) => { d.sales.requireShift = v })} label={t('settings.require_shift')} /></label>
            <label className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 p-3.5 text-sm font-medium">{t('settings.negative_stock')}<Switch disabled={ro} checked={draft.sales.allowNegativeStock} onChange={(v) => up((d) => { d.sales.allowNegativeStock = v })} label={t('settings.negative_stock')} /></label>
            <Field label={t('settings.gift_fee')}>{(i) => <Input id={i} disabled={ro} inputMode="numeric" className="num" value={draft.sales.giftWrapFeeIQD} onChange={(e) => up((d) => { d.sales.giftWrapFeeIQD = Math.round(parseAmount(e.target.value)) })} />}</Field>
            <Field label={t('settings.return_days')}>{(i) => <Input id={i} disabled={ro} inputMode="numeric" className="num" value={draft.sales.returnWindowDays} onChange={(e) => up((d) => { d.sales.returnWindowDays = Math.round(parseAmount(e.target.value)) })} />}</Field>
            <Field label={t('settings.default_credit')} hint={t('settings.default_credit_hint')}>{(i) => <Input id={i} disabled={ro} inputMode="numeric" className="num" value={draft.sales.defaultCustomerCreditIQD} onChange={(e) => up((d) => { d.sales.defaultCustomerCreditIQD = Math.round(parseAmount(e.target.value)) })} />}</Field>
          </Card>
          <Card className="grid gap-4 sm:grid-cols-2">
            <div className="flex items-center justify-between gap-3 sm:col-span-2"><h2 className="font-semibold">{t('settings.loyalty')}</h2><Switch disabled={ro} checked={draft.loyalty.enabled} onChange={(v) => up((d) => { d.loyalty.enabled = v })} label={t('settings.loyalty')} /></div>
            <Field label={t('settings.points_per')} hint={t('settings.points_per_hint')}>{(i) => <Input id={i} disabled={ro || !draft.loyalty.enabled} inputMode="decimal" className="num" value={draft.loyalty.pointsPer1000IQD} onChange={(e) => up((d) => { d.loyalty.pointsPer1000IQD = parseAmount(e.target.value) })} />}</Field>
            <Field label={t('settings.point_value')} hint={t('settings.point_value_hint')}>{(i) => <Input id={i} disabled={ro || !draft.loyalty.enabled} inputMode="numeric" className="num" value={draft.loyalty.pointValueIQD} onChange={(e) => up((d) => { d.loyalty.pointValueIQD = Math.round(parseAmount(e.target.value)) })} />}</Field>
          </Card>
        </>
      )}

      {tab === 'security' && (
        <Card className="grid gap-4 sm:grid-cols-3">
          <h2 className="font-semibold sm:col-span-3">{t('settings.security')}</h2>
          <Field label={t('settings.auto_lock')} hint={t('settings.auto_lock_hint')}>{(i) => <Input id={i} disabled={ro} inputMode="numeric" className="num" value={draft.security.autoLockMinutes} onChange={(e) => up((d) => { d.security.autoLockMinutes = Math.round(parseAmount(e.target.value)) })} />}</Field>
          <Field label={t('settings.max_attempts')}>{(i) => <Input id={i} disabled={ro} inputMode="numeric" className="num" value={draft.security.maxFailedAttempts} onChange={(e) => up((d) => { d.security.maxFailedAttempts = Math.max(3, Math.round(parseAmount(e.target.value))) })} />}</Field>
          <Field label={t('settings.lockout')}>{(i) => <Input id={i} disabled={ro} inputMode="numeric" className="num" value={draft.security.lockoutSeconds} onChange={(e) => up((d) => { d.security.lockoutSeconds = Math.max(10, Math.round(parseAmount(e.target.value))) })} />}</Field>
        </Card>
      )}

      {tab === 'data' && (
        <>
          <Card className="space-y-3">
            <h2 className="font-semibold">{t('settings.backup')}</h2>
            <p className="text-sm text-fg-2">{t('settings.backup_hint')}</p>
            <div className="flex flex-wrap gap-2.5">
              <Button variant="secondary" size="lg" icon={<Download className="size-5" />} disabled={!canBackup} loading={backup.busy} onClick={doBackup}>{t('settings.backup_export')}</Button>
              <label className={`inline-flex h-12 cursor-pointer items-center gap-2 rounded-xl bg-surface-2 px-5 text-base font-semibold ${canBackup ? 'hover:bg-gold-soft dark:hover:bg-charcoal' : 'pointer-events-none opacity-45'}`}>
                <Upload className="size-5" />{t('settings.backup_import')}
                <input type="file" accept="application/json,.json" hidden onChange={(e) => onRestoreFile(e.target.files?.[0])} />
              </label>
            </div>
            {storage && <p className="text-xs text-fg-2">{t('settings.storage')}: <span className="num">{(storage.used / 1048576).toFixed(1)} MB</span> / <span className="num">{Math.round(storage.quota / 1048576).toLocaleString('en-US')} MB</span></p>}
          </Card>
          <SyncCard />
          <Card className="space-y-3 border-danger/40">
            <h2 className="flex items-center gap-2 font-semibold text-danger"><AlertOctagon className="size-5" />{t('settings.danger')}</h2>
            <p className="text-sm text-fg-2">{t('settings.reset_hint')}</p>
            <Button variant="danger" size="lg" icon={<RotateCcw className="size-5" />} disabled={!canBackup} onClick={() => { setPhrase(''); setWipe(true) }}>{t('settings.reset')}</Button>
          </Card>
        </>
      )}

      {tab !== 'data' && !ro && (
        <div className={`fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur ${APP === 'admin' ? '' : 'max-md:bottom-[calc(4rem+env(safe-area-inset-bottom))]'}`}>
          <div className="mx-auto flex max-w-4xl items-center justify-between gap-3">
            <span className="text-sm text-fg-2">{dirty ? t('settings.unsaved') : t('settings.all_saved')}</span>
            <div className="flex gap-2">
              <Button variant="ghost" disabled={!dirty} onClick={() => setDraft(clone(saved))}>{t('common.reset')}</Button>
              <Button variant="primary" size="lg" icon={<Save className="size-5" />} loading={save.busy} disabled={!dirty} onClick={submit}>{t('common.save')}</Button>
            </div>
          </div>
        </div>
      )}

      <Modal open={!!restore} onClose={() => setRestore(null)} title={t('settings.backup_import')} size="sm" footer={<Button size="lg" variant="danger" block onClick={doRestore}>{t('settings.restore_go')}</Button>}>
        <p className="text-sm text-fg-2">{t('settings.restore_warn', { name: restore?.name ?? '' })}</p>
      </Modal>
      <Modal open={wipe} onClose={() => setWipe(false)} title={t('settings.reset')} size="sm" footer={<Button size="lg" variant="danger" block disabled={phrase !== 'RESET'} onClick={async () => { if (await confirm({ title: t('settings.reset'), message: t('settings.reset_final'), danger: true, confirmLabel: t('settings.reset') })) await doWipe() }}>{t('settings.reset')}</Button>}>
        <div className="space-y-3">
          <p className="text-sm text-fg-2">{t('settings.reset_type')}</p>
          <Input value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder="RESET" className="num text-center tracking-widest" data-autofocus />
        </div>
      </Modal>
    </div>
  )
}
