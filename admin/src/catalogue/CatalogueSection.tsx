import { useState } from 'react'
import { Globe } from 'lucide-react'
import { PageHeader, Segmented } from '@/components/ui/Controls'
import { NoAccess } from '@/features/NoAccess'
import { useT } from '@/i18n'
import { hasPerm } from '@/lib/permissions'
import { useSession } from '@/store/session'
import { CountriesTab } from './CountriesTab'
import { CustomersTab } from './CustomersTab'
import { LookTab } from './LookTab'
import { OrdersTab } from './OrdersTab'
import { PerfumesTab } from './PerfumesTab'
import { PricesTab } from './PricesTab'
import { RulesTab } from './RulesTab'
import { TranslationsTab } from './TranslationsTab'

type Tab = 'orders' | 'perfumes' | 'look' | 'countries' | 'translations' | 'buyers' | 'prices' | 'rules'

/**
 * Admin panel → Wholesale catalogue: everything the owner needs to run the international side without a developer.
 *
 * Each tab appears only for someone allowed it, which is how the two catalogue roles stay apart — a Catalogue
 * Manager looks after the perfumes and the words, a Sales Manager after who buys and on what terms. The server
 * checks the same permissions again on every call; hiding a tab is a courtesy, not the guard.
 */
export function CatalogueSection() {
  const t = useT()
  const actor = useSession((s) => s.actor)
  const can = (p: string) => !!actor && hasPerm(actor.permissions, p)

  const tabs: Tab[] = [
    // orders first: an order waiting for approval is holding stock off the shelf
    ...(can('catalogue.orders') ? (['orders'] as Tab[]) : []),
    ...(can('catalogue.view') ? (['perfumes'] as Tab[]) : []),
    ...(can('catalogue.appearance') ? (['look'] as Tab[]) : []),
    ...(can('catalogue.view') ? (['countries', 'translations'] as Tab[]) : []),
    ...(can('catalogue.customers') ? (['buyers'] as Tab[]) : []),
    ...(can('catalogue.prices') ? (['prices'] as Tab[]) : []),
    ...(can('catalogue.view') ? (['rules'] as Tab[]) : []),
  ]
  const [tab, setTab] = useState<Tab>(tabs[0] ?? 'countries')
  const open = tabs.includes(tab) ? tab : (tabs[0] ?? null)

  if (!open) return <NoAccess />

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <PageHeader
        title={<span className="flex items-center gap-2"><Globe className="size-6 text-gold-text" />{t('ap.nav_catalogue')}</span>}
        subtitle={t('wc.subtitle')}
      />

      {tabs.length > 1 && (
        <Segmented
          value={open}
          onChange={setTab}
          ariaLabel={t('ap.nav_catalogue')}
          options={tabs.map((x) => ({ value: x, label: t(`wc.tab_${x}`) }))}
        />
      )}

      {open === 'orders' && <OrdersTab canSeePayments={can('catalogue.payments')} />}
      {open === 'perfumes' && <PerfumesTab canEdit={can('catalogue.products')} canTranslate={can('catalogue.translations')} />}
      {open === 'look' && <LookTab canEdit={can('catalogue.appearance')} />}
      {open === 'countries' && <CountriesTab canEdit={can('catalogue.countries')} />}
      {open === 'translations' && <TranslationsTab canEdit={can('catalogue.translations')} />}
      {open === 'buyers' && <CustomersTab canEditPrices={can('catalogue.prices')} canEditRules={can('catalogue.rules')} />}
      {open === 'prices' && <PricesTab />}
      {open === 'rules' && <RulesTab canEdit={can('catalogue.rules')} />}
    </div>
  )
}
