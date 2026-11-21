<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * What a wholesale buyer pays, and the smallest order the shop will take.
 *
 * Every figure here is **whole US cents** — the catalogue is USD only, and money is never a float. The delegate's
 * dollar list (`variants.wholesale_usd_cents`) stays underneath all of it: a size with no country price of its own
 * falls back to that, so opening a country needs only the prices that really differ.
 *
 * Priority, decided once and for all in `App\Support\CataloguePricing`:
 *   1. a price agreed with this one business for this one size
 *   2. a percentage off agreed with this business (for the size, else across the board) — never both
 *   3. the country's wholesale price
 *   4. the delegate's dollar list
 *   5. otherwise the size has no price: it is shown, but it cannot be ordered
 *
 * The country's smallest order lives on the country itself (`catalogue_countries.min_order_cents`, Phase 1) rather
 * than being repeated here, so there is only ever one answer to "what is Turkey's minimum".
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('catalogue_country_prices', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('country_id')->constrained('catalogue_countries')->cascadeOnDelete();
            $table->foreignUuid('variant_id')->constrained('variants')->cascadeOnDelete();
            $table->unsignedInteger('price_cents');
            $table->timestamps();

            $table->unique(['country_id', 'variant_id']);
        });

        Schema::create('catalogue_customer_prices', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('customer_id')->constrained('wholesale_customers')->cascadeOnDelete();
            $table->foreignUuid('variant_id')->constrained('variants')->cascadeOnDelete();
            // exactly one of the two is set: a price agreed outright, or a percentage off whatever the price would be
            $table->unsignedInteger('price_cents')->nullable();
            $table->unsignedSmallInteger('percent_off_bp')->nullable();   // basis points: 17.5 % = 1750, so no floats
            $table->unsignedBigInteger('valid_from')->nullable();          // epoch ms; null = from now on
            $table->unsignedBigInteger('valid_to')->nullable();            // epoch ms; null = until withdrawn
            $table->timestamps();

            $table->unique(['customer_id', 'variant_id']);
        });

        Schema::create('catalogue_customer_discounts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('customer_id')->constrained('wholesale_customers')->cascadeOnDelete();
            $table->unsignedSmallInteger('percent_off_bp');                // across this buyer's whole order
            $table->unsignedBigInteger('valid_from')->nullable();
            $table->unsignedBigInteger('valid_to')->nullable();
            $table->timestamps();

            $table->index(['customer_id', 'valid_from']);
        });

        /** Every price that ever changed, and who changed it — a price is an agreement, so it leaves a trail. */
        Schema::create('catalogue_price_history', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('scope', 20);                                   // country | customer | customer_wide
            $table->uuid('scope_id');                                      // the country or the business
            $table->uuid('variant_id')->nullable();                        // null for a discount across the board
            $table->integer('from_cents')->nullable();                     // null = there was no price before
            $table->integer('to_cents')->nullable();                       // null = the price was taken away
            $table->unsignedSmallInteger('from_percent_bp')->nullable();
            $table->unsignedSmallInteger('to_percent_bp')->nullable();
            $table->uuid('user_id')->nullable();
            $table->string('user_name', 120)->default('');
            $table->unsignedBigInteger('occurred_at');                     // epoch ms
            $table->timestamps();

            $table->index(['scope', 'scope_id', 'occurred_at']);
            $table->index(['variant_id', 'occurred_at']);
        });

        /**
         * How little the shop is willing to sell. `global` is the fallback; `category` narrows it for one kind of
         * perfume (the `category` column on products: perfume, oud, mist, oil, set, home).
         */
        Schema::create('catalogue_order_rules', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('scope', 20);                                   // global | category
            $table->string('scope_id', 60)->default('');                   // '' for global, the category for category
            $table->unsignedBigInteger('min_order_cents')->default(0);     // 0 = no minimum (global only)
            $table->unsignedInteger('min_qty')->default(0);                // smallest number of bottles of one size
            $table->unsignedInteger('qty_increment')->default(0);          // and in steps of this many
            $table->boolean('enabled')->default(true);
            $table->timestamps();

            $table->unique(['scope', 'scope_id']);
        });

        /** A business the shop has agreed to let off one of those rules. */
        Schema::create('catalogue_rule_exemptions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('customer_id')->constrained('wholesale_customers')->cascadeOnDelete();
            $table->string('kind', 20);                                    // min_order | min_qty | qty_increment
            $table->timestamps();

            $table->unique(['customer_id', 'kind']);
        });
    }

    public function down(): void
    {
        foreach ([
            'catalogue_rule_exemptions', 'catalogue_order_rules', 'catalogue_price_history',
            'catalogue_customer_discounts', 'catalogue_customer_prices', 'catalogue_country_prices',
        ] as $t) {
            Schema::dropIfExists($t);
        }
    }
};
