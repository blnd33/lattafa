<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A flagged sale (stock gone negative, price changed while offline…) can be marked as checked in the admin panel: it
 * leaves the "to check" list, keeps its flags, and remembers who checked it, when, and their note.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sales', function (Blueprint $table) {
            $table->unsignedBigInteger('reviewed_at')->nullable();
            $table->uuid('reviewed_by')->nullable();
            $table->string('review_note', 255)->default('');
        });
    }

    public function down(): void
    {
        Schema::table('sales', fn (Blueprint $table) => $table->dropColumn(['reviewed_at', 'reviewed_by', 'review_note']));
    }
};
