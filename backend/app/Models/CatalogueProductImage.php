<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/** An extra photograph of a perfume, kept by the catalogue. The product's own stays the first one shown. */
class CatalogueProductImage extends Model
{
    use HasUuids;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['sort' => 'integer'];
    }
}
