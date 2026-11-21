<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * How the wholesale catalogue looks, and what the shop says about its own perfumes there.
 *
 * ## Why these are the catalogue's own tables
 *
 * The shop's `settings` row is guarded by `settings.edit`, which only a Super Admin ever holds — so a Catalogue
 * Manager could never change a headline. `catalogue_settings` is the catalogue's own, behind
 * `catalogue.appearance`, which is exactly the person whose job this is. (The same reasoning put the default
 * country on `catalogue_countries` rather than in settings.)
 *
 * ## The POS owns the perfume; the catalogue owns how it is presented
 *
 * Not one column is added to `products` or `variants`. A collection is an editorial grouping that exists only
 * here; extra photographs live here; and `catalogue_product_settings` carries the catalogue's own view of a
 * perfume — hidden from this channel, featured in it, where it sits — without touching what the tills and the
 * delegates rely on. `featured` is deliberately nullable: null means "whatever the shop marked on the product
 * itself", so a shop that never opens this screen still gets a sensible catalogue.
 */
return new class extends Migration
{
    public function up(): void
    {
        /** One row per thing the owner can set: brand, homepage, footer. Small, so JSON rather than a column each. */
        Schema::create('catalogue_settings', function (Blueprint $table) {
            $table->string('key', 60)->primary();
            $table->json('value');
            $table->timestamps();
        });

        Schema::create('catalogue_collections', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('slug', 80)->unique();
            $table->json('name');                        // {en: 'Oud Collection', ar: …} — keyed by language code
            $table->json('description');
            $table->string('image_path')->nullable();    // on the public disk
            $table->boolean('enabled')->default(true);
            $table->boolean('featured')->default(false); // shown on the homepage
            $table->unsignedSmallInteger('sort')->default(0);
            $table->timestamps();

            $table->index(['enabled', 'sort']);
        });

        Schema::create('catalogue_collection_products', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('collection_id')->constrained('catalogue_collections')->cascadeOnDelete();
            $table->foreignUuid('product_id')->constrained('products')->cascadeOnDelete();
            $table->unsignedSmallInteger('sort')->default(0);
            $table->timestamps();

            $table->unique(['collection_id', 'product_id']);
        });

        /** More photographs of a perfume than the one the POS keeps. The product's own stays the first. */
        Schema::create('catalogue_product_images', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('product_id')->constrained('products')->cascadeOnDelete();
            $table->string('path');
            $table->unsignedSmallInteger('sort')->default(0);
            $table->timestamps();

            $table->index(['product_id', 'sort']);
        });

        /** The catalogue's own view of a perfume the POS owns. */
        Schema::create('catalogue_product_settings', function (Blueprint $table) {
            $table->uuid('product_id')->primary();
            $table->boolean('hidden')->default(false);           // not shown in the catalogue at all
            $table->boolean('featured')->nullable();             // null = follow the product's own flag
            $table->unsignedSmallInteger('sort')->nullable();    // null = the catalogue's own order
            $table->timestamps();

            $table->foreign('product_id')->references('id')->on('products')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        foreach ([
            'catalogue_product_settings', 'catalogue_product_images',
            'catalogue_collection_products', 'catalogue_collections', 'catalogue_settings',
        ] as $t) {
            Schema::dropIfExists($t);
        }
    }
};
