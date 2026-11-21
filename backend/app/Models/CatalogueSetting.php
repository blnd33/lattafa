<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** One thing the owner can set about how the catalogue looks. Kept apart from the shop's own settings row. */
class CatalogueSetting extends Model
{
    protected $primaryKey = 'key';

    public $incrementing = false;

    protected $keyType = 'string';

    protected $guarded = [];

    protected function casts(): array
    {
        return ['value' => 'array'];
    }
}
