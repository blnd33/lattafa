<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/** Bottles of one size held for one order. Summed by `Catalogue\Inventory` and nowhere else. */
class WholesaleReservationItem extends Model
{
    use HasUuids;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['qty' => 'integer'];
    }
}
