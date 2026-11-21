<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/** One word or sentence of the catalogue, in one language. The admin panel edits these; no developer needed. */
class CatalogueTranslation extends Model
{
    use HasUuids;

    protected $guarded = [];
}
