<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/** A delegate's end-of-day handover: what was sold and collected, the cash counted, approved by a manager. */
class DelegateClosing extends Model
{
    use HasUuids;

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'sales_count' => 'integer', 'sales_iqd' => 'integer', 'cash_sales_iqd' => 'integer', 'credit_sales_iqd' => 'integer',
            'collections_iqd' => 'integer', 'expenses_iqd' => 'integer', 'expected_cash_iqd' => 'integer', 'counted_cash_iqd' => 'integer',
            'variance_iqd' => 'integer', 'van_units' => 'integer', 'visits' => 'integer', 'reviewed_at' => 'integer', 'occurred_at' => 'integer',
            'cash_sales_usd' => 'float', 'collections_usd' => 'float', 'expected_cash_usd' => 'float', 'counted_cash_usd' => 'float', 'variance_usd' => 'float',
        ];
    }
}
