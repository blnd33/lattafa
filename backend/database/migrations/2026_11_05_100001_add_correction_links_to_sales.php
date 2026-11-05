<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Correcting a cashier's slip cancels the bill and writes it again. These two columns tie the pair together, so
 * the cancelled one can say which bill replaced it and the new one can say which it corrects.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sales', function (Blueprint $table) {
            $table->uuid('corrects_sale_id')->nullable();
            $table->uuid('corrected_by_sale_id')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('sales', fn (Blueprint $table) => $table->dropColumn(['corrects_sale_id', 'corrected_by_sale_id']));
    }
};
