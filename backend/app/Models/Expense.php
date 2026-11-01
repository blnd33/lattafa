<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/** Money the shop spent (rent, salaries, generator…), in dinars or dollars, with its value in dinars. */
class Expense extends Model
{
    use HasUuids;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['rate' => 'integer', 'amount_iqd' => 'integer', 'spent_at' => 'integer'];
    }
}
