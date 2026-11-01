<?php

use App\Support\Permissions;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Purchasing and expenses brought new permissions. Shops set up earlier get them on their built-in roles the way a new
 * shop would (managers: all of them; stock keepers: purchase orders and receiving) — only adding, never taking away
 * what the shop changed itself.
 */
return new class extends Migration
{
    public function up(): void
    {
        $new = [...Permissions::GROUPS['purchasing'], ...Permissions::GROUPS['expenses']];
        foreach (Permissions::systemRoles() as $def) {
            $add = array_values(array_intersect($def['permissions'], $new));
            if (! $add) {
                continue;
            }
            $role = DB::table('roles')->where('key', $def['key'])->where('is_system', true)->first();
            if (! $role) {
                continue;
            }
            $perms = json_decode($role->permissions ?? '[]', true) ?: [];
            if (in_array('*', $perms, true)) {
                continue;
            }
            $merged = array_values(array_unique([...$perms, ...$add]));
            if ($merged !== $perms) {
                DB::table('roles')->where('id', $role->id)->update(['permissions' => json_encode($merged), 'updated_at' => now()]);
            }
        }
    }

    public function down(): void
    {
        // additive data fix — nothing to undo
    }
};
