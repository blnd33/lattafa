<?php

namespace App\Support;

/**
 * Amounts in dinars or dollars for buying and spending. Sums are done in whole cents (never in floating point), stored as
 * decimal(14,2), and every amount also gets its value in dinars at the day's rate for reports.
 * Dinar amounts are whole dinars — there are no fils in circulation.
 */
final class Money
{
    public const CURRENCIES = ['IQD', 'USD'];

    /** 12.5 / "12.50" → 1250 cents; a dinar amount is rounded to the whole dinar first. */
    public static function cents(float|int|string|null $amount, string $currency): int
    {
        $v = (float) ($amount ?? 0);

        return $currency === 'IQD' ? (int) round($v) * 100 : (int) round($v * 100);
    }

    /** 1250 → "12.50" (for a decimal column). */
    public static function decimal(int $cents): string
    {
        return number_format($cents / 100, 2, '.', '');
    }

    /** The value in dinars: dollars × rate, dinars as they are. */
    public static function iqd(int $cents, string $currency, int $rate): int
    {
        return $currency === 'USD' ? (int) round($cents * $rate / 100) : intdiv($cents, 100);
    }

    /** A decimal column value for JSON: "12.50" → 12.5. */
    public static function out(float|int|string|null $decimal): float
    {
        return round((float) ($decimal ?? 0), 2);
    }
}
