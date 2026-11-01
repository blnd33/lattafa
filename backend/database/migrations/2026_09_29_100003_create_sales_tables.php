<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('customers', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('name')->index();
            $table->string('phone')->default('')->index();
            $table->string('type', 12)->default('retail');   // retail | shop | wholesale
            $table->string('city')->default('');
            $table->text('notes')->default('');
            $table->bigInteger('balance_iqd')->default(0);    // > 0 = the customer owes us
            $table->unsignedBigInteger('credit_limit_iqd')->default(0);
            $table->integer('points')->default(0);
            $table->boolean('active')->default(true);
            $table->timestamps();
        });

        Schema::create('shifts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('user_id')->constrained('users');
            $table->string('user_name');
            $table->uuid('device_id')->nullable();
            $table->string('status', 8)->default('open')->index();
            $table->unsignedBigInteger('opened_at');           // epoch ms
            $table->unsignedBigInteger('closed_at')->nullable();
            $table->unsignedBigInteger('opening_iqd')->default(0);
            $table->decimal('opening_usd', 12, 2)->default(0);
            $table->unsignedBigInteger('counted_iqd')->nullable();
            $table->decimal('counted_usd', 12, 2)->nullable();
            $table->bigInteger('variance_iqd')->nullable();
            $table->json('totals')->nullable();                // frozen at close (Z report)
            $table->text('note')->default('');
            $table->timestamps();
        });

        Schema::create('cash_movements', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('shift_id')->constrained('shifts')->cascadeOnDelete();
            $table->string('type', 3);                         // in | out
            $table->unsignedBigInteger('amount_iqd');
            $table->string('reason');
            $table->uuid('user_id')->nullable();
            $table->unsignedBigInteger('occurred_at');
            $table->timestamps();
        });

        Schema::create('sales', function (Blueprint $table) {
            $table->uuid('id')->primary();                     // generated on the device: offline-safe idempotency key
            $table->string('number')->unique();                // ST1-000123
            $table->foreignUuid('shift_id')->nullable()->constrained('shifts')->nullOnDelete();
            $table->foreignUuid('user_id')->constrained('users');
            $table->string('user_name');
            $table->foreignUuid('customer_id')->nullable()->constrained('customers')->nullOnDelete();
            $table->string('customer_name')->default('');
            $table->string('channel', 10)->default('store');   // store | delegate
            $table->string('status', 20)->default('completed')->index();
            $table->unsignedBigInteger('subtotal_iqd');
            $table->unsignedBigInteger('item_discount_iqd')->default(0);
            $table->unsignedBigInteger('order_discount_iqd')->default(0);
            $table->json('order_discount')->nullable();        // {type, value}
            $table->unsignedBigInteger('gift_wrap_iqd')->default(0);
            $table->unsignedBigInteger('tax_iqd')->default(0);
            $table->integer('rounding_iqd')->default(0);
            $table->unsignedBigInteger('points_redeemed_iqd')->default(0);
            $table->unsignedBigInteger('total_iqd');
            $table->unsignedBigInteger('paid_iqd')->default(0);
            $table->unsignedBigInteger('change_iqd')->default(0);
            $table->unsignedBigInteger('due_iqd')->default(0);
            $table->integer('points_earned')->default(0);
            $table->integer('points_redeemed')->default(0);
            $table->unsignedInteger('exchange_rate');
            $table->text('note')->default('');
            $table->uuid('approved_by')->nullable();
            $table->uuid('device_id')->nullable();
            $table->json('flags');                             // ["negative_stock","price_mismatch",…] for admin review
            $table->boolean('needs_review')->default(false)->index(); // true when flags is non-empty (json can't be compared portably)
            $table->unsignedBigInteger('sold_at')->index();    // epoch ms (device clock)
            $table->unsignedBigInteger('voided_at')->nullable();
            $table->text('void_reason')->default('');
            $table->timestamps();
        });

        Schema::create('sale_items', function (Blueprint $table) {
            $table->id();
            $table->foreignUuid('sale_id')->constrained('sales')->cascadeOnDelete();
            $table->unsignedSmallInteger('position');
            $table->foreignUuid('variant_id')->constrained('variants');
            $table->foreignUuid('product_id')->constrained('products');
            $table->json('name');
            $table->string('brand');
            $table->string('label');
            $table->string('sku');
            $table->string('barcode');
            $table->unsignedInteger('qty');
            $table->unsignedBigInteger('unit_price_iqd');
            $table->unsignedBigInteger('unit_cost_iqd')->default(0);
            $table->unsignedSmallInteger('discount_pct')->default(0);
            $table->unsignedBigInteger('discount_iqd')->default(0);
            $table->unsignedBigInteger('line_total_iqd');
            $table->unsignedInteger('returned_qty')->default(0);
        });

        Schema::create('sale_payments', function (Blueprint $table) {
            $table->id();
            $table->foreignUuid('sale_id')->constrained('sales')->cascadeOnDelete();
            $table->string('method', 20);                      // cash_iqd|cash_usd|card|fib|zain|debt|return_credit
            $table->unsignedBigInteger('amount_iqd');          // value applied to the bill
            $table->decimal('tendered', 14, 2);                // what was handed over, in `currency`
            $table->string('currency', 3);
            $table->unsignedInteger('rate');
            $table->string('reference')->default('');
        });

        Schema::create('collections', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('customer_id')->constrained('customers');
            $table->unsignedBigInteger('amount_iqd');
            $table->string('method', 20);
            $table->foreignUuid('shift_id')->nullable()->constrained('shifts')->nullOnDelete();
            $table->uuid('user_id')->nullable();
            $table->text('note')->default('');
            $table->unsignedBigInteger('occurred_at');
            $table->timestamps();
        });

        Schema::create('returns', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('number')->unique();
            $table->foreignUuid('sale_id')->constrained('sales');
            $table->string('sale_number');
            $table->foreignUuid('shift_id')->nullable()->constrained('shifts')->nullOnDelete();
            $table->uuid('user_id')->nullable();
            $table->string('user_name');
            $table->unsignedBigInteger('refund_iqd');
            $table->string('refund_method', 20);              // cash_iqd|card|fib|zain|store_credit|debt_reduction
            $table->text('note')->default('');
            $table->uuid('approved_by')->nullable();
            $table->unsignedBigInteger('occurred_at')->index();
            $table->timestamps();
        });

        Schema::create('return_items', function (Blueprint $table) {
            $table->id();
            $table->foreignUuid('return_id')->constrained('returns')->cascadeOnDelete();
            $table->unsignedSmallInteger('sale_item_index');
            $table->uuid('variant_id');
            $table->uuid('product_id');
            $table->json('name');
            $table->string('label');
            $table->unsignedInteger('qty');
            $table->unsignedBigInteger('unit_net_iqd');
            $table->boolean('restock')->default(true);
            $table->string('reason')->default('');
        });
    }

    public function down(): void
    {
        foreach (['return_items', 'returns', 'collections', 'sale_payments', 'sale_items', 'sales', 'cash_movements', 'shifts', 'customers'] as $t) {
            Schema::dropIfExists($t);
        }
    }
};
