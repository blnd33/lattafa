<?php

namespace App\Support;

/**
 * What one bottle costs one wholesale buyer — the single place that answer is worked out.
 *
 * In the spirit of `Support\Pricing`, which does the same job for the shop's own tills: pure arithmetic, no database,
 * no permissions, nothing to mock. Everything is whole US cents; the catalogue is USD only and money is never a float.
 * Percentages are basis points (17.5 % = 1750) for the same reason.
 *
 * ## The order of priority
 *
 * 1. **A price agreed with this business for this size.** It stands on its own — a buyer can be given a price for a
 *    perfume the country has no price for at all.
 * 2. **A percentage off**, taken off whatever the price would otherwise have been: the one agreed for this size if
 *    there is one, else the one agreed across this buyer's whole order. **Never both** — discounts do not stack.
 * 3. **The country's wholesale price.**
 * 4. **The delegate's dollar list** (`variants.wholesale_usd_cents`), which the whole system already keeps.
 * 5. Otherwise the size has **no price**: the catalogue shows it, and it cannot be ordered.
 *
 * A price can never come out negative: a percentage is held between 0 and 100, and the result is floored at zero.
 */
final class CataloguePricing
{
    public const SOURCE_CUSTOMER = 'customer';

    public const SOURCE_CUSTOMER_PERCENT = 'customer_percent';

    public const SOURCE_CUSTOMER_WIDE = 'customer_wide';

    public const SOURCE_COUNTRY = 'country';

    public const SOURCE_LIST = 'list';

    /** No price anywhere: the perfume is shown, but it cannot be put in an order. */
    public const SOURCE_NONE = 'none';

    /** 100 % in basis points. */
    public const FULL_BP = 10000;

    /**
     * The price of one bottle, and where it came from.
     *
     * `listCents` is `variants.wholesale_usd_cents`, where 0 means "never set". The three customer figures are
     * whatever is in force today — working out which agreement is in date is the service's job, not this one's.
     *
     * @return array{cents: int|null, baseCents: int|null, source: string, percentBp: int|null}
     */
    public static function unit(
        int $listCents,
        ?int $countryCents = null,
        ?int $customerCents = null,
        ?int $customerPercentBp = null,
        ?int $widePercentBp = null,
    ): array {
        // what the price would be before anything agreed with this one buyer
        $base = $countryCents ?? ($listCents > 0 ? $listCents : null);

        // 1 · a price agreed outright needs no base to stand on
        if ($customerCents !== null) {
            return ['cents' => max(0, $customerCents), 'baseCents' => $base, 'source' => self::SOURCE_CUSTOMER, 'percentBp' => null];
        }

        // 2 · one percentage, never two: the one for this size beats the one across the order
        $percent = $customerPercentBp ?? $widePercentBp;
        if ($percent !== null && $base !== null) {
            return [
                'cents' => self::less($base, $percent),
                'baseCents' => $base,
                'source' => $customerPercentBp !== null ? self::SOURCE_CUSTOMER_PERCENT : self::SOURCE_CUSTOMER_WIDE,
                'percentBp' => self::clampBp($percent),
            ];
        }

        // 3 and 4 · the country's price, else the dollar list the delegates already use
        if ($base !== null) {
            return [
                'cents' => $base,
                'baseCents' => $base,
                'source' => $countryCents !== null ? self::SOURCE_COUNTRY : self::SOURCE_LIST,
                'percentBp' => null,
            ];
        }

        // 5 · nothing to charge. A percentage off nothing is still nothing, so it is not a price either.
        return ['cents' => null, 'baseCents' => null, 'source' => self::SOURCE_NONE, 'percentBp' => null];
    }

    /** `$cents` less `$bp` basis points, to the nearest cent, never below zero. */
    public static function less(int $cents, int $bp): int
    {
        $bp = self::clampBp($bp);

        return max(0, (int) round($cents * (self::FULL_BP - $bp) / self::FULL_BP));
    }

    /** A percentage is a percentage: nothing below zero, nothing above the whole price. */
    public static function clampBp(int $bp): int
    {
        return max(0, min(self::FULL_BP, $bp));
    }

    /** Whole cents for a line, which is just the unit price as many times as it was ordered. */
    public static function line(int $unitCents, int $qty): int
    {
        return max(0, $unitCents) * max(0, $qty);
    }

    /**
     * @param array<int, array{unitCents: int, qty: int}> $lines
     * @return array{subtotalCents: int, units: int}
     */
    public static function basket(array $lines): array
    {
        $subtotal = 0;
        $units = 0;
        foreach ($lines as $l) {
            $subtotal += self::line((int) $l['unitCents'], (int) $l['qty']);
            $units += max(0, (int) $l['qty']);
        }

        return ['subtotalCents' => $subtotal, 'units' => $units];
    }

    /** `2450` → `$24.50`. For a WhatsApp order and anywhere else the server writes the figure itself. */
    public static function dollars(int $cents): string
    {
        return '$'.number_format($cents / 100, 2, '.', ',');
    }
}
