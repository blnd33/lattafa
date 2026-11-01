<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/** Money received against a customer's outstanding balance. */
class Collection extends Model
{
    use HasUuids;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['amount_iqd' => 'integer', 'occurred_at' => 'integer', 'tendered' => 'float', 'rate' => 'integer'];
    }
}
