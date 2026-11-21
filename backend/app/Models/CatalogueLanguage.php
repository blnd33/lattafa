<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** A language the wholesale catalogue can be read in. Added and enabled from the admin panel, never in code. */
class CatalogueLanguage extends Model
{
    protected $primaryKey = 'code';

    public $incrementing = false;

    protected $keyType = 'string';

    protected $guarded = [];

    protected function casts(): array
    {
        return ['rtl' => 'boolean', 'enabled' => 'boolean', 'sort' => 'integer'];
    }
}
