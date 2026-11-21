<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Bottles taken off the shelf for one order.
 *
 * It never expires on its own. Nothing in this system releases a reservation because of its age — a person does,
 * by approving, rejecting or cancelling the order, and that is exactly what the brief asks for. What the shop
 * gets instead is how long it has been held.
 */
class WholesaleReservation extends Model
{
    use HasUuids;

    public const ACTIVE = 'active';

    /** The stock has been taken off the shelf for good: the order was approved. */
    public const CONSUMED = 'consumed';

    /** The hold was let go and the bottles are available again. */
    public const RELEASED = 'released';

    /** Something went wrong finishing it; a person has to look. */
    public const ERROR = 'error';

    protected $guarded = [];

    protected function casts(): array
    {
        return ['held_at' => 'integer', 'consumed_at' => 'integer', 'released_at' => 'integer'];
    }

    public function items(): HasMany
    {
        return $this->hasMany(WholesaleReservationItem::class, 'reservation_id');
    }

    public function order(): BelongsTo
    {
        return $this->belongsTo(WholesaleOrder::class, 'order_id');
    }
}
