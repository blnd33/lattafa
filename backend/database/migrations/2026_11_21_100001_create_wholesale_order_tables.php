<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Wholesale orders, the stock they hold, and what has been paid against them.
 *
 * ## Why a reservation is its own thing
 *
 * An order is an agreement; a reservation is bottles taken off the shelf for it. They are separate rows because
 * they have separate lives: an order can be modified while its reservation stands, and a reservation is released
 * or consumed on its own. `wholesale_reservation_items` is the ledger `Catalogue\Inventory` subtracts from the
 * shop's stock to say what a wholesale buyer may actually order — in one place, so nothing is ever held twice.
 *
 * Because the catalogue runs on the same database as the tills, a reservation and the stock it holds commit in
 * **one transaction**. There is no second system to agree with and nothing to reconcile.
 *
 * ## Reservations never expire
 *
 * Nothing in here expires on its own and no job releases anything. The brief is firm about it: stock stays held
 * until a person approves, rejects or cancels the order. What the shop gets instead is the age of a reservation
 * and a way to release it by hand.
 *
 * ## Prices are frozen
 *
 * `wholesale_order_items` keeps the name, size and price as they were when the order was placed. An admin
 * changing a price afterwards does not change what was agreed, and a perfume being renamed does not rewrite
 * history.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('wholesale_orders', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->unsignedBigInteger('number')->unique();          // shown as LAT-10025
            $table->foreignUuid('customer_id')->constrained('wholesale_customers')->restrictOnDelete();
            $table->uuid('country_id')->nullable();

            // DRAFT → PENDING_APPROVAL → APPROVAL_PROCESSING → APPROVED | REJECTED | CANCELLED, + INTEGRATION_ERROR
            $table->string('status', 24)->default('pending_approval');
            $table->string('method', 12)->default('direct');         // direct | whatsapp

            // who the buyer said they were, as they said it — kept with the order, not looked up later
            $table->string('business_name', 160);
            $table->string('contact_person', 120)->default('');
            $table->string('phone', 40)->default('');
            $table->string('whatsapp', 40)->default('');
            $table->string('email', 160)->default('');
            $table->text('address')->default('');
            $table->text('note')->default('');                       // the buyer's own note
            $table->text('admin_note')->default('');                 // the shop's, never shown to the buyer

            $table->unsignedBigInteger('subtotal_cents');
            $table->unsignedInteger('units');
            $table->unsignedBigInteger('min_order_cents')->default(0);   // the rule that applied at the time
            $table->string('currency', 3)->default('USD');

            // payment runs on its own track: an order can be approved and unpaid, or paid and still waiting
            $table->string('payment_status', 16)->default('unpaid');     // unpaid|pending|partial|paid|failed|refunded
            $table->unsignedBigInteger('paid_cents')->default(0);

            $table->unsignedBigInteger('placed_at');                 // epoch ms
            $table->unsignedBigInteger('decided_at')->nullable();
            $table->uuid('decided_by')->nullable();
            $table->string('reject_reason', 300)->default('');
            // opening WhatsApp is not the same as the message being sent, so it is its own fact
            $table->unsignedBigInteger('whatsapp_opened_at')->nullable();
            $table->text('integration_error')->default('');
            // the buyer's own way back to this order without signing in to anything
            $table->string('reference', 40)->unique();
            $table->timestamps();

            $table->foreign('country_id')->references('id')->on('catalogue_countries')->nullOnDelete();
            $table->index(['status', 'placed_at']);
            $table->index(['customer_id', 'placed_at']);
        });

        Schema::create('wholesale_order_items', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('order_id')->constrained('wholesale_orders')->cascadeOnDelete();
            $table->uuid('variant_id');
            $table->uuid('product_id')->nullable();
            // frozen: what it was called and what it cost on the day
            $table->string('sku', 120);
            $table->string('name', 200);
            $table->string('label', 40);
            $table->unsignedInteger('qty');
            $table->unsignedInteger('unit_cents');
            $table->unsignedBigInteger('line_cents');
            $table->string('price_source', 24)->default('');         // country | customer | customer_percent | …
            $table->timestamps();

            $table->index('variant_id');
        });

        Schema::create('wholesale_order_status_history', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('order_id')->constrained('wholesale_orders')->cascadeOnDelete();
            $table->string('from_status', 24)->default('');
            $table->string('to_status', 24);
            $table->uuid('by_user_id')->nullable();
            $table->string('by_name', 120)->default('');
            $table->string('reason', 300)->default('');
            $table->unsignedBigInteger('occurred_at');
            $table->timestamps();

            $table->index(['order_id', 'occurred_at']);
        });

        Schema::create('wholesale_reservations', function (Blueprint $table) {
            $table->uuid('id')->primary();
            // one live reservation per order; the unique key is what makes a repeated approval harmless
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

            // what `Catalogue\Inventory` sums to work out what is really available
            $table->index('variant_id');
        });

        /** The same checkout sent twice is the same order, not two. */
        Schema::create('wholesale_order_idempotency', function (Blueprint $table) {
            $table->string('key', 80)->primary();
            $table->foreignUuid('order_id')->constrained('wholesale_orders')->cascadeOnDelete();
            $table->uuid('customer_id');
            $table->timestamps();
        });

        Schema::create('wholesale_payments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('order_id')->constrained('wholesale_orders')->cascadeOnDelete();
            $table->string('method', 24);                            // bank_transfer | cash | other | online
            $table->unsignedBigInteger('amount_cents');
            $table->string('status', 16)->default('confirmed');      // pending | confirmed | failed | refunded
            $table->string('reference', 160)->default('');           // the bank's reference, a receipt number
            $table->text('note')->default('');
            $table->uuid('recorded_by')->nullable();
            $table->string('recorded_by_name', 120)->default('');
            $table->unsignedBigInteger('occurred_at');
            $table->timestamps();

            $table->index(['order_id', 'occurred_at']);
        });

        /**
         * What a payment provider told us, kept whole and exactly once.
         *
         * No provider is connected (none has been chosen, and the merchant jurisdiction decides which are even
         * possible). The table exists so that when one is, the same notification arriving twice cannot be
         * processed twice — `external_id` is unique, which is the whole guard.
         */
        Schema::create('wholesale_payment_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('payment_id')->nullable();
            $table->string('provider', 40);
            $table->string('external_id', 190);
            $table->json('payload');
            $table->unsignedBigInteger('received_at');
            $table->timestamps();

            $table->unique(['provider', 'external_id']);
        });
    }

    public function down(): void
    {
        foreach ([
            'wholesale_payment_events', 'wholesale_payments', 'wholesale_order_idempotency',
            'wholesale_reservation_items', 'wholesale_reservations', 'wholesale_order_status_history',
            'wholesale_order_items', 'wholesale_orders',
        ] as $t) {
            Schema::dropIfExists($t);
        }
    }
};
