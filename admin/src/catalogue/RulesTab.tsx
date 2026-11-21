import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Save, Trash2 } from 'lucide-react'
import { Button, IconButton } from '@/components/ui/Button'
import { Badge, Card, EmptyState, Spinner } from '@/components/ui/Controls'
import { Field, Input, Select } from '@/components/ui/Field'
import { useConfirm } from '@/components/ui/Modal'
import { cn } from '@/components/ui/cn'
import { errorMessage, useT } from '@/i18n'
import { toast } from '@/store/toast'
import * as cat from './api'
import { Setting } from './Setting'

/**
 * How little the shop is willing to sell.
 *
 * The general rule applies to everything; a rule for one kind of perfume **replaces** it for those lines rather
 * than adding to it — "at least 6 bottles, except oud, which goes in 2s" is what a shop means. A country's own
 * smallest order is set with the country, not here, so there is only ever one answer to what Türkiye's minimum is.
 */
export function RulesTab({ canEdit }: { canEdit: boolean }) {
  const t = useT()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const rules = useQuery({ queryKey: ['cat-rules'], queryFn: cat.getRules })
  const countries = useQuery({ queryKey: ['cat-countries'], queryFn: cat.getCountries })
  const [addingCategory, setAddingCategory] = useState(false)

  const refresh = () => qc.invalidateQueries({ queryKey: ['cat-rules'] })

  if (rules.isLoading) return <div className="grid h-60 place-items-center"><Spinner className="size-9" /></div>

  const all = rules.data ?? []
  const general = all.find((r) => r.scope === 'global') ?? null
  const byCategory = all.filter((r) => r.scope === 'category')
  const spare = cat.CATEGORIES.filter((c) => !byCategory.some((r) => r.scopeId === c))

  const remove = async (rule: cat.OrderRule) => {
    if (!(await confirm({ title: t('wc.remove_rule_q'), danger: true }))) return
    try {
      await cat.deleteRule(rule.id)
      await refresh()
    } catch (e) { toast.error(errorMessage(e, t)) }
  }

  return (
    <div className="space-y-4">
      <RuleCard
        title={t('wc.general_rule')}
        hint={t('wc.general_rule_hint')}
        rule={general}
        scope="global"
        withMinOrder
        canEdit={canEdit}
        onSaved={refresh}
      />

      <Card>
        <h3 className="mb-1 font-serif text-lg">{t('wc.country_minimums')}</h3>
        <p className="mb-3 text-sm text-fg-2">{t('wc.country_minimums_hint')}</p>
        {!countries.data?.length ? <EmptyState title={t('wc.no_countries')} /> : (
          <ul className="divide-y divide-line text-sm">
            {countries.data.map((c) => (
              <li key={c.id} className="flex items-center gap-3 py-2">
                <span className="font-medium">{c.name.en || c.iso2}</span>
                {!c.enabled && <Badge tone="neutral">{t('wc.closed')}</Badge>}
                <span className="num ms-auto">{c.minOrderCents ? `$${c.minOrderCents / 100}` : t('wc.uses_general')}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-serif text-lg">{t('wc.by_category')}</h3>
            <p className="text-sm text-fg-2">{t('wc.by_category_hint')}</p>
          </div>
          {canEdit && !!spare.length && (
            <Button variant="secondary" icon={<Plus className="size-5" />} onClick={() => setAddingCategory(true)}>{t('wc.add_category_rule')}</Button>
          )}
        </div>

        {addingCategory && (
          <RuleCard
            title={t('wc.add_category_rule')}
            rule={null}
            scope="category"
            categories={spare}
            canEdit={canEdit}
            onSaved={() => { setAddingCategory(false); void refresh() }}
            onCancel={() => setAddingCategory(false)}
          />
        )}

        {!byCategory.length && !addingCategory
          ? <Card><EmptyState title={t('wc.no_category_rules')} hint={t('wc.no_category_rules_hint')} /></Card>
          : byCategory.map((r) => (
            <RuleCard
              key={r.id}
              title={t(`prod.cat_${r.scopeId}`)}
              rule={r}
              scope="category"
              canEdit={canEdit}
              onSaved={refresh}
              onRemove={() => void remove(r)}
            />
          ))}
      </div>
    </div>
  )
}

function RuleCard({ title, hint, rule, scope, categories, withMinOrder, canEdit, onSaved, onCancel, onRemove }: {
  title: string
  hint?: string
  rule: cat.OrderRule | null
  scope: 'global' | 'category'
  categories?: string[]
  withMinOrder?: boolean
  canEdit: boolean
  onSaved: () => void
  onCancel?: () => void
  onRemove?: () => void
}) {
  const t = useT()
  const [scopeId, setScopeId] = useState(rule?.scopeId ?? categories?.[0] ?? '')
  const [minOrder, setMinOrder] = useState(rule?.minOrderCents ? String(rule.minOrderCents / 100) : '')
  const [minQty, setMinQty] = useState(rule?.minQty ? String(rule.minQty) : '')
  const [step, setStep] = useState(rule?.qtyIncrement ? String(rule.qtyIncrement) : '')
  const [enabled, setEnabled] = useState(rule?.enabled ?? true)
  const [busy, setBusy] = useState(false)

  const num = (s: string) => (s.trim() === '' ? 0 : Number(s))
  const badMin = minOrder.trim() !== '' && cat.toCents(minOrder) === null
  const badQty = minQty.trim() !== '' && !/^\d+$/.test(minQty.trim())
  const badStep = step.trim() !== '' && !/^\d+$/.test(step.trim())
  /** "At least 7, in steps of 6" can never be satisfied — say so here rather than letting the server refuse it. */
  const impossible = !badQty && !badStep && num(step) > 1 && num(minQty) > 0 && num(minQty) % num(step) !== 0

  const save = async () => {
    if (badMin || badQty || badStep) return toast.error(t('wc.bad_number'))
    if (impossible) return toast.error(t('wc.rule_impossible', { qty: num(minQty), step: num(step) }))
    setBusy(true)
    try {
      await cat.saveRule({
        scope,
        scopeId: scope === 'category' ? scopeId : undefined,
        minOrderCents: withMinOrder ? (minOrder.trim() === '' ? 0 : (cat.toCents(minOrder) ?? 0)) : 0,
        minQty: num(minQty),
        qtyIncrement: num(step),
        enabled,
      })
      toast.success(t('wc.rule_saved'))
      onSaved()
    } catch (e) { toast.error(errorMessage(e, t)) } finally { setBusy(false) }
  }

  const allowed = num(step) > 1 ? [1, 2, 3, 4].map((n) => Math.max(num(minQty), num(step)) + (n - 1) * num(step)) : []

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-serif text-lg">{title}</h3>
          {hint && <p className="text-sm text-fg-2">{hint}</p>}
        </div>
        <div className="flex items-center gap-2">
          {rule && !rule.enabled && <Badge tone="neutral">{t('wc.rule_off')}</Badge>}
          {onRemove && canEdit && <IconButton label={t('common.delete')} variant="ghost" onClick={onRemove}><Trash2 className="size-4 text-danger-fg" /></IconButton>}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {scope === 'category' && categories && (
          <Field label={t('wc.which_category')}>
            {(id) => <Select id={id} value={scopeId} onChange={(e) => setScopeId(e.target.value)}>{categories.map((c) => <option key={c} value={c}>{t(`prod.cat_${c}`)}</option>)}</Select>}
          </Field>
        )}
        {withMinOrder && (
          <Field label={t('wc.min_order')} hint={t('wc.min_order_general_hint')}>
            {(id) => (
              <div className="flex items-center gap-1">
                <span className="text-fg-2">$</span>
                <Input id={id} dir="ltr" inputMode="decimal" disabled={!canEdit} className={cn('num', badMin && 'ring-2 ring-inset ring-danger')} value={minOrder} onChange={(e) => setMinOrder(e.target.value)} placeholder="0" />
              </div>
            )}
          </Field>
        )}
        <Field label={t('wc.min_qty')} hint={t('wc.min_qty_hint')}>
          {(id) => <Input id={id} dir="ltr" inputMode="numeric" disabled={!canEdit} className={cn('num', badQty && 'ring-2 ring-inset ring-danger')} value={minQty} onChange={(e) => setMinQty(e.target.value)} placeholder="0" />}
        </Field>
        <Field label={t('wc.qty_step')} hint={t('wc.qty_step_hint')}>
          {(id) => <Input id={id} dir="ltr" inputMode="numeric" disabled={!canEdit} className={cn('num', (badStep || impossible) && 'ring-2 ring-inset ring-danger')} value={step} onChange={(e) => setStep(e.target.value)} placeholder="0" />}
        </Field>
      </div>

      {impossible && <p className="mt-2 text-sm font-medium text-danger-fg">{t('wc.rule_impossible', { qty: num(minQty), step: num(step) })}</p>}
      {!impossible && !!allowed.length && <p className="num mt-2 text-xs text-fg-2">{t('wc.allowed_quantities', { list: `${allowed.join(', ')}…` })}</p>}

      {canEdit && (
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3">
          <Setting checked={enabled} onChange={setEnabled} label={t('wc.rule_on')} />
          <div className="ms-auto flex gap-2">
            {onCancel && <Button variant="secondary" onClick={onCancel}>{t('common.cancel')}</Button>}
            <Button icon={<Save className="size-5" />} loading={busy} onClick={() => void save()}>{t('common.save')}</Button>
          </div>
        </div>
      )}
    </Card>
  )
}
