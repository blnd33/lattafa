<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Bottle sizes can be entered in millilitres or ounces. `size` + `unit` are what the shop typed (3.4 oz);
 * the existing `ml` column stays as the normalised whole-millilitre value used for sorting and reports.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('variants', function (Blueprint $table) {
            $table->decimal('size', 8, 2)->default(0);
            $table->string('unit', 2)->default('ml');
        });
        // every size saved before this was millilitres
        DB::table('variants')->update(['size' => DB::raw('ml'), 'unit' => 'ml']);
    }

    public function down(): void
    {
        Schema::table('variants', function (Blueprint $table) {
            $table->dropColumn(['size', 'unit']);
        });
    }
};
