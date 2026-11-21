<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Models\User;
use App\Support\Permissions;
use Illuminate\Support\Facades\DB;
use Tests\ApiTestCase;

/**
 * The path a shop that is already open takes to the wholesale catalogue: the two new roles appear, managers gain the
 * new permissions on top of whatever they hold, and nothing the shop set for itself is taken away.
 */
class CatalogueUpgradeTest extends ApiTestCase
{
    /** Puts the shop back the way it looked before the catalogue existed, then runs the migration over it. */
    private function rewindAndUpgrade(): void
    {
        Role::whereIn('key', ['catalogue_manager', 'sales_manager'])->delete();
        foreach (Role::all() as $role) {
            $role->permissions = array_values(array_diff($role->permissions, Permissions::GROUPS['catalogue']));
            $role->save();
        }

        (require database_path('migrations/2026_11_20_100001_upgrade_system_roles_for_catalogue.php'))->up();
    }

    public function test_an_open_shop_gains_the_two_roles_and_the_new_permissions(): void
    {
        $this->shop();
        $this->rewindAndUpgrade();

        $catalogue = Role::where('key', 'catalogue_manager')->firstOrFail();
        $sales = Role::where('key', 'sales_manager')->firstOrFail();
        $this->assertTrue((bool) $catalogue->is_system);
        $this->assertSame(['admin'], $sales->apps);
        $this->assertContains('catalogue.products', $catalogue->permissions);
        $this->assertContains('catalogue.prices', $sales->permissions);
        $this->assertNotContains('catalogue.prices', $catalogue->permissions);

        $manager = Role::where('key', 'manager')->firstOrFail();
        foreach (Permissions::GROUPS['catalogue'] as $perm) {
            $this->assertContains($perm, $manager->permissions, $perm);
        }

        // a cashier is not quietly handed the wholesale catalogue
        $cashier = Role::where('key', 'cashier')->firstOrFail();
        $this->assertSame([], array_intersect(Permissions::GROUPS['catalogue'], $cashier->permissions));
    }

    public function test_it_keeps_what_the_shop_changed_and_can_be_run_twice(): void
    {
        $this->shop();
        $this->rewindAndUpgrade();

        // the shop took something off its managers and added something of its own
        $manager = Role::where('key', 'manager')->firstOrFail();
        $manager->permissions = [...array_values(array_diff($manager->permissions, ['sales.void'])), 'audit.view'];
        $manager->save();
        $before = Role::count();

        (require database_path('migrations/2026_11_20_100001_upgrade_system_roles_for_catalogue.php'))->up();

        $manager->refresh();
        $this->assertNotContains('sales.void', $manager->permissions, 'the migration put back what the shop removed');
        $this->assertContains('audit.view', $manager->permissions);
        $this->assertContains('catalogue.orders', $manager->permissions);
        $this->assertSame($before, Role::count(), 'running it again duplicated a role');
    }

    public function test_a_database_nobody_has_set_up_yet_is_left_alone(): void
    {
        $this->assertSame(0, User::count());
        DB::table('roles')->delete();

        (require database_path('migrations/2026_11_20_100001_upgrade_system_roles_for_catalogue.php'))->up();

        // the shop owner's first run creates every built-in role, this one included — see SetupService
        $this->assertSame(0, Role::count());
        $this->shop();
        $this->assertNotNull(Role::where('key', 'sales_manager')->first());
    }
}
