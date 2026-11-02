<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * An order a shop sent from the customer menu: what they want and who they are — a request, not a sale. A delegate
 * takes it (first one wins), or refuses it; the real sale is made in the delegate app when the goods are handed over.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('orders', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->unsignedBigInteger('number');                       // shown to people: #1, #2…
            $table->string('shop_name', 120);
            $table->string('phone', 40);
            $table->string('note', 500)->default('');
            $table->uuid('customer_id')->nullable();                    // the shop on file, when the phone matches one
            $table->json('items');                                      // [{variantId, productId, name, label, sku, qty}]
            $table->unsignedInteger('units');                           // bottles in the order, for the list
            $table->string('status', 16)->default('new');               // new | accepted | refused
            $table->uuid('handled_by')->nullable();                     // the delegate who took or refused it
            $table->unsignedBigInteger('handled_at')->nullable();       // epoch ms
            $table->string('refuse_reason', 200)->default('');
            $table->uuid('sale_id')->nullable();                        // the sale made for it, once there is one
            $table->unsignedBigInteger('placed_at');                    // epoch ms
            $table->timestamps();
            $table->unique('number');
            $table->index(['status', 'placed_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('orders');
    }
};
