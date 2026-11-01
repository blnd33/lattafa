<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SaleItem extends Model
{
    public $timestamps = false;

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'name' => 'array', 'qty' => 'integer', 'unit_price_iqd' => 'integer', 'unit_cost_iqd' => 'integer',
            'discount_pct' => 'integer', 'discount_iqd' => 'integer', 'line_total_iqd' => 'integer', 'returned_qty' => 'integer',
        ];
    }
}
