<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class Product extends Model
{
    use HasUuids;

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'name' => 'array', 'description' => 'array', 'scent_families' => 'array', 'notes' => 'array', 'art' => 'array',
            'show_on_menu' => 'boolean', 'featured' => 'boolean', 'is_new' => 'boolean', 'active' => 'boolean',
            'longevity' => 'integer', 'sillage' => 'integer', 'menu_order' => 'integer',
        ];
    }

    public function variants(): HasMany
    {
        return $this->hasMany(Variant::class);
    }

    /** What the wholesale catalogue says about this perfume in each of its languages (overrides only). */
    public function catalogueTranslations(): HasMany
    {
        return $this->hasMany(CatalogueProductTranslation::class);
    }

    /** Extra photographs the catalogue keeps; this product's own `image_path` stays the first one shown. */
    public function catalogueImages(): HasMany
    {
        return $this->hasMany(CatalogueProductImage::class);
    }

    /** The catalogue's own view of it: hidden there, featured there, where it sits. */
    public function catalogueSetting(): HasOne
    {
        return $this->hasOne(CatalogueProductSetting::class, 'product_id');
    }
}
