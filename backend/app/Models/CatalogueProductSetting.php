<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * The catalogue's own view of a perfume the POS owns: hidden from this channel, featured in it, where it sits.
 * `featured` null means "whatever the shop marked on the product itself".
 */
class CatalogueProductSetting extends Model
{
    protected $primaryKey = 'product_id';

    public $incrementing = false;

    protected $keyType = 'string';

    protected $guarded = [];

    protected function casts(): array
    {
        return ['hidden' => 'boolean', 'featured' => 'boolean', 'sort' => 'integer'];
    }
}
