<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The perfume's place on the customer menu (admin panel → Customer menu). Empty = automatic: after the arranged
 * perfumes, featured first, then A–Z — so a perfume added later never jumps ahead of the arranged ones.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->unsignedInteger('menu_order')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('products', fn (Blueprint $table) => $table->dropColumn('menu_order'));
    }
};
