<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('products', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->json('name');                     // {en, ar, ku}
            $table->json('description');              // {en, ar, ku}
            $table->string('brand')->index();
            $table->string('category')->index();       // perfume | oud | mist | oil | set | home
            $table->string('gender', 10)->index();     // men | women | unisex
            $table->string('concentration', 20);
            $table->json('scent_families');
            $table->json('notes');                     // {top:[], heart:[], base:[]}
            $table->string('season', 10)->default('all');
            $table->unsignedTinyInteger('longevity')->default(3);
            $table->unsignedTinyInteger('sillage')->default(3);
            $table->string('image_path')->nullable();  // file on the public disk
            $table->json('art');                       // generated-bottle fallback {c1,c2,shape}
            $table->boolean('show_on_menu')->default(true);
            $table->boolean('featured')->default(false);
            $table->boolean('is_new')->default(false);
            $table->boolean('active')->default(true)->index();
            $table->timestamps();
        });

        Schema::create('variants', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('product_id')->constrained('products')->cascadeOnDelete();
            $table->string('label', 40);
            $table->unsignedInteger('ml')->default(0);
            $table->string('sku')->unique();
            $table->string('barcode')->index();
            $table->unsignedBigInteger('cost_iqd')->default(0);
            $table->unsignedBigInteger('retail_iqd')->default(0);
            $table->unsignedBigInteger('wholesale_iqd')->default(0);
            $table->integer('min_stock')->default(5);
            $table->boolean('is_tester')->default(false);
            $table->boolean('active')->default(true);
            $table->timestamps();
        });

        // One row per variant × location. Written ONLY by StockService.
        Schema::create('stock', function (Blueprint $table) {
            $table->foreignUuid('variant_id')->constrained('variants')->cascadeOnDelete();
            $table->string('location_id')->default('loc-store');
            $table->integer('qty')->default(0);       // may go negative for offline sales pushed late (flagged)
            $table->timestamps();
            $table->primary(['variant_id', 'location_id']);
        });

        Schema::create('stock_movements', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('variant_id')->constrained('variants')->cascadeOnDelete();
            $table->string('location_id')->default('loc-store');
            $table->string('type', 20)->index();      // purchase|sale|return|void|adjustment|damage|tester|count|opening|transfer_*
            $table->integer('qty');                   // signed
            $table->integer('balance_after');
            $table->string('ref_type')->nullable();
            $table->string('ref_id')->nullable()->index();
            $table->text('note')->default('');
            $table->uuid('user_id')->nullable();
            $table->uuid('device_id')->nullable();
            $table->unsignedBigInteger('occurred_at')->index();  // epoch ms
            $table->timestamps();
        });

        Schema::create('stock_counts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('location_id')->default('loc-store');
            $table->json('lines');                    // [{variantId, expected, counted}]
            $table->text('note')->default('');
            $table->uuid('user_id')->nullable();
            $table->unsignedBigInteger('occurred_at');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        foreach (['stock_counts', 'stock_movements', 'stock', 'variants', 'products'] as $t) {
            Schema::dropIfExists($t);
        }
    }
};
