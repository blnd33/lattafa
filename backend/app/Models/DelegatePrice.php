<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * One delegate's own selling price for one size, in whole US cents.
 *
 * Absent means "use the shop's dollar list" (`variants.wholesale_usd_cents`), and absent there too means the
 * dinar price converted at the day's rate. The perfume is still the shop's — only this figure is the delegate's.
 */
class DelegatePrice extends Model
{
    use HasUuids;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['usd_cents' => 'integer'];
    }

    /** `[variantId => cents]` for one delegate — the shape both the pricing and the phone's pull want. */
    public static function forDelegate(string $userId): array
    {
        return static::where('user_id', $userId)->pluck('usd_cents', 'variant_id')
            ->map(fn ($c) => (int) $c)->all();
    }
}
