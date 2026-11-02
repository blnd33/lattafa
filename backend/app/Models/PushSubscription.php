<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/** One browser that asked to be told about new orders (see the push_subscriptions migration). */
class PushSubscription extends Model
{
    use HasUuids;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['last_sent_at' => 'integer'];
    }
}
