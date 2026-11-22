<?php

namespace Tests\Feature;

use App\Models\CatalogueCountry;
use App\Models\CataloguePriceHistory;
use App\Models\Variant;
use App\Support\Time;
use Tests\ApiTestCase;

/**
 * Prices and wholesale rules over the wire — §44 Scenarios 2, 3 and 4, and the rule the whole thing rests on:
 * a price is never in a reply to anyone who has not unlocked the catalogue.
 */
class WholesalePricingTest extends ApiTestCase
{
    private string $turkeyId;

    private string $istanbul;

    protected function setUp(): void
    {
        parent::setUp();
        $this->shop();

        $this->api('PUT', 'catalogue/languages', ['code' => 'tr', 'enabled' => true])->assertOk();
        $this->turkeyId = $this->api('POST', 'catalogue/countries', [
            'iso2' => 'TR', 'name' => ['en' => 'Türkiye'], 'language' => 'tr', 'enabled' => true,
        ])->assertCreated()->json('country.id');

        $this->istanbul = $this->buyer('Istanbul Perfumes');
    }

    private function buyer(string $name): string
    {
        return $this->api('POST', 'catalogue/customers', ['businessName' => $name, 'countryId' => $this->turkeyId])
            ->assertCreated()->json('customer.id');
    }

    /** Gives the business a code, unlocks it, and returns the session token. */
    private function unlocked(string $customerId): string
    {
        $code = $this->api('POST', 'catalogue/customers/'.$customerId.'/codes')->assertCreated()->json('plain');

        return $this->postJson('/api/v1/wholesale/unlock', ['code' => $code])->assertOk()->json('token');
    }

    private function asBuyer(string $token): self
    {
        $this->app['auth']->forgetGuards();   // see WholesaleAccessTest::buyer()

        return $this->withHeaders(['Authorization' => 'Bearer '.$token, 'Accept' => 'application/json']);
    }

    /** What this buyer pays for one size, straight from their own price list. */
    private function priceOf(string $token, Variant $v): ?int
    {
        $lines = $this->asBuyer($token)->getJson('/api/v1/wholesale/prices')->assertOk()->json('lines');

        return collect($lines)->firstWhere('variantId', $v->id)['priceCents'] ?? null;
    }

    private function setCountryPrice(Variant $v, ?int $cents): void
    {
        $this->api('PUT', 'catalogue/prices/'.$this->turkeyId, ['prices' => [$v->id => $cents]])->assertOk();
    }

    // ───────────────────────── §44 Scenario 2 — wholesale access ─────────────────────────

    public function test_an_authorised_buyer_sees_the_countrys_wholesale_prices(): void
    {
        $khamrah = $this->variantOf('Khamrah');
        $this->setCountryPrice($khamrah, 2400);

        $this->assertSame(2400, $this->priceOf($this->unlocked($this->istanbul), $khamrah));
    }

    public function test_a_size_with_no_country_price_falls_back_to_the_delegates_dollar_list(): void
    {
        $asad = $this->variantOf('Asad');
        $asad->update(['wholesale_usd_cents' => 1900]);     // the list the delegates already sell from

        $prices = $this->asBuyer($this->unlocked($this->istanbul))->getJson('/api/v1/wholesale/prices')->assertOk()->json('lines');
        $line = collect($prices)->firstWhere('variantId', $asad->id);

        $this->assertSame(1900, $line['priceCents']);
        $this->assertSame('list', $line['source']);
    }

    public function test_a_size_priced_nowhere_is_left_out_of_the_list_rather_than_shown_at_zero(): void
    {
        $khamrah = $this->variantOf('Khamrah');
        Variant::query()->update(['wholesale_usd_cents' => 0]);   // nothing priced anywhere yet

        $lines = $this->asBuyer($this->unlocked($this->istanbul))->getJson('/api/v1/wholesale/prices')->assertOk()->json('lines');

        $this->assertSame([], $lines);
        $this->assertNull(collect($lines)->firstWhere('variantId', $khamrah->id));
    }

    // ───────────────────────── §44 Scenario 3 — special pricing ─────────────────────────

    public function test_one_business_gets_its_own_price_while_another_pays_the_standard_one(): void
    {
        $khamrah = $this->variantOf('Khamrah');
        $this->setCountryPrice($khamrah, 2000);                       // Türkiye's standard price, $20.00

        $ankara = $this->buyer('Ankara Scents');
        $this->api('PUT', 'catalogue/customers/'.$this->istanbul.'/terms', [
            'terms' => [$khamrah->id => ['priceCents' => 1700]],      // agreed with this one business, $17.00
        ])->assertOk()->assertJsonPath('changed', 1);

        $this->assertSame(1700, $this->priceOf($this->unlocked($this->istanbul), $khamrah));
        $this->assertSame(2000, $this->priceOf($this->unlocked($ankara), $khamrah));
    }

    public function test_a_percentage_off_everything_is_applied_to_whatever_the_price_would_have_been(): void
    {
        $khamrah = $this->variantOf('Khamrah');
        $this->setCountryPrice($khamrah, 2000);

        $this->api('PUT', 'catalogue/customers/'.$this->istanbul.'/discount', ['percentBp' => 1500])->assertOk();

        $this->assertSame(1700, $this->priceOf($this->unlocked($this->istanbul), $khamrah));
    }

    public function test_an_agreement_that_has_run_out_is_not_used(): void
    {
        $khamrah = $this->variantOf('Khamrah');
        $this->setCountryPrice($khamrah, 2000);

        $this->api('PUT', 'catalogue/customers/'.$this->istanbul.'/terms', ['terms' => [
            $khamrah->id => ['priceCents' => 1200, 'validTo' => Time::nowMs() - 1000],
        ]])->assertOk();

        $this->assertSame(2000, $this->priceOf($this->unlocked($this->istanbul), $khamrah), 'yesterday\'s agreement is not today\'s price');
    }

    public function test_a_price_and_a_percentage_for_the_same_size_is_refused(): void
    {
        $khamrah = $this->variantOf('Khamrah');

        $this->api('PUT', 'catalogue/customers/'.$this->istanbul.'/terms', ['terms' => [
            $khamrah->id => ['priceCents' => 1700, 'percentBp' => 1000],
        ]])->assertStatus(422)->assertJsonPath('error.code', 'price_or_percent');
    }

    public function test_withdrawing_an_agreement_puts_the_buyer_back_on_the_countrys_price(): void
    {
        $khamrah = $this->variantOf('Khamrah');
        $this->setCountryPrice($khamrah, 2000);
        $this->api('PUT', 'catalogue/customers/'.$this->istanbul.'/terms', ['terms' => [$khamrah->id => ['priceCents' => 1700]]])->assertOk();
        $this->assertSame(1700, $this->priceOf($this->unlocked($this->istanbul), $khamrah));

        $this->api('PUT', 'catalogue/customers/'.$this->istanbul.'/terms', ['terms' => [$khamrah->id => ['priceCents' => null, 'percentBp' => null]]])
            ->assertOk()->assertJsonPath('changed', 1);

        $this->assertSame(2000, $this->priceOf($this->unlocked($this->istanbul), $khamrah));
    }

    // ───────────────────────── §44 Scenario 4 — the smallest order ─────────────────────────

    public function test_a_basket_under_the_minimum_is_told_how_much_more_is_needed(): void
    {
        $khamrah = $this->variantOf('Khamrah');
        $this->setCountryPrice($khamrah, 2000);
        $this->api('PUT', 'catalogue/countries/'.$this->turkeyId, [
            'iso2' => 'TR', 'name' => ['en' => 'Türkiye'], 'language' => 'tr', 'enabled' => true, 'minOrderCents' => 50000,
        ])->assertOk();

        $token = $this->unlocked($this->istanbul);
        $quote = $this->asBuyer($token)->postJson('/api/v1/wholesale/quote', [
            'lines' => [['variantId' => $khamrah->id, 'qty' => 5]],     // $100.00
        ])->assertOk();

        $this->assertFalse($quote->json('ok'));
        $this->assertSame(10000, $quote->json('subtotalCents'));
        $this->assertSame(50000, $quote->json('minOrderCents'));
        $this->assertSame(40000, $quote->json('shortfallCents'));
        $this->assertContains('min_order', array_column($quote->json('problems'), 'code'));
    }

    public function test_the_smallest_quantity_and_the_steps_are_enforced_on_the_server(): void
    {
        $khamrah = $this->variantOf('Khamrah');
        $this->setCountryPrice($khamrah, 2000);
        $this->api('PUT', 'catalogue/rules', ['scope' => 'global', 'minQty' => 6, 'qtyIncrement' => 6, 'enabled' => true])->assertOk();

        $token = $this->unlocked($this->istanbul);
        $quote = fn (int $qty) => $this->asBuyer($token)->postJson('/api/v1/wholesale/quote', ['lines' => [['variantId' => $khamrah->id, 'qty' => $qty]]])->assertOk();

        $this->assertEqualsCanonicalizing(['min_qty', 'qty_step'], array_column($quote(3)->json('problems'), 'code'));
        $this->assertSame(['qty_step'], array_column($quote(7)->json('problems'), 'code'));
        $this->assertTrue($quote(12)->json('ok'));
    }

    public function test_a_rule_whose_smallest_quantity_is_not_a_whole_step_is_refused(): void
    {
        $this->api('PUT', 'catalogue/rules', ['scope' => 'global', 'minQty' => 7, 'qtyIncrement' => 6])
            ->assertStatus(422)->assertJsonPath('error.code', 'rule_min_not_a_step');
    }

    public function test_a_business_let_off_the_minimum_can_order_what_it_likes(): void
    {
        $khamrah = $this->variantOf('Khamrah');
        $this->setCountryPrice($khamrah, 2000);
        $this->api('PUT', 'catalogue/countries/'.$this->turkeyId, [
            'iso2' => 'TR', 'name' => ['en' => 'Türkiye'], 'language' => 'tr', 'enabled' => true, 'minOrderCents' => 50000,
        ])->assertOk();
        $this->api('PUT', 'catalogue/customers/'.$this->istanbul.'/exemptions', ['letOff' => ['min_order']])
            ->assertOk()->assertJsonPath('letOff.0', 'min_order');

        $quote = $this->asBuyer($this->unlocked($this->istanbul))->postJson('/api/v1/wholesale/quote', [
            'lines' => [['variantId' => $khamrah->id, 'qty' => 1]],
        ])->assertOk();

        $this->assertTrue($quote->json('ok'));
        $this->assertSame(0, $quote->json('minOrderCents'));
    }

    public function test_a_quote_for_far_more_than_the_shop_has_is_perfectly_fine(): void
    {
        $khamrah = $this->variantOf('Khamrah');
        $this->setCountryPrice($khamrah, 2000);
        $have = $this->stockOf($khamrah);

        $quote = $this->asBuyer($this->unlocked($this->istanbul))->postJson('/api/v1/wholesale/quote', [
            'lines' => [['variantId' => $khamrah->id, 'qty' => $have + 5000]],
        ])->assertOk();

        // the catalogue sells with no limit, and the quote never hints at what is on a shelf in Duhok
        $this->assertSame([], $quote->json('problems'));
        $this->assertTrue($quote->json('ok'));
        $this->assertStringNotContainsString('stock', $quote->getContent());
    }

    public function test_the_same_size_twice_in_one_basket_is_one_line(): void
    {
        $khamrah = $this->variantOf('Khamrah');
        $this->setCountryPrice($khamrah, 2000);

        $quote = $this->asBuyer($this->unlocked($this->istanbul))->postJson('/api/v1/wholesale/quote', [
            'lines' => [['variantId' => $khamrah->id, 'qty' => 2], ['variantId' => $khamrah->id, 'qty' => 3]],
        ])->assertOk();

        $this->assertCount(1, $quote->json('lines'));
        $this->assertSame(5, $quote->json('lines.0.qty'));
        $this->assertSame(10000, $quote->json('subtotalCents'));
    }

    // ───────────────────────── a price never reaches the wrong hands ─────────────────────────

    public function test_there_is_no_route_to_a_price_without_unlocking_the_catalogue(): void
    {
        $khamrah = $this->variantOf('Khamrah');
        $this->setCountryPrice($khamrah, 2400);

        $this->app['auth']->forgetGuards();
        $this->getJson('/api/v1/wholesale/prices')->assertStatus(401)->assertJsonPath('error.code', 'not_unlocked');
        $this->postJson('/api/v1/wholesale/quote', ['lines' => []])->assertStatus(401);

        // and the one page a visitor may read carries no figure at all
        $open = $this->getJson('/api/v1/wholesale/open')->assertOk()->getContent();
        $this->assertStringNotContainsString('2400', $open);
        $this->assertStringNotContainsString('priceCents', $open);
    }

    public function test_one_buyers_token_never_shows_another_buyers_price(): void
    {
        $khamrah = $this->variantOf('Khamrah');
        $this->setCountryPrice($khamrah, 2000);
        $ankara = $this->buyer('Ankara Scents');
        $this->api('PUT', 'catalogue/customers/'.$ankara.'/terms', ['terms' => [$khamrah->id => ['priceCents' => 900]]])->assertOk();

        $body = $this->asBuyer($this->unlocked($this->istanbul))->getJson('/api/v1/wholesale/prices')->assertOk()->getContent();

        $this->assertStringNotContainsString('900', $body);
        $this->assertStringNotContainsString('Ankara', $body);
    }

    public function test_a_buyers_token_cannot_read_or_change_the_price_lists(): void
    {
        $token = $this->unlocked($this->istanbul);

        $this->assertSame(401, $this->asBuyer($token)->getJson('/api/v1/catalogue/prices/'.$this->turkeyId)->getStatusCode());
        $this->assertSame(401, $this->asBuyer($token)->putJson('/api/v1/catalogue/prices/'.$this->turkeyId, ['prices' => []])->getStatusCode());
        $this->assertSame(401, $this->asBuyer($token)->getJson('/api/v1/catalogue/prices/history')->getStatusCode());
        $this->assertSame(401, $this->asBuyer($token)->putJson('/api/v1/catalogue/rules', ['scope' => 'global'])->getStatusCode());
    }

    // ───────────────────────── the trail, and who may change a price ─────────────────────────

    public function test_every_price_change_is_kept_with_who_made_it(): void
    {
        $khamrah = $this->variantOf('Khamrah');
        $this->setCountryPrice($khamrah, 2000);
        $this->setCountryPrice($khamrah, 2400);
        $this->setCountryPrice($khamrah, null);

        $history = $this->api('GET', 'catalogue/prices/history', ['variantId' => $khamrah->id])->assertOk()->json('history');

        $this->assertCount(3, $history);
        $this->assertSame([null, 2000], [$history[2]['fromCents'], $history[2]['toCents']]);
        $this->assertSame([2000, 2400], [$history[1]['fromCents'], $history[1]['toCents']]);
        $this->assertSame([2400, null], [$history[0]['fromCents'], $history[0]['toCents']], 'taking a price away is a change too');
        $this->assertSame('Owner', $history[0]['byName']);
    }

    public function test_setting_a_price_to_what_it_already_was_changes_nothing(): void
    {
        $khamrah = $this->variantOf('Khamrah');
        $this->setCountryPrice($khamrah, 2000);

        $this->api('PUT', 'catalogue/prices/'.$this->turkeyId, ['prices' => [$khamrah->id => 2000]])
            ->assertOk()->assertJsonPath('changed', 0);
        $this->assertSame(1, CataloguePriceHistory::count());
    }

    public function test_a_price_for_a_size_that_does_not_exist_is_ignored(): void
    {
        $this->api('PUT', 'catalogue/prices/'.$this->turkeyId, ['prices' => ['01999999-0000-7000-8000-000000000000' => 1000]])
            ->assertOk()->assertJsonPath('changed', 0);
        $this->assertSame(0, CataloguePriceHistory::count());
    }

    public function test_the_catalogue_manager_minds_the_perfumes_and_the_sales_manager_minds_the_prices(): void
    {
        $this->makeUser('Sara', 'sara', 'sales_manager', '4242');
        $this->makeUser('Kamal', 'kamal', 'catalogue_manager', '4343');
        $khamrah = $this->variantOf('Khamrah');

        $this->auth = $this->passwordSession('kamal');
        $this->api('GET', 'catalogue/prices/'.$this->turkeyId)->assertStatus(403)->assertJsonPath('error.params.permission', 'catalogue.prices');
        $this->api('PUT', 'catalogue/rules', ['scope' => 'global', 'minQty' => 6])->assertStatus(403)->assertJsonPath('error.params.permission', 'catalogue.rules');

        $this->auth = $this->passwordSession('sara');
        $this->api('GET', 'catalogue/prices/'.$this->turkeyId)->assertOk();
        $this->api('PUT', 'catalogue/prices/'.$this->turkeyId, ['prices' => [$khamrah->id => 2200]])->assertOk()->assertJsonPath('changed', 1);
        $this->api('PUT', 'catalogue/rules', ['scope' => 'global', 'minQty' => 6, 'qtyIncrement' => 6])->assertOk();
    }

    public function test_the_price_grid_reads_a_to_z(): void
    {
        $names = array_column($this->api('GET', 'catalogue/prices/'.$this->turkeyId)->assertOk()->json('rows'), 'name');
        $sorted = $names;
        sort($sorted, SORT_NATURAL | SORT_FLAG_CASE);

        $this->assertSame($sorted, $names, 'the grid should read A–Z, not Z–A');
    }

    public function test_a_countrys_price_grid_shows_what_is_still_missing(): void
    {
        $khamrah = $this->variantOf('Khamrah');
        $this->setCountryPrice($khamrah, 2400);

        $all = $this->api('GET', 'catalogue/prices/'.$this->turkeyId)->assertOk()->json('rows');
        $missing = $this->api('GET', 'catalogue/prices/'.$this->turkeyId, ['missing' => true])->assertOk()->json('rows');

        $priced = collect($all)->firstWhere('variantId', $khamrah->id);
        $this->assertSame(2400, $priced['priceCents']);
        $this->assertSame(2400, $priced['effectiveCents']);
        $this->assertLessThan(count($all), count($missing));
        $this->assertNull(collect($missing)->firstWhere('variantId', $khamrah->id), 'a priced size is not missing a price');
        foreach ($missing as $row) {
            $this->assertNull($row['effectiveCents']);
        }
    }

    private function passwordSession(string $username): array
    {
        $res = $this->api('POST', 'auth/login', ['username' => $username, 'password' => 'Passw0rd!x', 'app' => 'admin'], [])->assertOk();

        return ['Authorization' => 'Bearer '.$res->json('token')];
    }
}
