<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The catalogue sells with no limit, so nothing is held for an order any more.
 *
 * A reservation existed to keep bottles off the shelf between a buyer ordering and the shop deciding. The owner
 * has chosen the other way: a shop abroad orders what it likes, the shop here decides when the order arrives, and
 * the shelf in Duhok is not part of it. With nothing to hold, these two tables had no reader and no writer left.
 *
 * Dropping them loses no order: `wholesale_orders` and `wholesale_order_items` are untouched, and everything a
 * reservation ever recorded was about stock, not about what was agreed. `down()` puts the schema back exactly as
 * `2026_11_21_100001` wrote it, so this is reversible even though the rows are not.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::dropIfExists('wholesale_reservation_items');
        Schema::dropIfExists('wholesale_reservations');
    }

    public function down(): void
    {
        Schema::create('wholesale_reservations', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('order_id')->unique()->constrained('wholesale_orders')->cascadeOnDelete();
            $table->string('status', 12)->default('active');         // active | consumed | released | error
            $table->unsignedBigInteger('held_at');
            $table->unsignedBigInteger('consumed_at')->nullable();
            $table->unsignedBigInteger('released_at')->nullable();
            $table->text('note')->default('');
            $table->timestamps();

            $table->index('status');
        });

        Schema::create('wholesale_reservation_items', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('reservation_id')->constrained('wholesale_reservations')->cascadeOnDelete();
            $table->uuid('variant_id');
            $table->unsignedInteger('qty');
            $table->timestamps();

            $table->index('variant_id');
        });
    }
};
