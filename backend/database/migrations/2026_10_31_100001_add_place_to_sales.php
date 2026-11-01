<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Where a delegate's sale happened — the phone's GPS spot when the bill was finished (the shop itself is the sale's
 * customer) — and the currency the bill was made in, so the delegate sales report can say "$120 at Al-Noor, Zakho".
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sales', function (Blueprint $table) {
            $table->string('currency', 3)->default('IQD');
            $table->decimal('lat', 10, 7)->nullable();
            $table->decimal('lng', 10, 7)->nullable();
            $table->unsignedInteger('accuracy_m')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('sales', fn (Blueprint $table) => $table->dropColumn(['currency', 'lat', 'lng', 'accuracy_m']));
    }
};
