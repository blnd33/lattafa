/**
 * Permission catalogue + RBAC helpers.
 *
 * Permissions are dot-notated strings. A role holds a list of them (`*` = all).
 * A user's *effective* permissions = role ∪ user grants − user denies.
 * The Super Admin manages roles and per-user overrides from the Users & Roles pages.
 */
import type { Actor, Role, User } from '@/data/types'

export interface PermGroup {
  key: string
  perms: string[]
}

export const PERMISSION_GROUPS: PermGroup[] = [
  { key: 'pos', perms: ['pos.sell', 'pos.hold', 'pos.tester'] },
  { key: 'discounts', perms: ['sales.discount.item', 'sales.discount.order', 'sales.discount.above_limit', 'sales.price_override'] },
  { key: 'sales', perms: ['sales.view_own', 'sales.view_all', 'sales.reprint', 'sales.void'] },
  { key: 'returns', perms: ['returns.create', 'returns.above_limit'] },
  { key: 'shifts', perms: ['shifts.open', 'shifts.close', 'shifts.view_all', 'shifts.cash_movement'] },
  { key: 'customers', perms: ['customers.view', 'customers.create', 'customers.edit', 'customers.delete', 'customers.credit', 'customers.collect'] },
  { key: 'products', perms: ['products.view', 'products.create', 'products.edit', 'products.delete', 'prices.edit', 'products.import'] },
  { key: 'inventory', perms: ['inventory.view', 'inventory.adjust', 'inventory.receive', 'inventory.count', 'inventory.movements'] },
  { key: 'purchasing', perms: ['purchasing.view', 'purchasing.manage', 'purchasing.pay'] },
  { key: 'reports', perms: ['reports.view', 'reports.export', 'reports.financial'] },
  { key: 'expenses', perms: ['expenses.view', 'expenses.manage'] },
  { key: 'users', perms: ['users.view', 'users.create', 'users.edit', 'users.delete', 'users.reset_credentials', 'roles.manage'] },
  { key: 'system', perms: ['settings.view', 'settings.edit', 'devices.manage', 'audit.view', 'backup.manage'] },
  { key: 'delegate', perms: ['delegate.sell', 'delegate.visit', 'delegate.request_stock', 'delegate.close', 'delegates.manage'] },
]

export const ALL_PERMISSIONS: string[] = PERMISSION_GROUPS.flatMap((g) => g.perms)

/** Permissions a supervisor can grant on the spot by typing their PIN. */
export const APPROVABLE = new Set([
  'sales.discount.above_limit',
  'returns.above_limit',
  'sales.void',
  'sales.price_override',
])

/** Things that can only ever be done by the Super Admin, whatever the role says. */
export const SUPER_ADMIN_ONLY = new Set(['roles.manage', 'users.delete', 'devices.manage', 'backup.manage', 'settings.edit'])

const CASHIER = [
  'pos.sell', 'pos.hold',
  'sales.discount.item', 'sales.discount.order',
  'sales.view_own', 'sales.reprint',
  'returns.create',
  'shifts.open', 'shifts.close',
  'customers.view', 'customers.create', 'customers.credit', 'customers.collect',
  'products.view',
]

export interface RoleSeed {
  key: string
  name: string
  description: string
  permissions: string[]
  apps: Role['apps']
}

export const SYSTEM_ROLES: RoleSeed[] = [
  {
    key: 'super_admin',
    name: 'Super Admin',
    description: 'Full access. Creates accounts, roles and permissions.',
    permissions: ['*'],
    apps: ['pos', 'admin', 'delegate'],
  },
  {
    key: 'manager',
    name: 'Manager',
    description: 'Everything except system settings, roles and deleting users.',
    permissions: ALL_PERMISSIONS.filter((p) => !SUPER_ADMIN_ONLY.has(p)),
    apps: ['pos', 'admin'],
  },
  {
    key: 'cashier',
    name: 'Cashier',
    description: 'Sells in the shop, opens/closes own shift, limited returns.',
    permissions: CASHIER,
    apps: ['pos'],
  },
  {
    key: 'stock_keeper',
    name: 'Stock Keeper',
    description: 'Inventory, purchase orders, receiving and stock counts.',
    permissions: [
      'products.view', 'products.edit',
      'inventory.view', 'inventory.adjust', 'inventory.receive', 'inventory.count', 'inventory.movements',
      'pos.tester',
      'purchasing.view', 'purchasing.manage',
    ],
    apps: ['pos', 'admin'],
  },
  {
    key: 'delegate',
    name: 'Delegate',
    description: 'Field sales rep (Delegate app only).',
    permissions: [
      'customers.view', 'customers.create', 'customers.collect', 'customers.credit', 'products.view', 'sales.view_own',
      'delegate.sell', 'delegate.visit', 'delegate.request_stock', 'delegate.close',
    ],
    apps: ['delegate'],
  },
]

/** Wildcard-aware permission check against a flat permission list. */
export function hasPerm(perms: readonly string[] | Set<string>, key: string): boolean {
  const has = (k: string) => (perms instanceof Set ? perms.has(k) : perms.includes(k))
  return has('*') || has(key)
}

/** role ∪ grants − denies. Deny always wins. */
export function effectivePermissions(role: Role, user: Pick<User, 'grants' | 'denies'>): string[] {
  const base = new Set<string>(role.permissions.includes('*') ? ['*', ...ALL_PERMISSIONS] : role.permissions)
  user.grants.forEach((p) => base.add(p))
  user.denies.forEach((p) => base.delete(p))
  // super admin keeps '*' even if someone denies a single permission by mistake
  if (role.key === 'super_admin') base.add('*')
  return [...base]
}

export function makeActor(user: User, role: Role): Actor {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    roleId: role.id,
    roleKey: role.key,
    roleName: role.name,
    color: user.color,
    permissions: effectivePermissions(role, user),
    limits: user.limits,
    isSuperAdmin: role.key === 'super_admin',
  }
}

export function actorCan(actor: Actor | null | undefined, key: string): boolean {
  return !!actor && hasPerm(actor.permissions, key)
}

/** Avatar colours handed out to new accounts. */
export const AVATAR_COLORS = ['#D4A548', '#B8892F', '#8B4A2B', '#3E8E5E', '#27365C', '#7A4FA0', '#B5442F', '#5E8C8A']

/** Limits handed to a fresh cashier by default (Super Admin can change per user). */
export const DEFAULT_LIMITS = { maxDiscountPct: 10, maxRefundIQD: 100000 }
