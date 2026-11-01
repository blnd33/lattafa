<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/** A delegate's check-in at a customer (with the phone's GPS position when available). */
class Visit extends Model
{
    use HasUuids;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['lat' => 'float', 'lng' => 'float', 'accuracy_m' => 'integer', 'occurred_at' => 'integer'];
    }
}
