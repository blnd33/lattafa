<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SalePayment extends Model
{
    public $timestamps = false;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['amount_iqd' => 'integer', 'tendered' => 'float', 'rate' => 'integer'];
    }
}
