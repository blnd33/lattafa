<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A business that buys wholesale: a perfume shop or distributor, usually abroad. Not the shop's own `customers`
 * table — though `pos_customer_id` can point at the same business there when it is one the delegates also visit.
 */
class WholesaleCustomer extends Model
{
    use HasUuids;

    public const STATUSES = ['active', 'suspended', 'closed'];

    protected $guarded = [];

    protected function casts(): array
    {
        return ['orders_count' => 'integer', 'orders_value_cents' => 'integer'];
    }

    public function country(): BelongsTo
    {
        return $this->belongsTo(CatalogueCountry::class, 'country_id');
    }

    public function codes(): HasMany
    {
        return $this->hasMany(WholesaleAccessCode::class, 'customer_id');
    }

    public function sessions(): HasMany
    {
        return $this->hasMany(WholesaleSession::class, 'customer_id');
    }

    /** Its orders. Unlike everything else here these do not go when the business does — see the delete guard. */
    public function orders(): HasMany
    {
        return $this->hasMany(WholesaleOrder::class, 'customer_id');
    }

    public function isActive(): bool
    {
        return $this->status === 'active';
    }
}
