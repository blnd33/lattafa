<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/** One country's wholesale price for one bottle size, in whole US cents. */
class CatalogueCountryPrice extends Model
{
    use HasUuids;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['price_cents' => 'integer'];
    }
}
