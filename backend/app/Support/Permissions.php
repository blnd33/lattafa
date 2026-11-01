<?php

namespace App\Support;

use App\Models\Role;

/**
 * Permission catalogue + RBAC maths. A 1:1 port of `pos/src/lib/permissions.ts` so the till and the
 * server always agree on who may do what (keep the two lists in sync).
 *
 * A role holds a list of permission strings (`*` = everything). A user's effective permissions are
 * role ∪ grants − denies, and the Super Admin always keeps `*`.
 */
final class Permissions
{
    /** @var array<string, string[]> */
    public const GROUPS = [
        'pos' => ['pos.sell', 'pos.hold', 'pos.tester'],
        'discounts' => ['sales.discount.item', 'sales.discount.order', 'sales.discount.above_limit', 'sales.price_override'],
        'sales' => ['sales.view_own', 'sales.view_all', 'sales.reprint', 'sales.void'],
        'returns' => ['returns.create', 'returns.above_limit'],
        'shifts' => ['shifts.open', 'shifts.close', 'shifts.view_all', 'shifts.cash_movement'],
        'customers' => ['customers.view', 'customers.create', 'customers.edit', 'customers.delete', 'customers.credit', 'customers.collect'],
        'products' => ['products.view', 'products.create', 'products.edit', 'products.delete', 'prices.edit', 'products.import'],
        'inventory' => ['inventory.view', 'inventory.adjust', 'inventory.receive', 'inventory.count', 'inventory.movements'],
        'purchasing' => ['purchasing.view', 'purchasing.manage', 'purchasing.pay'],
        'reports' => ['reports.view', 'reports.export', 'reports.financial'],
        'expenses' => ['expenses.view', 'expenses.manage'],
        'users' => ['users.view', 'users.create', 'users.edit', 'users.delete', 'users.reset_credentials', 'roles.manage'],
        'system' => ['settings.view', 'settings.edit', 'devices.manage', 'audit.view', 'backup.manage'],
        'delegate' => ['delegate.sell', 'delegate.visit', 'delegate.request_stock', 'delegate.close', 'delegates.manage'],
    ];

    /** Things only the Super Admin may ever do, whatever a role says. */
    public const SUPER_ADMIN_ONLY = ['roles.manage', 'users.delete', 'devices.manage', 'backup.manage', 'settings.edit'];

    /** Permissions a supervisor can grant on the spot by typing their PIN. */
    public const APPROVABLE = ['sales.discount.above_limit', 'returns.above_limit', 'sales.void', 'sales.price_override'];

    public const CASHIER = [
        'pos.sell', 'pos.hold', 'sales.discount.item', 'sales.discount.order', 'sales.view_own', 'sales.reprint',
        'returns.create', 'shifts.open', 'shifts.close', 'customers.view', 'customers.create', 'customers.credit',
        'customers.collect', 'products.view',
    ];

    /** @return string[] */
    public static function all(): array
    {
        return array_merge(...array_values(self::GROUPS));
    }

    /**
     * Built-in roles, created at setup.
     *
     * @return array<int, array{key: string, name: string, description: string, permissions: string[], apps: string[]}>
     */
    public static function systemRoles(): array
    {
        return [
            ['key' => 'super_admin', 'name' => 'Super Admin', 'description' => 'Full access. Creates accounts, roles and permissions.', 'permissions' => ['*'], 'apps' => ['pos', 'admin', 'delegate']],
            ['key' => 'manager', 'name' => 'Manager', 'description' => 'Everything except system settings, roles and deleting users.', 'permissions' => array_values(array_diff(self::all(), self::SUPER_ADMIN_ONLY)), 'apps' => ['pos', 'admin']],
            ['key' => 'cashier', 'name' => 'Cashier', 'description' => 'Sells in the shop, opens/closes own shift, limited returns.', 'permissions' => self::CASHIER, 'apps' => ['pos']],
            ['key' => 'stock_keeper', 'name' => 'Stock Keeper', 'description' => 'Inventory, purchase orders, receiving and stock counts.', 'permissions' => ['products.view', 'products.edit', 'inventory.view', 'inventory.adjust', 'inventory.receive', 'inventory.count', 'inventory.movements', 'pos.tester', 'purchasing.view', 'purchasing.manage'], 'apps' => ['pos', 'admin']],
            ['key' => 'delegate', 'name' => 'Delegate', 'description' => 'Field sales rep (Delegate app only).', 'permissions' => ['customers.view', 'customers.create', 'customers.collect', 'customers.credit', 'products.view', 'sales.view_own', 'delegate.sell', 'delegate.visit', 'delegate.request_stock', 'delegate.close'], 'apps' => ['delegate']],
        ];
    }

    /** Wildcard-aware check against a flat permission list. */
    public static function has(array $perms, string $key): bool
    {
        return in_array('*', $perms, true) || in_array($key, $perms, true);
    }

    /** Keep only known permission strings (or `*`). */
    public static function clean(array $perms): array
    {
        $known = self::all();

        return array_values(array_unique(array_filter($perms, fn ($p) => $p === '*' || in_array($p, $known, true))));
    }

    /**
     * role ∪ grants − denies. Deny always wins, except that the Super Admin keeps `*`.
     *
     * @return string[]
     */
    public static function effective(Role $role, array $grants, array $denies): array
    {
        $base = in_array('*', $role->permissions, true) ? array_merge(['*'], self::all()) : $role->permissions;
        $set = array_flip($base);
        foreach ($grants as $g) {
            $set[$g] = true;
        }
        foreach ($denies as $d) {
            unset($set[$d]);
        }
        if ($role->key === 'super_admin') {
            $set['*'] = true;
        }

        return array_map('strval', array_keys($set));
    }
}
