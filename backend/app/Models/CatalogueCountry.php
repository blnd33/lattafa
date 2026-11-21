<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** A country the catalogue is open in: which language it opens in, and the smallest order it may send. */
class CatalogueCountry extends Model
{
    use HasUuids;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['name' => 'array', 'enabled' => 'boolean', 'is_default' => 'boolean', 'sort' => 'integer', 'min_order_cents' => 'integer'];
    }

    public function language(): BelongsTo
    {
        return $this->belongsTo(CatalogueLanguage::class, 'language_code', 'code');
    }

    public function customers(): HasMany
    {
        return $this->hasMany(WholesaleCustomer::class, 'country_id');
    }

    /** The country's name in one language, falling back to English and then to whatever it has. */
    public function nameIn(string $language): string
    {
        $name = $this->name ?? [];

        return (string) ($name[$language] ?? $name['en'] ?? reset($name) ?: $this->iso2);
    }
}
