<?php

namespace Tests\Unit;

use App\Models\Role;
use App\Support\Permissions;
use PHPUnit\Framework\TestCase;

/** Mirrors `describe('permissions')` in pos/src/lib/lib.test.ts, and guards against the two catalogues drifting apart. */
class PermissionsTest extends TestCase
{
    private function role(string $key): Role
    {
        $seed = collect(Permissions::systemRoles())->firstWhere('key', $key);
        $r = new Role();
        $r->key = $key;
        $r->permissions = $seed['permissions'];

        return $r;
    }

    public function test_super_admin_has_everything_even_after_a_stray_deny(): void
    {
        $p = Permissions::effective($this->role('super_admin'), [], ['users.create']);
        $this->assertTrue(Permissions::has($p, 'users.create'));
        $this->assertTrue(Permissions::has($p, 'anything.at.all'));
    }

    public function test_cashier_can_sell_but_not_manage_users(): void
    {
        $p = Permissions::effective($this->role('cashier'), [], []);
        $this->assertTrue(Permissions::has($p, 'pos.sell'));
        $this->assertFalse(Permissions::has($p, 'users.create'));
        $this->assertFalse(Permissions::has($p, 'sales.discount.above_limit'));
    }

    public function test_grants_add_and_denies_win(): void
    {
        $p = Permissions::effective($this->role('cashier'), ['reports.view'], ['pos.hold']);
        $this->assertTrue(Permissions::has($p, 'reports.view'));
        $this->assertFalse(Permissions::has($p, 'pos.hold'));
    }

    public function test_manager_has_everything_except_super_admin_only_permissions(): void
    {
        $p = Permissions::effective($this->role('manager'), [], []);
        $this->assertTrue(Permissions::has($p, 'reports.financial'));
        foreach (Permissions::SUPER_ADMIN_ONLY as $perm) {
            $this->assertFalse(Permissions::has($p, $perm), $perm);
        }
        $this->assertGreaterThan(40, count(Permissions::all()));
    }

    public function test_clean_drops_unknown_permissions_and_duplicates(): void
    {
        $this->assertSame(['pos.sell', '*'], Permissions::clean(['pos.sell', 'made.up', 'pos.sell', '*']));
    }

    public function test_every_approvable_and_super_admin_only_permission_exists(): void
    {
        foreach ([...Permissions::APPROVABLE, ...Permissions::SUPER_ADMIN_ONLY, ...Permissions::CASHIER] as $p) {
            $this->assertContains($p, Permissions::all(), $p);
        }
    }

    /** The till decides what to show from its own list; the server decides what to allow. They must agree. */
    public function test_catalogue_matches_the_pos_front_end(): void
    {
        $file = dirname(__DIR__, 3).'/pos/src/lib/permissions.ts';
        if (! is_file($file)) {
            $this->markTestSkipped('POS sources are not next to the backend.');
        }
        $ts = file_get_contents($file);
        $list = function (string $pattern) use ($ts): array {
            $this->assertSame(1, preg_match($pattern, $ts, $m), "pattern not found: $pattern");
            preg_match_all("/'([^']+)'/", $m[1], $q);

            return $q[1];
        };

        preg_match_all('/perms:\s*\[([^\]]*)\]/', $ts, $groups);
        $tsAll = [];
        foreach ($groups[1] as $g) {
            preg_match_all("/'([^']+)'/", $g, $q);
            $tsAll = array_merge($tsAll, $q[1]);
        }
        $this->assertEqualsCanonicalizing($tsAll, Permissions::all(), 'permission catalogue differs between pos/src/lib/permissions.ts and App\Support\Permissions');
        $this->assertEqualsCanonicalizing($list('/APPROVABLE = new Set\(\[(.*?)\]\)/s'), Permissions::APPROVABLE);
        $this->assertEqualsCanonicalizing($list('/SUPER_ADMIN_ONLY = new Set\(\[(.*?)\]\)/s'), Permissions::SUPER_ADMIN_ONLY);
        $this->assertEqualsCanonicalizing($list('/const CASHIER = \[(.*?)\]/s'), Permissions::CASHIER);
    }
}
