<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Delegates sell and collect in dollars as well as dinars.
 *  - collections: what was actually handed over (`tendered`, in `currency`, at `rate`), like sale payments.
 *    `amount_iqd` stays the value taken off the customer's balance (balances are always IQD).
 *  - delegate_closings: dollar cash is counted on its own — expected, counted and difference in USD.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('collections', function (Blueprint $table) {
            $table->decimal('tendered', 14, 2)->nullable();
            $table->string('currency', 3)->default('IQD');
            $table->unsignedInteger('rate')->nullable();
        });
        Schema::table('delegate_closings', function (Blueprint $table) {
            $table->decimal('cash_sales_usd', 12, 2)->default(0);
            $table->decimal('collections_usd', 12, 2)->default(0);
            $table->decimal('expected_cash_usd', 12, 2)->default(0);
            $table->decimal('counted_cash_usd', 12, 2)->default(0);
            $table->decimal('variance_usd', 12, 2)->default(0);
        });
    }

    public function down(): void
    {
        Schema::table('collections', fn (Blueprint $table) => $table->dropColumn(['tendered', 'currency', 'rate']));
        Schema::table('delegate_closings', fn (Blueprint $table) => $table->dropColumn(['cash_sales_usd', 'collections_usd', 'expected_cash_usd', 'counted_cash_usd', 'variance_usd']));
    }
};
