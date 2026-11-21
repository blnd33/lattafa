<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/** Money received against an order. Offline methods are real; `online` waits for a provider to be chosen. */
class WholesalePayment extends Model
{
    use HasUuids;

    public const METHODS = ['bank_transfer', 'cash', 'other', 'online'];

    public const STATUSES = ['pending', 'confirmed', 'failed', 'refunded'];

    protected $guarded = [];

    protected function casts(): array
    {
        return ['amount_cents' => 'integer', 'occurred_at' => 'integer'];
    }
}
