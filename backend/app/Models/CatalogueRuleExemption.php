<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/** A business the shop has agreed to let off one of the wholesale rules. One row per rule it is let off. */
class CatalogueRuleExemption extends Model
{
    use HasUuids;

    protected $guarded = [];
}
