<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/** A delegate asking the shop to top up their van. Fulfilled by loading the van. */
class StockRequest extends Model
{
    use HasUuids;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['items' => 'array', 'handled_at' => 'integer', 'occurred_at' => 'integer'];
    }
}
