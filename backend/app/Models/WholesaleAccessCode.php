<?php

namespace App\Models;

use App\Support\Time;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * The secret a wholesale customer types to see their prices. The code itself is not stored: only a keyed
 * fingerprint that finds this row, and a bcrypt hash that proves the code — the same pattern as a staff PIN.
 */
class WholesaleAccessCode extends Model
{
    use HasUuids;

    protected $guarded = [];

    protected $hidden = ['fingerprint', 'hash'];

    protected function casts(): array
    {
        return ['active' => 'boolean', 'expires_at' => 'integer', 'revoked_at' => 'integer', 'uses' => 'integer', 'last_used_at' => 'integer'];
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(WholesaleCustomer::class, 'customer_id');
    }

    public function country(): BelongsTo
    {
        return $this->belongsTo(CatalogueCountry::class, 'country_id');
    }

    public function isExpired(?int $now = null): bool
    {
        return $this->expires_at !== null && $this->expires_at <= ($now ?? Time::nowMs());
    }

    public function isUsable(?int $now = null): bool
    {
        return $this->active && $this->revoked_at === null && ! $this->isExpired($now);
    }
}
