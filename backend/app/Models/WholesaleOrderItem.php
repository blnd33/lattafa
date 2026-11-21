<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/** One line of an order, frozen as it was agreed: the name, the size and the price on the day. */
class WholesaleOrderItem extends Model
{
    use HasUuids;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['qty' => 'integer', 'unit_cents' => 'integer', 'line_cents' => 'integer'];
    }
}
