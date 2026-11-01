<?php

namespace App\Support;

/**
 * PricingService — the ONE place bill maths lives (brief §10). A 1:1 port of `pos/src/lib/pricing.ts`.
 *
 * Order of operations:
 *   1. line gross      = unit price × qty
 *   2. line discount   = gross × line % (whole dinar)
 *   3. order discount  = % or fixed amount off the sum of net lines
 *   4. loyalty points  = redeemed value off what is left
 *   5. tax             = % on the discounted amount (exclusive)
 *   6. gift wrap fee   = added last, untaxed
 *   7. rounding        = to the configured IQD step (e.g. 250)
 *
 * Everything is integer IQD. The server recomputes every bill with this, so a tampered client total is caught.
 */
final class Pricing
{
    public static function clamp(float|int $n, float|int $lo, float|int $hi): float|int
    {
        return min($hi, max($lo, $n));
    }

    /** Round half away from zero — same as JavaScript's Math.round for the positive amounts we deal with. */
    public static function round(float|int $n): int
    {
        return (int) floor($n + 0.5);
    }

    public static function roundTo(float|int $n, int $step): int
    {
        return $step > 0 ? self::round($n / $step) * $step : self::round($n);
    }

    /**
     * @param array{
     *   lines: array<int, array{key: string, unitPriceIQD: int, qty: int, discountPct: int|float}>,
     *   orderDiscount?: array{type: string, value: int|float}|null,
     *   pointsRedeemedIQD?: int, giftWrapIQD?: int, taxPct?: int|float, rounding?: int
     * } $in
     * @return array<string, mixed>
     */
    public static function priceCart(array $in): array
    {
        $lines = [];
        foreach ($in['lines'] as $l) {
            $qty = max(0, (int) floor($l['qty']));
            $gross = max(0, self::round($l['unitPriceIQD'])) * $qty;
            $pct = self::clamp($l['discountPct'] ?? 0, 0, 100);
            $discount = (int) self::clamp(self::round($gross * $pct / 100), 0, $gross);
            $lines[] = ['key' => $l['key'], 'gross' => $gross, 'discount' => $discount, 'net' => $gross - $discount];
        }

        $subtotal = array_sum(array_column($lines, 'gross'));
        $itemDiscount = array_sum(array_column($lines, 'discount'));
        $sumNet = $subtotal - $itemDiscount;

        $orderDiscount = 0;
        $od = $in['orderDiscount'] ?? null;
        if ($od && ($od['value'] ?? 0) > 0) {
            $orderDiscount = $od['type'] === 'pct'
                ? self::round($sumNet * self::clamp($od['value'], 0, 100) / 100)
                : self::round($od['value']);
            $orderDiscount = (int) self::clamp($orderDiscount, 0, $sumNet);
        }

        $afterOrder = $sumNet - $orderDiscount;
        $pointsRedeemed = (int) self::clamp(self::round($in['pointsRedeemedIQD'] ?? 0), 0, $afterOrder);
        $taxable = $afterOrder - $pointsRedeemed;
        $tax = self::round($taxable * self::clamp($in['taxPct'] ?? 0, 0, 100) / 100);
        $giftWrap = max(0, self::round($in['giftWrapIQD'] ?? 0));

        $exact = $taxable + $tax + $giftWrap;
        $total = $exact > 0 ? self::roundTo($exact, (int) ($in['rounding'] ?? 0)) : 0;

        return [
            'lines' => $lines,
            'subtotal' => $subtotal,
            'itemDiscount' => $itemDiscount,
            'orderDiscount' => $orderDiscount,
            'pointsRedeemed' => $pointsRedeemed,
            'tax' => $tax,
            'giftWrap' => $giftWrap,
            'rounding' => $total - $exact,
            'total' => $total,
            'effectiveDiscountPct' => $subtotal > 0 ? (($itemDiscount + $orderDiscount) / $subtotal) * 100 : 0.0,
        ];
    }

    /** Loyalty points earned on a bill (whole points, never negative). */
    public static function pointsEarned(int $totalIQD, float|int $pointsPer1000): int
    {
        return max(0, (int) floor(($totalIQD / 1000) * $pointsPer1000));
    }
}
