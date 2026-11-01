<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;

/** Atomic, gap-free counters for document numbers (sales, returns, barcodes). Call inside a transaction. */
class Counters
{
    public function next(string $key): int
    {
        $row = DB::table('counters')->where('key', $key)->lockForUpdate()->first();
        if ($row) {
            $value = (int) $row->value + 1;
            DB::table('counters')->where('key', $key)->update(['value' => $value]);
        } else {
            $value = 1;
            DB::table('counters')->insert(['key' => $key, 'value' => 1]);
        }

        return $value;
    }
}
