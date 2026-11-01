<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Sale extends Model
{
    use HasUuids;

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'order_discount' => 'array', 'flags' => 'array', 'sold_at' => 'integer', 'voided_at' => 'integer', 'reviewed_at' => 'integer', 'needs_review' => 'boolean',
            'subtotal_iqd' => 'integer', 'item_discount_iqd' => 'integer', 'order_discount_iqd' => 'integer',
            'gift_wrap_iqd' => 'integer', 'tax_iqd' => 'integer', 'rounding_iqd' => 'integer', 'points_redeemed_iqd' => 'integer',
            'total_iqd' => 'integer', 'paid_iqd' => 'integer', 'change_iqd' => 'integer', 'due_iqd' => 'integer',
            'points_earned' => 'integer', 'points_redeemed' => 'integer', 'exchange_rate' => 'integer',
        ];
    }

    public function items(): HasMany
    {
        return $this->hasMany(SaleItem::class)->orderBy('position');
    }

    public function payments(): HasMany
    {
        return $this->hasMany(SalePayment::class)->orderBy('id');
    }
}
