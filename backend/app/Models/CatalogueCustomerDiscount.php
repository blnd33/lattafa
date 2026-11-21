<?php

namespace App\Models;

use App\Support\Time;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * A percentage off everything this business buys. Several can be on file with different dates — the one that
 * started most recently and has not run out is the one in force, so a seasonal agreement can be set up in advance.
 */
class CatalogueCustomerDiscount extends Model
{
    use HasUuids;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['percent_off_bp' => 'integer', 'valid_from' => 'integer', 'valid_to' => 'integer'];
    }

    public function inForce(?int $now = null): bool
    {
        $now ??= Time::nowMs();

        return ($this->valid_from === null || $this->valid_from <= $now)
            && ($this->valid_to === null || $this->valid_to > $now);
    }
}
