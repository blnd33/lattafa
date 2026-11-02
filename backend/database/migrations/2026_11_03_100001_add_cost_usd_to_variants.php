<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * What a size costs the shop in dollars — the figure the supplier invoices in. Shown beside the dollar selling price
 * so the delegate can see what he is making on a bottle. In cents, like the selling price; 0 = not set.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('variants', fn (Blueprint $table) => $table->unsignedInteger('cost_usd_cents')->default(0));
    }

    public function down(): void
    {
        Schema::table('variants', fn (Blueprint $table) => $table->dropColumn('cost_usd_cents'));
    }
};
