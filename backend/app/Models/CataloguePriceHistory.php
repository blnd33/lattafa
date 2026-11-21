<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/** Every wholesale price that ever changed, and who changed it. A price is an agreement, so it leaves a trail. */
class CataloguePriceHistory extends Model
{
    use HasUuids;

    protected $table = 'catalogue_price_history';

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'from_cents' => 'integer', 'to_cents' => 'integer',
            'from_percent_bp' => 'integer', 'to_percent_bp' => 'integer',
            'occurred_at' => 'integer',
        ];
    }
}
