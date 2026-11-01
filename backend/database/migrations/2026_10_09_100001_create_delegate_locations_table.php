<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Where a delegate's phone was while they were signed in (live location for the owner). One row per point; the
 * phone sends a point every few minutes or after moving a little, and keeps points it could not send yet.
 * Old points are pruned (see DelegateService::LOCATION_DAYS).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('delegate_locations', function (Blueprint $table) {
            $table->id();
            $table->uuid('user_id');
            $table->uuid('device_id')->nullable();
            $table->decimal('lat', 10, 7);
            $table->decimal('lng', 10, 7);
            $table->unsignedInteger('accuracy_m')->nullable();
            $table->unsignedBigInteger('recorded_at'); // epoch ms, on the phone
            $table->timestamp('created_at')->nullable();
            $table->unique(['user_id', 'recorded_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('delegate_locations');
    }
};
