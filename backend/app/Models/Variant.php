<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Variant extends Model
{
    use HasUuids;

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'ml' => 'integer', 'size' => 'float', 'cost_iqd' => 'integer', 'retail_iqd' => 'integer', 'wholesale_iqd' => 'integer', 'wholesale_usd_cents' => 'integer', 'cost_usd_cents' => 'integer',
            'min_stock' => 'integer', 'is_tester' => 'boolean', 'active' => 'boolean',
        ];
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }
}
