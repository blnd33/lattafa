<?php

namespace App\Models;

use App\Support\Time;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One unlocked catalogue: the browser holds an opaque token, this row holds its sha256. Deliberately not a Sanctum
 * token — a buyer's session and a staff token are separate systems, so a buyer's token handed to a staff endpoint
 * is not a token at all, and withdrawing a code closes every session opened with it.
 */
class WholesaleSession extends Model
{
    use HasUuids;

    protected $guarded = [];

    protected $hidden = ['token_hash'];

    protected function casts(): array
    {
        return ['started_at' => 'integer', 'last_seen_at' => 'integer', 'expires_at' => 'integer', 'revoked_at' => 'integer'];
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(WholesaleCustomer::class, 'customer_id');
    }

    public function code(): BelongsTo
    {
        return $this->belongsTo(WholesaleAccessCode::class, 'code_id');
    }

    public function country(): BelongsTo
    {
        return $this->belongsTo(CatalogueCountry::class, 'country_id');
    }

    public function isLive(?int $now = null): bool
    {
        return $this->revoked_at === null && $this->expires_at > ($now ?? Time::nowMs());
    }
}
