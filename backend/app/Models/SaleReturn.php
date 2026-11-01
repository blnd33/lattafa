<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class SaleReturn extends Model
{
    use HasUuids;

    protected $table = 'returns';

    protected $guarded = [];

    protected function casts(): array
    {
        return ['refund_iqd' => 'integer', 'occurred_at' => 'integer'];
    }

    public function items(): HasMany
    {
        return $this->hasMany(ReturnItem::class, 'return_id')->orderBy('id');
    }
}
