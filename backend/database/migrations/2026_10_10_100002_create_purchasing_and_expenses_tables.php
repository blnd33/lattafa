<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Buying and spending.
 *
 *   suppliers ─┬─ purchase_orders ── purchase_order_items      what was ordered, at what unit cost
 *              ├─ purchase_receipts ── purchase_receipt_items  what actually arrived (stock goes up, the shop owes it)
 *              └─ supplier_payments                            what the shop paid
 *   expenses                                                   rent, salaries, generator…
 *
 * Money is kept in the currency it was agreed in (a supplier deals in USD or IQD; an expense in either) with the dollar
 * rate of that day, plus its value in dinars (`*_iqd`) for reports. A supplier's balance is always in their currency.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('suppliers', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('name', 120);
            $table->string('phone', 40)->default('');
            $table->string('contact', 120)->default('');   // the person to talk to
            $table->string('city', 80)->default('');
            $table->string('currency', 3)->default('USD');  // IQD | USD — orders and payments are in it
            $table->text('notes')->default('');
            $table->boolean('active')->default(true)->index();
            $table->timestamps();
        });

        Schema::create('purchase_orders', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('number')->unique();              // PO-000001
            $table->foreignUuid('supplier_id')->constrained('suppliers');
            $table->string('status', 12)->default('open')->index(); // open | partial | received | closed | cancelled
            $table->string('currency', 3);
            $table->unsignedInteger('rate');                 // IQD for 1 USD when ordered
            $table->decimal('total', 14, 2)->default(0);     // ordered qty × unit cost
            $table->decimal('received_total', 14, 2)->default(0);
            $table->text('note')->default('');
            $table->unsignedBigInteger('ordered_at')->index();
            $table->unsignedBigInteger('expected_at')->nullable();
            $table->unsignedBigInteger('closed_at')->nullable();
            $table->uuid('created_by')->nullable();
            $table->string('created_by_name')->default('');
            $table->timestamps();
        });

        Schema::create('purchase_order_items', function (Blueprint $table) {
            $table->id();
            $table->foreignUuid('purchase_order_id')->constrained('purchase_orders')->cascadeOnDelete();
            $table->unsignedSmallInteger('position');
            $table->foreignUuid('variant_id')->constrained('variants');
            $table->uuid('product_id');
            $table->json('name');                            // {en, ar, ku} as it was ordered
            $table->string('label', 40);
            $table->string('sku');
            $table->unsignedInteger('qty');
            $table->unsignedInteger('received_qty')->default(0);
            $table->decimal('unit_cost', 14, 2);
        });

        Schema::create('purchase_receipts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('purchase_order_id')->constrained('purchase_orders');
            $table->foreignUuid('supplier_id')->constrained('suppliers');
            $table->string('currency', 3);
            $table->unsignedInteger('rate');
            $table->decimal('total', 14, 2);
            $table->unsignedBigInteger('total_iqd');
            $table->text('note')->default('');
            $table->unsignedBigInteger('received_at')->index();
            $table->uuid('user_id')->nullable();
            $table->string('user_name')->default('');
            $table->timestamps();
        });

        Schema::create('purchase_receipt_items', function (Blueprint $table) {
            $table->id();
            $table->foreignUuid('purchase_receipt_id')->constrained('purchase_receipts')->cascadeOnDelete();
            $table->unsignedBigInteger('order_item_id');
            $table->uuid('variant_id');
            $table->unsignedInteger('qty');
            $table->decimal('unit_cost', 14, 2);
            $table->unsignedBigInteger('unit_cost_iqd');
        });

        Schema::create('supplier_payments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('supplier_id')->constrained('suppliers');
            $table->uuid('purchase_order_id')->nullable();
            $table->decimal('amount', 14, 2);
            $table->string('currency', 3);
            $table->unsignedInteger('rate');
            $table->unsignedBigInteger('amount_iqd');
            $table->string('method', 20)->default('cash');  // cash | bank | other
            $table->text('note')->default('');
            $table->unsignedBigInteger('paid_at')->index();
            $table->uuid('user_id')->nullable();
            $table->string('user_name')->default('');
            $table->timestamps();
        });

        Schema::create('expenses', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('category', 30)->index();
            $table->decimal('amount', 14, 2);
            $table->string('currency', 3)->default('IQD');
            $table->unsignedInteger('rate');
            $table->unsignedBigInteger('amount_iqd');
            $table->string('method', 20)->default('cash');
            $table->text('note')->default('');
            $table->unsignedBigInteger('spent_at')->index();
            $table->uuid('user_id')->nullable();
            $table->string('user_name')->default('');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('expenses');
        Schema::dropIfExists('supplier_payments');
        Schema::dropIfExists('purchase_receipt_items');
        Schema::dropIfExists('purchase_receipts');
        Schema::dropIfExists('purchase_order_items');
        Schema::dropIfExists('purchase_orders');
        Schema::dropIfExists('suppliers');
    }
};
