<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Where the wholesale catalogue is read, and in what words.
 *
 * Languages and countries are rows, not code: the owner adds Turkey with Turkish from the admin panel and it opens
 * that evening. The catalogue's own words live in `catalogue_translations` for the same reason — the POS, delegate
 * app and admin panel keep their built-in dictionaries, which only a developer changes.
 *
 * A perfume's name and description still come from `products`; `catalogue_product_translations` only holds what a
 * language says differently, and anything missing falls back to the product's own text.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('catalogue_languages', function (Blueprint $table) {
            $table->string('code', 12)->primary();        // en, ar, ckb (Sorani), kmr (Badini), tr, de, fr…
            $table->string('name', 60);                   // English name, for the admin panel
            $table->string('native', 60);                 // what speakers call it, for the language picker
            $table->boolean('rtl')->default(false);
            $table->boolean('enabled')->default(false);
            $table->unsignedSmallInteger('sort')->default(0);
            $table->timestamps();
        });

        Schema::create('catalogue_countries', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('iso2', 2)->unique();          // IQ, TR, AE…
            $table->json('name');                         // {en: 'Iraq', ar: 'العراق', …} — keyed by language code
            $table->string('language_code', 12);          // the language this country opens in
            $table->boolean('enabled')->default(false);
            // the one country a visitor is offered first; exactly one enabled country carries it
            $table->boolean('is_default')->default(false);
            $table->unsignedSmallInteger('sort')->default(0);
            // the smallest order this country may send, in whole US cents (0 = no minimum). Phase 2 adds the rest
            // of the rules on top; this one lives here because it belongs to the country itself.
            $table->unsignedBigInteger('min_order_cents')->default(0);
            $table->timestamps();

            $table->foreign('language_code')->references('code')->on('catalogue_languages')->restrictOnDelete();
            $table->index(['enabled', 'sort']);
        });

        Schema::create('catalogue_translations', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('language_code', 12);
            $table->string('key', 120);                   // 'cat.explore', 'cat.unlock_prices'…
            $table->text('value');
            $table->timestamps();

            $table->foreign('language_code')->references('code')->on('catalogue_languages')->cascadeOnDelete();
            $table->unique(['language_code', 'key']);
        });

        Schema::create('catalogue_product_translations', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('product_id')->constrained('products')->cascadeOnDelete();
            $table->string('language_code', 12);
            $table->string('display_name', 200)->nullable();   // null = use the product's own name
            $table->text('description')->nullable();
            $table->json('notes')->nullable();                 // {top: [], heart: [], base: []}
            $table->timestamps();

            $table->foreign('language_code')->references('code')->on('catalogue_languages')->cascadeOnDelete();
            $table->unique(['product_id', 'language_code']);
        });
    }

    public function down(): void
    {
        foreach (['catalogue_product_translations', 'catalogue_translations', 'catalogue_countries', 'catalogue_languages'] as $t) {
            Schema::dropIfExists($t);
        }
    }
};
