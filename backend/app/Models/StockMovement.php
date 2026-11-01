<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class StockMovement extends Model
{
    use HasUuids;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['qty' => 'integer', 'balance_after' => 'integer', 'occurred_at' => 'integer'];
    }
}
