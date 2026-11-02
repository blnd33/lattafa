<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The dollar price list the delegate sells to shops with — one price per size, in cents so it is exact
 * (12.50 = 1250). 0 means "not set": the bill falls back to the dinar price at the day's rate, as before.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('variants', fn (Blueprint $table) => $table->unsignedInteger('wholesale_usd_cents')->default(0));
    }

    public function down(): void
    {
        Schema::table('variants', fn (Blueprint $table) => $table->dropColumn('wholesale_usd_cents'));
    }
};
