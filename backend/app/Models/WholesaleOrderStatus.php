<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/** Every move an order made, and who made it. */
class WholesaleOrderStatus extends Model
{
    use HasUuids;

    protected $table = 'wholesale_order_status_history';

    protected $guarded = [];

    protected function casts(): array
    {
        return ['occurred_at' => 'integer'];
    }
}
