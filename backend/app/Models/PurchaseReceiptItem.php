<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PurchaseReceiptItem extends Model
{
    public $timestamps = false;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['qty' => 'integer', 'unit_cost_iqd' => 'integer', 'order_item_id' => 'integer'];
    }
}
