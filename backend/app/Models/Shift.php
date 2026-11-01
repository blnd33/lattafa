<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Shift extends Model
{
    use HasUuids;

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'opened_at' => 'integer', 'closed_at' => 'integer', 'opening_iqd' => 'integer', 'opening_usd' => 'float',
            'counted_iqd' => 'integer', 'counted_usd' => 'float', 'variance_iqd' => 'integer', 'totals' => 'array',
        ];
    }

    public function movements(): HasMany
    {
        return $this->hasMany(CashMovement::class)->orderBy('occurred_at');
    }
}
