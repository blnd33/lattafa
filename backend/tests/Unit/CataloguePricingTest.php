<?php

namespace Tests\Unit;

use App\Support\CataloguePricing as P;
use PHPUnit\Framework\TestCase;

/**
 * What one bottle costs one wholesale buyer. Pure arithmetic, so every branch of the order of priority is settled
 * here, once, with no database and nothing to mock — §40's pricing block in full.
 *
 * Figures are whole US cents throughout, and percentages are basis points (17.5 % = 1750).
 */
class CataloguePricingTest extends TestCase
{
    // ───────────────────────── the order of priority ─────────────────────────

    public function test_with_nothing_agreed_the_delegates_dollar_list_is_the_price(): void
    {
        $p = P::unit(listCents: 2000);

        $this->assertSame(2000, $p['cents']);
        $this->assertSame(P::SOURCE_LIST, $p['source']);
    }

    public function test_a_countrys_own_price_replaces_the_list(): void
    {
        $p = P::unit(listCents: 2000, countryCents: 2400);

        $this->assertSame(2400, $p['cents']);
        $this->assertSame(P::SOURCE_COUNTRY, $p['source']);
    }

    /** §44 Scenario 3 — standard Turkey $20, this buyer $17. */
    public function test_a_price_agreed_with_one_business_beats_the_country(): void
    {
        $p = P::unit(listCents: 1800, countryCents: 2000, customerCents: 1700);

        $this->assertSame(1700, $p['cents']);
        $this->assertSame(2000, $p['baseCents'], 'what it would have been is kept, so the admin can see the gap');
        $this->assertSame(P::SOURCE_CUSTOMER, $p['source']);
    }

    public function test_a_price_agreed_outright_needs_no_price_underneath_it(): void
    {
        // a perfume the country has never priced can still be sold to one buyer at an agreed figure
        $p = P::unit(listCents: 0, countryCents: null, customerCents: 1500);

        $this->assertSame(1500, $p['cents']);
        $this->assertSame(P::SOURCE_CUSTOMER, $p['source']);
        $this->assertNull($p['baseCents']);
    }

    public function test_a_percentage_for_one_size_comes_off_the_countrys_price(): void
    {
        $p = P::unit(listCents: 1800, countryCents: 2000, customerPercentBp: 1500);

        $this->assertSame(1700, $p['cents']);      // 15 % off $20.00
        $this->assertSame(P::SOURCE_CUSTOMER_PERCENT, $p['source']);
        $this->assertSame(1500, $p['percentBp']);
    }

    public function test_a_percentage_across_the_whole_order_is_used_when_there_is_no_better_one(): void
    {
        $p = P::unit(listCents: 2000, widePercentBp: 1000);

        $this->assertSame(1800, $p['cents']);
        $this->assertSame(P::SOURCE_CUSTOMER_WIDE, $p['source']);
    }

    public function test_with_no_price_anywhere_the_size_simply_has_none(): void
    {
        $p = P::unit(listCents: 0);

        $this->assertNull($p['cents']);
        $this->assertSame(P::SOURCE_NONE, $p['source']);
    }

    public function test_a_list_price_of_zero_means_never_set_not_free(): void
    {
        $this->assertNull(P::unit(listCents: 0)['cents']);
        $this->assertSame(1, P::unit(listCents: 1)['cents'], 'one cent is a price; zero is the absence of one');
    }

    // ───────────────────────── discounts never stack ─────────────────────────

    public function test_the_percentage_for_one_size_wins_over_the_one_across_the_order(): void
    {
        $p = P::unit(listCents: 2000, customerPercentBp: 1000, widePercentBp: 5000);

        $this->assertSame(1800, $p['cents'], 'only 10 % came off — the two are not added together');
        $this->assertSame(P::SOURCE_CUSTOMER_PERCENT, $p['source']);
    }

    public function test_a_price_agreed_outright_ignores_every_percentage(): void
    {
        $p = P::unit(listCents: 2000, countryCents: 2000, customerCents: 1700, customerPercentBp: 2000, widePercentBp: 3000);

        $this->assertSame(1700, $p['cents']);
        $this->assertNull($p['percentBp']);
    }

    public function test_a_percentage_off_nothing_is_still_nothing(): void
    {
        $p = P::unit(listCents: 0, countryCents: null, customerPercentBp: 5000);

        $this->assertNull($p['cents'], 'there is no price to take a percentage off, so there is no price');
        $this->assertSame(P::SOURCE_NONE, $p['source']);
    }

    // ───────────────────────── the figures themselves ─────────────────────────

    public function test_a_part_cent_is_rounded_to_the_nearest_cent(): void
    {
        $this->assertSame(1484, P::less(1799, 1750));   // 1799 × 0.825 = 1484.175
        $this->assertSame(1500, P::less(2000, 2500));   // exactly 1500
        $this->assertSame(667, P::less(1000, 3333));    // 666.7 → 667
    }

    public function test_a_price_can_never_come_out_negative(): void
    {
        $this->assertSame(0, P::less(2000, P::FULL_BP));             // everything off is free, not below zero
        $this->assertSame(0, P::less(2000, 99999));                  // more than everything is still free
        $this->assertSame(2000, P::less(2000, -500));                // less than nothing takes nothing off
        $this->assertSame(0, P::unit(listCents: 2000, customerCents: -1)['cents']);
    }

    public function test_a_percentage_is_held_between_nothing_and_everything(): void
    {
        $this->assertSame(0, P::clampBp(-1));
        $this->assertSame(P::FULL_BP, P::clampBp(999999));
        $this->assertSame(1750, P::clampBp(1750));
    }

    public function test_a_line_and_a_basket_add_up(): void
    {
        $this->assertSame(21600, P::line(1800, 12));
        $this->assertSame(0, P::line(1800, -3), 'a negative quantity buys nothing');

        $basket = P::basket([
            ['unitCents' => 1800, 'qty' => 12],   // $216.00
            ['unitCents' => 1500, 'qty' => 6],    //  $90.00
            ['unitCents' => 1400, 'qty' => 12],   // $168.00
        ]);
        $this->assertSame(47400, $basket['subtotalCents']);   // $474.00, the brief's own example
        $this->assertSame(30, $basket['units']);
    }

    public function test_dollars_are_written_the_way_a_buyer_reads_them(): void
    {
        $this->assertSame('$24.50', P::dollars(2450));
        $this->assertSame('$474.00', P::dollars(47400));
        $this->assertSame('$1,250.75', P::dollars(125075));
        $this->assertSame('$0.00', P::dollars(0));
    }
}
