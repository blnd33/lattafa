<?php

namespace App\Support;

/** Bottle sizes in millilitres or fluid ounces. A 1:1 port of `pos/src/lib/size.ts`. */
final class Size
{
    public const UNITS = ['ml', 'oz'];

    /** 1 US fluid ounce = 29.5735 ml. */
    public const OZ_IN_ML = 29.5735;

    /** The size as whole millilitres (3.4 oz → 101). */
    public static function toMl(float $size, string $unit): int
    {
        return $size > 0 ? (int) round($unit === 'oz' ? $size * self::OZ_IN_ML : $size) : 0;
    }

    /** "100 ml" / "3.4 oz"; empty when there is no size (gift sets). */
    public static function label(float $size, string $unit): string
    {
        return $size > 0 ? rtrim(rtrim(number_format($size, 2, '.', ''), '0'), '.').' '.$unit : '';
    }

    /** Two decimals at most, never negative. */
    public static function clean(mixed $size): float
    {
        return round(max(0, (float) $size), 2);
    }
}
