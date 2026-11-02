<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/** A shop's order from the customer menu (see the orders migration). */
class Order extends Model
{
    use HasUuids;

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'items' => 'array', 'number' => 'integer', 'units' => 'integer',
            'placed_at' => 'integer', 'handled_at' => 'integer',
        ];
    }
}
