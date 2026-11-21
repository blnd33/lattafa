<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Who may buy wholesale, and how they prove it.
 *
 * A wholesale customer is a business abroad — a perfume shop, a distributor. It is NOT the shop's own `customers`
 * table (walk-ins and the shops a delegate visits), though one can be pointed at the other by `pos_customer_id`
 * when they turn out to be the same business.
 *
 * An access code is a secret, so it is stored the way a PIN is (`App\Services\Credentials`): a keyed HMAC
 * fingerprint finds the one row in O(1), and bcrypt proves the code. The code itself is never written down
 * anywhere — it is shown once, when it is generated, and after that only its last four characters.
 *
 * Unlocking a code opens a session. A session is deliberately NOT a Sanctum token: a buyer's session and a
 * staff token are different systems, so a buyer's token presented to a staff endpoint is not a token at all.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('wholesale_customers', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('business_name', 160);
            $table->string('contact_person', 120)->default('');
            $table->string('email', 160)->default('');
            $table->string('phone', 40)->default('');
            $table->string('whatsapp', 40)->default('');
            $table->uuid('country_id')->nullable();
            $table->text('address')->default('');
            $table->string('status', 16)->default('active');     // active | suspended | closed
            $table->text('notes')->default('');                  // the shop's own notes, never shown to the buyer
            $table->uuid('pos_customer_id')->nullable();         // the same business in the shop's own customer list
            $table->unsignedInteger('orders_count')->default(0);
            $table->unsignedBigInteger('orders_value_cents')->default(0);
            $table->timestamps();

            $table->foreign('country_id')->references('id')->on('catalogue_countries')->nullOnDelete();
            $table->foreign('pos_customer_id')->references('id')->on('customers')->nullOnDelete();
            $table->index(['status', 'business_name']);
        });

        Schema::create('wholesale_access_codes', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('customer_id')->constrained('wholesale_customers')->cascadeOnDelete();
            $table->string('fingerprint', 64)->unique();         // HMAC(code, app key) — one row, no scanning
            $table->string('hash');                              // bcrypt(code)
            $table->string('display', 32);                       // LAT-••••3K7Q — enough to tell two codes apart
            $table->uuid('country_id')->nullable();              // null = the customer's own country
            $table->boolean('active')->default(true);
            $table->unsignedBigInteger('expires_at')->nullable(); // epoch ms; null = never
            $table->unsignedBigInteger('revoked_at')->nullable();
            $table->unsignedInteger('uses')->default(0);
            $table->unsignedBigInteger('last_used_at')->nullable();
            $table->uuid('created_by')->nullable();              // the staff account that generated it
            $table->timestamps();

            $table->foreign('country_id')->references('id')->on('catalogue_countries')->nullOnDelete();
            $table->index(['customer_id', 'active']);
        });

        Schema::create('wholesale_sessions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('customer_id')->constrained('wholesale_customers')->cascadeOnDelete();
            $table->foreignUuid('code_id')->constrained('wholesale_access_codes')->cascadeOnDelete();
            $table->string('token_hash', 64)->unique();          // sha256 of the opaque token the browser holds
            $table->uuid('country_id')->nullable();              // the country resolved when it was unlocked
            $table->string('ip', 45)->default('');
            $table->string('user_agent', 255)->default('');
            $table->unsignedBigInteger('started_at');            // epoch ms
            $table->unsignedBigInteger('last_seen_at');
            $table->unsignedBigInteger('expires_at');
            $table->unsignedBigInteger('revoked_at')->nullable();
            $table->timestamps();

            $table->foreign('country_id')->references('id')->on('catalogue_countries')->nullOnDelete();
            $table->index(['customer_id', 'revoked_at']);
        });
    }

    public function down(): void
    {
        foreach (['wholesale_sessions', 'wholesale_access_codes', 'wholesale_customers'] as $t) {
            Schema::dropIfExists($t);
        }
    }
};
