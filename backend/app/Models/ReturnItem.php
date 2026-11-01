<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ReturnItem extends Model
{
    public $timestamps = false;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['name' => 'array', 'qty' => 'integer', 'unit_net_iqd' => 'integer', 'restock' => 'boolean', 'sale_item_index' => 'integer'];
    }
}
