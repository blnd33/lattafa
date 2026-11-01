<?php

use App\Support\Permissions;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Shops set up before the delegate app have built-in roles without its permissions: the Delegate role could
 * not sell from a van, managers could not see the Delegates page and the Super Admin could not connect a
 * delegate phone. Give the built-in roles what they get at setup today — only adding, never taking away what
 * the shop changed itself.
 */
return new class extends Migration
{
    public function up(): void
    {
        $delegateGroup = Permissions::GROUPS['delegate'];
        foreach (Permissions::systemRoles() as $def) {
            $role = DB::table('roles')->where('key', $def['key'])->where('is_system', true)->first();
            if (! $role) {
                continue;
            }
            $perms = json_decode($role->permissions ?? '[]', true) ?: [];
            $apps = json_decode($role->apps ?? '[]', true) ?: [];
            // the Delegate role gets its whole default set; the others only the new delegate permissions
            $add = $def['key'] === 'delegate' ? $def['permissions'] : array_intersect($def['permissions'], $delegateGroup);
            $newPerms = in_array('*', $perms, true) ? $perms : array_values(array_unique([...$perms, ...$add]));
            $newApps = in_array('delegate', $def['apps'], true) ? array_values(array_unique([...$apps, 'delegate'])) : $apps;
            if ($newPerms !== $perms || $newApps !== $apps) {
                DB::table('roles')->where('id', $role->id)->update([
                    'permissions' => json_encode($newPerms), 'apps' => json_encode($newApps), 'updated_at' => now(),
                ]);
            }
        }
    }

    public function down(): void
    {
        // additive data fix — nothing to undo
    }
};
