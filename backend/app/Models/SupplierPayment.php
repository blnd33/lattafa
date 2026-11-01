<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/** Money the shop paid a supplier, in the supplier's currency. */
class SupplierPayment extends Model
{
    use HasUuids;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['rate' => 'integer', 'amount_iqd' => 'integer', 'paid_at' => 'integer'];
    }
}
