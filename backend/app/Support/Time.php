<?php

namespace App\Support;

use Illuminate\Support\Carbon;

/** All domain timestamps are epoch milliseconds, exactly like the POS. */
final class Time
{
    public static function nowMs(): int
    {
        return (int) floor(microtime(true) * 1000);
    }

    /**
     * An epoch-ms instant as a Carbon in the *shop's* timezone. (Carbon 3 builds `createFromTimestampMs` in UTC
     * unless told otherwise, which would put "today" and the hourly sales buckets three hours off in Duhok.)
     */
    public static function at(int $ms): Carbon
    {
        return Carbon::createFromTimestampMs($ms, config('app.timezone'));
    }

    public static function startOfDayMs(?int $ms = null): int
    {
        return (int) self::at($ms ?? self::nowMs())->startOfDay()->getTimestampMs();
    }

    public static function endOfDayMs(?int $ms = null): int
    {
        // last millisecond of the day (Carbon's own endOfDay()->getTimestampMs() rounds .999999 up into the next day)
        return (int) self::at($ms ?? self::nowMs())->startOfDay()->addDay()->getTimestampMs() - 1;
    }
}
