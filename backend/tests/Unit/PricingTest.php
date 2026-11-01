<?php

namespace Tests\Unit;

use App\Support\Pricing;
use PHPUnit\Framework\TestCase;

/**
 * Same cases as `describe('priceCart')` in pos/src/lib/lib.test.ts. The till and the server must produce the
 * same bill for the same cart, so these two suites are meant to stay identical.
 */
class PricingTest extends TestCase
{
    public function test_sums_lines_with_per_line_discount(): void
    {
        $r = Pricing::priceCart(['rounding' => 250, 'lines' => [
            ['key' => 'a', 'unitPriceIQD' => 45000, 'qty' => 1, 'discountPct' => 0],
            ['key' => 'b', 'unitPriceIQD' => 38000, 'qty' => 2, 'discountPct' => 10],
        ]]);
        $this->assertSame(121000, $r['subtotal']);
        $this->assertSame(7600, $r['itemDiscount']);
        $this->assertSame(113500, $r['total']); // 113,400 rounded to the 250 step
        $this->assertSame(100, $r['rounding']);
    }

    public function test_order_discount_applies_after_line_discounts(): void
    {
        $r = Pricing::priceCart(['rounding' => 0, 'lines' => [['key' => 'a', 'unitPriceIQD' => 100000, 'qty' => 1, 'discountPct' => 10]], 'orderDiscount' => ['type' => 'pct', 'value' => 10]]);
        $this->assertSame(81000, $r['total']);
        $this->assertEqualsWithDelta(19.0, $r['effectiveDiscountPct'], 1e-5);
    }

    public function test_fixed_discounts_and_points_are_capped_at_what_is_left(): void
    {
        $r = Pricing::priceCart(['rounding' => 0, 'lines' => [['key' => 'a', 'unitPriceIQD' => 10000, 'qty' => 1, 'discountPct' => 0]], 'orderDiscount' => ['type' => 'fixed', 'value' => 99999], 'pointsRedeemedIQD' => 5000]);
        $this->assertSame(0, $r['total']);
        $this->assertSame(10000, $r['orderDiscount']);
        $this->assertSame(0, $r['pointsRedeemed']);
    }

    public function test_adds_tax_and_gift_wrap(): void
    {
        $r = Pricing::priceCart(['rounding' => 0, 'taxPct' => 5, 'giftWrapIQD' => 2000, 'lines' => [['key' => 'a', 'unitPriceIQD' => 20000, 'qty' => 1, 'discountPct' => 0]]]);
        $this->assertSame(1000, $r['tax']);
        $this->assertSame(23000, $r['total']);
    }

    public function test_never_goes_negative_and_ignores_bad_input(): void
    {
        $r = Pricing::priceCart(['rounding' => 250, 'lines' => [['key' => 'a', 'unitPriceIQD' => -5, 'qty' => -2, 'discountPct' => 500]]]);
        $this->assertSame(0, $r['total']);
    }

    public function test_loyalty_points_round_down_and_never_go_negative(): void
    {
        $this->assertSame(157, Pricing::pointsEarned(157500, 1));
        $this->assertSame(0, Pricing::pointsEarned(0, 1));
        $this->assertSame(0, Pricing::pointsEarned(-5000, 1));
        $this->assertSame(315, Pricing::pointsEarned(157500, 2));
    }

    public function test_rounding_matches_javascripts_math_round_for_money(): void
    {
        $this->assertSame(113500, Pricing::roundTo(113400, 250)); // half a step rounds up, like JS Math.round
        $this->assertSame(113250, Pricing::roundTo(113374, 250));
        $this->assertSame(13, Pricing::roundTo(12.6, 0));
        $this->assertSame(3, Pricing::round(2.5));
        $this->assertSame(0, Pricing::roundTo(100, 250)); // 0.4 of a step → down
        $this->assertSame(250, Pricing::roundTo(125, 250)); // exactly half → up
    }

    public function test_the_bill_is_always_a_whole_number_of_steps(): void
    {
        foreach ([1, 7, 13, 49, 101] as $qty) {
            foreach ([0, 5, 12, 33] as $pct) {
                $r = Pricing::priceCart(['rounding' => 250, 'taxPct' => 5, 'lines' => [['key' => 'a', 'unitPriceIQD' => 33333, 'qty' => $qty, 'discountPct' => $pct]]]);
                $this->assertSame(0, $r['total'] % 250, "qty $qty at $pct%");
                $this->assertSame($r['total'], $r['subtotal'] - $r['itemDiscount'] - $r['orderDiscount'] - $r['pointsRedeemed'] + $r['tax'] + $r['giftWrap'] + $r['rounding']);
            }
        }
    }
}
