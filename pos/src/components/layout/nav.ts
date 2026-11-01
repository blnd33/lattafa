import { BarChart3, Boxes, FileSpreadsheet, Package, Receipt, Settings, ShieldCheck, ShoppingBag, Truck, Users, Wallet, type LucideIcon } from 'lucide-react'

export interface NavItem {
  to: string
  icon: LucideIcon
  label: string // i18n key
  /** shown when the user holds ANY of these permissions */
  perms: string[]
  group: 'main' | 'manage'
  /** goes in the phone bottom bar (others live under "More") */
  bottom?: boolean
}

export const NAV: NavItem[] = [
  { to: '/sell', icon: ShoppingBag, label: 'nav.sell', perms: ['pos.sell'], group: 'main', bottom: true },
  { to: '/sales', icon: Receipt, label: 'nav.sales', perms: ['sales.view_own', 'sales.view_all'], group: 'main', bottom: true },
  { to: '/customers', icon: Users, label: 'nav.customers', perms: ['customers.view'], group: 'main', bottom: true },
  { to: '/shift', icon: Wallet, label: 'nav.shift', perms: ['shifts.open', 'shifts.close'], group: 'main', bottom: true },
  { to: '/products', icon: Package, label: 'nav.products', perms: ['products.create', 'products.edit', 'products.delete'], group: 'manage' },
  { to: '/sheet', icon: FileSpreadsheet, label: 'nav.sheet', perms: ['products.import'], group: 'manage' },
  { to: '/inventory', icon: Boxes, label: 'nav.inventory', perms: ['inventory.view'], group: 'manage' },
  { to: '/delegates', icon: Truck, label: 'nav.delegates', perms: ['delegates.manage'], group: 'manage' },
  { to: '/reports', icon: BarChart3, label: 'nav.reports', perms: ['reports.view'], group: 'manage' },
  { to: '/users', icon: ShieldCheck, label: 'nav.users', perms: ['users.view'], group: 'manage' },
  { to: '/settings', icon: Settings, label: 'nav.settings', perms: ['settings.view'], group: 'manage' },
]

/** Where to land after signing in, based on what the person is allowed to do. */
export function homeFor(has: (perm: string) => boolean): string {
  const first = NAV.find((n) => n.perms.some(has))
  return first?.to ?? '/no-access'
}
