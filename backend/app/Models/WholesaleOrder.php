<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

/**
 * An order a wholesale buyer sent.
 *
 * Its state and its payment state are two separate things, deliberately: a shop can pay in advance for an order
 * nobody has approved yet, and can be approved on terms and pay later. Neither track ever writes the other.
 */
class WholesaleOrder extends Model
{
    use HasUuids;

    public const PENDING = 'pending_approval';

    public const PROCESSING = 'approval_processing';

    public const APPROVED = 'approved';

    public const REJECTED = 'rejected';

    public const CANCELLED = 'cancelled';

    public const INTEGRATION_ERROR = 'integration_error';

    /** The states an order can still be moved out of. */
    public const OPEN = [self::PENDING, self::PROCESSING, self::INTEGRATION_ERROR];

    public const PAYMENT_STATUSES = ['unpaid', 'pending', 'partial', 'paid', 'failed', 'refunded'];

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'number' => 'integer', 'subtotal_cents' => 'integer', 'units' => 'integer', 'min_order_cents' => 'integer',
            'paid_cents' => 'integer', 'placed_at' => 'integer', 'decided_at' => 'integer',
            'whatsapp_opened_at' => 'integer',
        ];
    }

    public function items(): HasMany
    {
        return $this->hasMany(WholesaleOrderItem::class, 'order_id');
    }

    public function reservation(): HasOne
    {
        return $this->hasOne(WholesaleReservation::class, 'order_id');
    }

    public function history(): HasMany
    {
        return $this->hasMany(WholesaleOrderStatus::class, 'order_id');
    }

    public function payments(): HasMany
    {
        return $this->hasMany(WholesalePayment::class, 'order_id');
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(WholesaleCustomer::class, 'customer_id');
    }

    public function country(): BelongsTo
    {
        return $this->belongsTo(CatalogueCountry::class, 'country_id');
    }

    /** `LAT-10025` — what the buyer and the shop both call it. */
    public function reading(): string
    {
        return 'LAT-'.$this->number;
    }

    public function isOpen(): bool
    {
        return in_array($this->status, self::OPEN, true);
    }
}
