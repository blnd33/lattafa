<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class Customer extends Model
{
    use HasUuids;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['balance_iqd' => 'integer', 'credit_limit_iqd' => 'integer', 'points' => 'integer', 'active' => 'boolean', 'lat' => 'float', 'lng' => 'float'];
    }
}
