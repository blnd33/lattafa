<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/** Someone the shop buys perfume from. Orders and payments are in the supplier's currency (USD or IQD). */
class Supplier extends Model
{
    use HasUuids;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['active' => 'boolean'];
    }
}
