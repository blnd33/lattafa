<?php

namespace App\Models;

use App\Support\Time;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * What one business pays for one bottle size: either a price agreed outright, or a percentage off whatever the
 * price would otherwise be. Never both — `CataloguePricing` takes the price if it is there and ignores the rest.
 */
class CatalogueCustomerPrice extends Model
{
    use HasUuids;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['price_cents' => 'integer', 'percent_off_bp' => 'integer', 'valid_from' => 'integer', 'valid_to' => 'integer'];
    }

    public function variant(): BelongsTo
    {
        return $this->belongsTo(Variant::class);
    }

    /** Whether this agreement is the one in force today. */
    public function inForce(?int $now = null): bool
    {
        $now ??= Time::nowMs();

        return ($this->valid_from === null || $this->valid_from <= $now)
            && ($this->valid_to === null || $this->valid_to > $now);
    }
}
