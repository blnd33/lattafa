<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A bottle can now be given as a gift at the till. It is its own sale line, priced 0, keeping what the bottle cost —
 * so the bill's takings are untouched and the profit goes down by the cost of the gift, never by its selling price.
 *
 * And the permission to give one: managers of a shop set up earlier gain `sales.gift` exactly as a new shop's
 * managers have it (only adding — nothing the shop changed itself is taken away).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sale_items', function (Blueprint $table) {
            $table->boolean('is_gift')->default(false);
        });

        foreach (DB::table('roles')->where('key', 'manager')->where('is_system', true)->get() as $role) {
            $perms = json_decode($role->permissions ?? '[]', true) ?: [];
            if (in_array('*', $perms, true) || in_array('sales.gift', $perms, true)) {
                continue;
            }
            DB::table('roles')->where('id', $role->id)->update(['permissions' => json_encode([...$perms, 'sales.gift']), 'updated_at' => now()]);
        }
    }

    public function down(): void
    {
        Schema::table('sale_items', function (Blueprint $table) {
            $table->dropColumn('is_gift');
        });
    }
};
