<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * How little the shop is willing to sell. `global` is the general rule; a `category` rule narrows it for one kind
 * of perfume and replaces the general one for those lines rather than adding to it.
 *
 * A country's smallest order lives on the country itself; the general rule's `min_order_cents` only fills in where
 * a country has not set one.
 */
class CatalogueOrderRule extends Model
{
    use HasUuids;

    public const SCOPES = ['global', 'category'];

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'min_order_cents' => 'integer', 'min_qty' => 'integer', 'qty_increment' => 'integer', 'enabled' => 'boolean',
        ];
    }
}
