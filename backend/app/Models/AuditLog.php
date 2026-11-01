<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class AuditLog extends Model
{
    use HasUuids;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['meta' => 'array', 'occurred_at' => 'integer'];
    }
}
