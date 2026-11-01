<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

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
}
