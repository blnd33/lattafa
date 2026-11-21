<?php

use App\Support\Permissions;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * The wholesale catalogue brings its own permissions and two new built-in roles — Catalogue Manager (the perfumes as
 * they read and look) and Sales Manager (who buys, on what terms). A shop set up earlier gets them exactly as a new
 * shop would: the two roles are created, and managers gain the new permissions on top of what they already hold.
 * Only ever adding — nothing the shop changed itself is taken away.
 */
return new class extends Migration
{
    public function up(): void
    {
        // A database with nobody in it has not been set up yet: the shop owner's first run creates all the built-in
        // roles, this one included, so there is nothing to carry over.
        if (! DB::table('users')->exists()) {
            return;
        }

        $new = Permissions::GROUPS['catalogue'];

        foreach (Permissions::systemRoles() as $def) {
            $role = DB::table('roles')->where('key', $def['key'])->first();

            // Catalogue Manager and Sales Manager don't exist on an older shop yet.
            if (! $role) {
                DB::table('roles')->insert([
                    'id' => (string) Str::uuid(),
                    'key' => $def['key'],
                    'name' => $def['name'],
                    'description' => $def['description'],
                    'permissions' => json_encode($def['permissions']),
                    'apps' => json_encode($def['apps']),
                    'is_system' => true,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);

                continue;
            }

            if (! $role->is_system) {
                continue;   // a custom role that happens to share the key — leave it alone
            }

            $add = array_values(array_intersect($def['permissions'], $new));
            $perms = json_decode($role->permissions ?? '[]', true) ?: [];
            if (! $add || in_array('*', $perms, true)) {
                continue;   // nothing to add, or the Super Admin, who already holds everything
            }

            $merged = array_values(array_unique([...$perms, ...$add]));
            if ($merged !== $perms) {
                DB::table('roles')->where('id', $role->id)->update(['permissions' => json_encode($merged), 'updated_at' => now()]);
            }
        }
    }

    public function down(): void
    {
        // The two new roles are only removed if nobody was given them; permissions added to existing roles stay.
        foreach (['catalogue_manager', 'sales_manager'] as $key) {
            $role = DB::table('roles')->where('key', $key)->where('is_system', true)->first();
            if ($role && ! DB::table('users')->where('role_id', $role->id)->exists()) {
                DB::table('roles')->where('id', $role->id)->delete();
            }
        }
    }
};
