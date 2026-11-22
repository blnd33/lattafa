<?php

namespace Tests\Unit;

use App\Support\CatalogueRules as R;
use PHPUnit\Framework\TestCase;

/**
 * How little the shop is willing to sell. Pure arithmetic, so every rule is settled here before any of it meets a
 * database — and the catalogue runs this exact code as the buyer types, which is why it has to be worth trusting.
 */
class CatalogueRulesTest extends TestCase
{
    /** @param array<string, mixed> $over */
    private function line(array $over = []): array
    {
        return $over + ['variantId' => 'v1', 'sku' => 'KHAM-100', 'category' => 'perfume', 'qty' => 12, 'unitCents' => 1800];
    }

    private function codes(array $result): array
    {
        return array_column($result['problems'], 'code');
    }

    public function test_a_basket_that_breaks_no_rule_is_simply_fine(): void
    {
        $out = R::check([$this->line()]);

        $this->assertTrue($out['ok']);
        $this->assertSame([], $out['problems']);
        $this->assertSame(21600, $out['subtotalCents']);
        $this->assertSame(12, $out['units']);
    }

    public function test_an_empty_basket_is_not_an_order(): void
    {
        $out = R::check([]);

        $this->assertFalse($out['ok']);
        $this->assertSame(['cart_empty'], $this->codes($out));
    }

    // ───────────────────────── the smallest order ─────────────────────────

    /** §44 Scenario 4, with the brief's own figures: Turkey's minimum is $500 and the basket is $474. */
    public function test_below_the_countrys_minimum_it_says_how_much_more_is_needed(): void
    {
        $out = R::check([
            $this->line(['unitCents' => 1800, 'qty' => 12]),                        // $216.00
            $this->line(['variantId' => 'v2', 'sku' => 'ASAD-100', 'unitCents' => 1500, 'qty' => 6]),   // $90.00
            $this->line(['variantId' => 'v3', 'sku' => 'YARA-100', 'unitCents' => 1400, 'qty' => 12]),  // $168.00
        ], countryMinOrderCents: 50000);

        $this->assertFalse($out['ok']);
        $this->assertSame(47400, $out['subtotalCents']);
        $this->assertSame(50000, $out['minOrderCents']);
        $this->assertSame(2600, $out['shortfallCents'], 'add $26.00 more to continue');
        $this->assertContains('min_order', $this->codes($out));
    }

    public function test_the_general_minimum_only_fills_in_where_a_country_has_none(): void
    {
        $basket = [$this->line(['qty' => 1, 'unitCents' => 1000])];   // $10.00
        $general = ['minOrderCents' => 20000, 'enabled' => true];

        // the country has its own, so that is the one that counts
        $this->assertSame(5000, R::check($basket, $general, countryMinOrderCents: 5000)['minOrderCents']);
        // it has none, so the general rule fills in
        $this->assertSame(20000, R::check($basket, $general, countryMinOrderCents: 0)['minOrderCents']);
        // and a rule switched off is no rule at all
        $this->assertSame(0, R::check($basket, ['minOrderCents' => 20000, 'enabled' => false])['minOrderCents']);
    }

    // ───────────────────────── how many, and in what steps ─────────────────────────

    public function test_too_few_of_one_size_is_refused_by_name(): void
    {
        $out = R::check([$this->line(['qty' => 3])], ['minQty' => 6, 'enabled' => true]);

        $this->assertFalse($out['ok']);
        $problem = $out['problems'][0];
        $this->assertSame('min_qty', $problem['code']);
        $this->assertSame('KHAM-100', $problem['params']['sku']);
        $this->assertSame(6, $problem['params']['qty']);
    }

    public function test_quantities_must_be_whole_steps(): void
    {
        $rule = ['minQty' => 6, 'qtyIncrement' => 6, 'enabled' => true];

        foreach ([6, 12, 18, 24] as $allowed) {
            $this->assertTrue(R::check([$this->line(['qty' => $allowed])], $rule)['ok'], "$allowed should be allowed");
        }
        foreach ([7, 9, 13] as $refused) {
            $out = R::check([$this->line(['qty' => $refused])], $rule);
            $this->assertContains('qty_step', $this->codes($out), "$refused should be refused");
        }
    }

    public function test_a_rule_for_one_kind_of_perfume_replaces_the_general_one(): void
    {
        $general = ['minQty' => 6, 'qtyIncrement' => 6, 'enabled' => true];
        $oudOnly = ['oud' => ['minQty' => 2, 'qtyIncrement' => 2, 'enabled' => true]];

        // oud follows its own, gentler rule — the two are not added together
        $this->assertTrue(R::check([$this->line(['category' => 'oud', 'qty' => 2])], $general, $oudOnly)['ok']);
        // everything else still follows the general one
        $this->assertContains('min_qty', $this->codes(R::check([$this->line(['category' => 'perfume', 'qty' => 2])], $general, $oudOnly)));
    }

    public function test_a_category_rule_switched_off_hands_the_line_back_to_the_general_rule(): void
    {
        $out = R::check(
            [$this->line(['category' => 'oud', 'qty' => 2])],
            ['minQty' => 6, 'enabled' => true],
            ['oud' => ['minQty' => 2, 'enabled' => false]],
        );

        $this->assertContains('min_qty', $this->codes($out));
        $this->assertSame(6, $out['lines'][0]['minQty']);
    }

    // ───────────────────────── businesses let off ─────────────────────────

    public function test_a_business_let_off_a_rule_is_not_held_to_it(): void
    {
        $general = ['minOrderCents' => 50000, 'minQty' => 6, 'qtyIncrement' => 6, 'enabled' => true];
        $small = [$this->line(['qty' => 1, 'unitCents' => 1000])];

        // one bottle breaks all three at once: too few, not a whole step of six, and far under the minimum
        $held = R::check($small, $general);
        $this->assertEqualsCanonicalizing(['min_qty', 'qty_step', 'min_order'], $this->codes($held));

        $letOff = R::check($small, $general, exempt: ['min_order', 'min_qty', 'qty_increment']);
        $this->assertTrue($letOff['ok']);
        $this->assertSame(0, $letOff['minOrderCents']);
        $this->assertSame(0, $letOff['lines'][0]['minQty']);
    }

    public function test_being_let_off_one_rule_does_not_let_a_business_off_the_others(): void
    {
        $out = R::check([$this->line(['qty' => 1, 'unitCents' => 1000])], ['minOrderCents' => 50000, 'minQty' => 6, 'enabled' => true], exempt: ['min_order']);

        $this->assertSame(['min_qty'], $this->codes($out));
        $this->assertSame(0, $out['minOrderCents']);
    }

    // ───────────────────────── what else can be wrong ─────────────────────────

    public function test_a_size_with_no_agreed_price_cannot_be_ordered(): void
    {
        $out = R::check([$this->line(['unitCents' => null])]);

        $this->assertFalse($out['ok']);
        $this->assertSame(['unpriced'], $this->codes($out));
        $this->assertSame(0, $out['subtotalCents'], 'a line with no price adds nothing to the total');
    }

    public function test_the_shelf_is_no_part_of_the_arithmetic(): void
    {
        // the catalogue sells with no limit, so a basket far past anything the shop holds is simply fine
        $out = R::check([$this->line(['qty' => 100000])]);

        $this->assertSame([], $this->codes($out), 'no stock refusal exists any more');
        $this->assertTrue($out['ok']);
    }

    public function test_nothing_at_all_of_a_size_is_not_an_order_for_it(): void
    {
        $out = R::check([$this->line(['qty' => 0])]);

        $this->assertContains('invalid_quantity', $this->codes($out));
    }

    public function test_every_problem_comes_back_as_a_code_and_its_figures_never_as_a_sentence(): void
    {
        $out = R::check([$this->line(['qty' => 3, 'unitCents' => null])], ['minQty' => 6, 'minOrderCents' => 50000, 'enabled' => true]);

        foreach ($out['problems'] as $problem) {
            $this->assertMatchesRegularExpression('/^[a-z_]+$/', $problem['code']);
            $this->assertIsArray($problem['params']);
        }
        // the catalogue says it in the buyer's own language; the server only says what is wrong
        $this->assertStringNotContainsString(' ', implode('', $this->codes($out)));
    }

    public function test_a_line_carries_the_rules_it_was_held_to(): void
    {
        $out = R::check([$this->line(['qty' => 12])], ['minQty' => 6, 'qtyIncrement' => 6, 'enabled' => true]);

        $line = $out['lines'][0];
        $this->assertSame(6, $line['minQty']);
        $this->assertSame(6, $line['step']);
        $this->assertSame(21600, $line['lineCents']);
        $this->assertSame([], $line['problems']);
    }
}
