<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * An editorial grouping of perfumes that exists only in the catalogue — "Oud Collection", "Gift sets for Ramadan".
 * Nothing to do with the POS categories, which come from the product itself.
 */
class CatalogueCollection extends Model
{
    use HasUuids;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['name' => 'array', 'description' => 'array', 'enabled' => 'boolean', 'featured' => 'boolean', 'sort' => 'integer'];
    }

    public function items(): HasMany
    {
        return $this->hasMany(CatalogueCollectionProduct::class, 'collection_id');
    }

    /** Its name in one language, falling back to English and then to whatever it has. */
    public function nameIn(string $language): string
    {
        $name = $this->name ?? [];

        return (string) ($name[$language] ?? $name['en'] ?? reset($name) ?: $this->slug);
    }
}
