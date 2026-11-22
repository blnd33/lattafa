<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * What one delegate sells a size for.
 *
 * Until now there was a single dollar price per size — `variants.wholesale_usd_cents` — the same for every
 * delegate, set in the admin panel. A delegate carries what suits the shops on their own road and prices it
 * themselves, so each of them can now have their own figure for a size, and the shop's list is what they fall
 * back to when they have not set one.
 *
 * The perfume itself is still the shop's: same product, same barcode, same name, same sizes. Only the price and
 * the quantity are the delegate's own. `set_by` keeps who last wrote it, because a delegate may set their own
 * price and a manager may correct it, and the admin panel shows which.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('delegate_prices', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignUuid('variant_id')->constrained('variants')->cascadeOnDelete();
            // whole US cents, like every other dollar figure in the system
            $table->unsignedInteger('usd_cents');
            $table->uuid('set_by')->nullable();
            $table->timestamps();

            // one price per delegate per size; the pair is also how a price is looked up
            $table->unique(['user_id', 'variant_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('delegate_prices');
    }
};
