<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PurchaseOrderItem extends Model
{
    public $timestamps = false;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['name' => 'array', 'qty' => 'integer', 'received_qty' => 'integer', 'position' => 'integer'];
    }
}
