<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Field sales (delegates).
 *
 *  - Each delegate's van is a stock location `van:<user id>` in the existing `stock` table; managers load it from the
 *    shop (`transfer_out` / `transfer_in` movements) and delegate sales take stock out of it.
 *  - `sales.location_id` records where a sale's stock came from (the shop, or a van).
 *  - Customers get a map position (set when a delegate adds or visits them with GPS on).
 *  - New: visits (check-ins), stock requests (van top-up), and the delegate's daily closing (approved by a manager).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('customers', function (Blueprint $table) {
            $table->decimal('lat', 10, 7)->nullable();
            $table->decimal('lng', 10, 7)->nullable();
        });

        Schema::table('sales', function (Blueprint $table) {
            $table->string('location_id')->default('loc-store')->index();
        });

        Schema::create('visits', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('user_id')->index();
            $table->string('user_name');
            $table->foreignUuid('customer_id')->nullable()->constrained('customers')->nullOnDelete();
            $table->string('customer_name')->default('');
            $table->decimal('lat', 10, 7)->nullable();
            $table->decimal('lng', 10, 7)->nullable();
            $table->integer('accuracy_m')->nullable();
            $table->string('outcome', 20)->default('visit'); // visit | sale | collection | no_sale | closed
            $table->text('note')->default('');
            $table->uuid('device_id')->nullable();
            $table->bigInteger('occurred_at')->index();
            $table->timestamps();
        });

        Schema::create('stock_requests', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('user_id')->index();
            $table->string('user_name');
            $table->json('items'); // [{variantId, qty}]
            $table->text('note')->default('');
            $table->string('status', 12)->default('open')->index(); // open | fulfilled | cancelled
            $table->uuid('handled_by')->nullable();
            $table->bigInteger('handled_at')->nullable();
            $table->bigInteger('occurred_at')->index();
            $table->timestamps();
        });

        Schema::create('delegate_closings', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('user_id');
            $table->string('user_name');
            $table->string('day', 10); // Y-m-d in the shop's timezone
            $table->integer('sales_count')->default(0);
            $table->bigInteger('sales_iqd')->default(0);
            $table->bigInteger('cash_sales_iqd')->default(0);
            $table->bigInteger('credit_sales_iqd')->default(0);
            $table->bigInteger('collections_iqd')->default(0);
            $table->bigInteger('expenses_iqd')->default(0);
            $table->bigInteger('expected_cash_iqd')->default(0);
            $table->bigInteger('counted_cash_iqd')->default(0);
            $table->bigInteger('variance_iqd')->default(0);
            $table->integer('van_units')->default(0);
            $table->integer('visits')->default(0);
            $table->text('note')->default('');
            $table->string('status', 10)->default('submitted')->index(); // submitted | approved | rejected
            $table->uuid('reviewed_by')->nullable();
            $table->bigInteger('reviewed_at')->nullable();
            $table->text('review_note')->default('');
            $table->bigInteger('occurred_at')->index();
            $table->timestamps();
            $table->unique(['user_id', 'day']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('delegate_closings');
        Schema::dropIfExists('stock_requests');
        Schema::dropIfExists('visits');
        Schema::table('sales', fn (Blueprint $table) => $table->dropColumn('location_id'));
        Schema::table('customers', function (Blueprint $table) {
            $table->dropColumn(['lat', 'lng']);
        });
    }
};
