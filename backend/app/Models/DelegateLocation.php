<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** One GPS point from a delegate's phone (live location / today's route for the owner). */
class DelegateLocation extends Model
{
    public const UPDATED_AT = null;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['lat' => 'float', 'lng' => 'float', 'accuracy_m' => 'integer', 'recorded_at' => 'integer'];
    }
}
