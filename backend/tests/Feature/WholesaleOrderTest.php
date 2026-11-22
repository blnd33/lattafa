<?php

namespace Tests\Feature;

use App\Models\CatalogueCountry;
use App\Models\Variant;
use App\Models\WholesaleOrder;
use Illuminate\Support\Facades\DB;
use Tests\ApiTestCase;

/**
 * Orders, the stock they hold, and the shop's decision — §44 Scenarios 6 to 10.
 *
 * This is the file where getting it wrong costs the shop real bottles, so it is deliberately suspicious: it
 * checks that stock cannot be held twice, cannot be taken twice, comes back when an order is refused, and never
 * goes anywhere because time passed.
 */
class WholesaleOrderTest extends ApiTestCase
{
    private string $turkeyId;

    private string $customerId;

    private string $token;

    private Variant $khamrah;

    protected function setUp(): void
    {
        parent::setUp();
        $this->shop();

        $this->api('PUT', 'catalogue/languages', ['code' => 'tr', 'enabled' => true])->assertOk();
        $this->turkeyId = $this->api('POST', 'catalogue/countries', [
            'iso2' => 'TR', 'name' => ['en' => 'Türkiye'], 'language' => 'tr', 'enabled' => true,
        ])->assertCreated()->json('country.id');

        $this->customerId = $this->api('POST', 'catalogue/customers', [
            'businessName' => 'Istanbul Perfumes', 'countryId' => $this->turkeyId, 'whatsapp' => '+90 555 000 0000',
        ])->assertCreated()->json('customer.id');

        $this->khamrah = $this->variantOf('Khamrah');
        $this->api('POST', 'stock/adjust', ['variantId' => $this->khamrah->id, 'newQty' => 100, 'reason' => 'adjustment'])->assertOk();
        $this->api('PUT', 'catalogue/prices/'.$this->turkeyId, ['prices' => [$this->khamrah->id => 2000]])->assertOk();

        $this->token = $this->unlock($this->customerId);
    }

    private function unlock(string $customerId): string
    {
        $code = $this->api('POST', 'catalogue/customers/'.$customerId.'/codes')->assertCreated()->json('plain');

        return $this->postJson('/api/v1/wholesale/unlock', ['code' => $code, 'country' => 'TR'])->assertOk()->json('token');
    }

    private function buyer(?string $token = null): self
    {
        $this->app['auth']->forgetGuards();   // see WholesaleAccessTest::buyer()

        return $this->withHeaders(['Authorization' => 'Bearer '.($token ?? $this->token), 'Accept' => 'application/json']);
    }

    /** @param array<string, string> $headers */
    private function place(int $qty = 10, array $over = [], array $headers = [], ?string $token = null)
    {
        return $this->buyer($token)->withHeaders($headers)->postJson('/api/v1/wholesale/orders', $over + [
            'lines' => [['variantId' => $this->khamrah->id, 'qty' => $qty]],
            'businessName' => 'Istanbul Perfumes',
            'contactPerson' => 'Mert',
        ])
        ;
    }

    // ───────────────────────── §44 Scenario 7 — a direct order ─────────────────────────

    public function test_an_order_is_written_and_the_shop_shelf_is_not_touched(): void
    {
        $before = $this->stockOf($this->khamrah);

        $res = $this->place(10)->assertCreated();

        $this->assertSame('pending_approval', $res->json('order.status'));
        $this->assertMatchesRegularExpression('/^LAT-\d+$/', $res->json('order.number'));
        $this->assertSame(20000, $res->json('order.subtotalCents'));    // 10 × $20.00
        $this->assertSame(10, $res->json('order.units'));

        // nothing is held and nothing is taken: the catalogue is its own channel
        $this->assertSame($before, $this->stockOf($this->khamrah));
        $this->assertSame(0, \DB::table('stock_movements')->where('ref_type', 'wholesale_order')->count());
    }

    public function test_a_buyer_can_order_far_more_than_the_shop_holds(): void
    {
        $this->api('POST', 'stock/adjust', ['variantId' => $this->khamrah->id, 'newQty' => 12, 'reason' => 'adjustment'])->assertOk();

        // 12 on the shelf and two orders of 500: both are taken, because the shop decides, not the shelf
        $this->place(500)->assertCreated();
        $this->place(500)->assertCreated();

        $this->assertSame(2, WholesaleOrder::count());
        $this->assertSame(12, $this->stockOf($this->khamrah), 'and the shelf is exactly where it was');
    }


    public function test_the_basket_is_priced_and_checked_again_on_the_server(): void
    {
        $this->api('PUT', 'catalogue/countries/'.$this->turkeyId, [
            'iso2' => 'TR', 'name' => ['en' => 'Türkiye'], 'language' => 'tr', 'enabled' => true, 'minOrderCents' => 50000,
        ])->assertOk();

        // $200.00 is well under Türkiye's $500.00 minimum, whatever the browser thought
        $this->place(10)->assertStatus(422)->assertJsonPath('error.code', 'min_order');
        $this->assertSame(0, WholesaleOrder::count());
    }

    public function test_the_price_on_an_order_is_the_price_that_was_agreed_that_day(): void
    {
        $this->place(10)->assertCreated();

        // the shop puts its prices up afterwards
        $this->api('PUT', 'catalogue/prices/'.$this->turkeyId, ['prices' => [$this->khamrah->id => 3000]])->assertOk();

        $order = $this->api('GET', 'catalogue/orders')->assertOk()->json('orders.0');
        $this->assertSame(2000, $order['items'][0]['unitCents'], 'what was agreed does not change under the buyer');
        $this->assertSame(20000, $order['subtotalCents']);
    }

    // ───────────────────────── §44 Scenario 6 — WhatsApp ─────────────────────────

    public function test_a_whatsapp_order_is_a_real_order_before_whatsapp_is_opened(): void
    {
        $res = $this->place(10, ['method' => 'whatsapp'])->assertCreated();

        $this->assertSame('whatsapp', $res->json('order.method'));
        $this->assertSame('pending_approval', $res->json('order.status'));
        $this->assertNull($res->json('order.whatsappOpenedAt'));

        $message = $res->json('whatsapp');
        $this->assertStringContainsString('LATTAFA WHOLESALE ORDER', $message);
        $this->assertStringContainsString($res->json('order.number'), $message);
        $this->assertStringContainsString('Istanbul Perfumes', $message);
        $this->assertStringContainsString('10 × $20.00 = $200.00', $message);
        $this->assertStringContainsString('Total: $200.00', $message);
    }

    public function test_opening_whatsapp_is_recorded_apart_and_never_makes_a_second_order(): void
    {
        $reference = $this->place(10, ['method' => 'whatsapp'])->assertCreated()->json('order.reference');

        $first = $this->buyer()->postJson("/api/v1/wholesale/orders/$reference/whatsapp-opened")->assertOk();
        $this->assertNotNull($first->json('order.whatsappOpenedAt'));

        // opened again, and again: still one order
        $this->buyer()->postJson("/api/v1/wholesale/orders/$reference/whatsapp-opened")->assertOk();
        $this->buyer()->postJson("/api/v1/wholesale/orders/$reference/whatsapp-opened")->assertOk();

        $this->assertSame(1, WholesaleOrder::count());
    }

    public function test_the_same_checkout_sent_twice_is_one_order(): void
    {
        $key = ['Idempotency-Key' => 'checkout-abc-123'];

        $first = $this->place(10, [], $key)->assertCreated()->json('order.id');
        $second = $this->place(10, [], $key)->assertCreated()->json('order.id');

        $this->assertSame($first, $second);
        $this->assertSame(1, WholesaleOrder::count());
        $this->assertSame(1, WholesaleOrder::first()->items()->count(), 'one order with one line, not two of either');
    }

    // ───────────────────────── §44 Scenario 8 — approval ─────────────────────────

    public function test_approving_moves_no_stock_at_all(): void
    {
        $before = $this->stockOf($this->khamrah);
        $id = $this->place(10)->assertCreated()->json('order.id');

        $this->api('POST', 'catalogue/orders/'.$id.'/approve')->assertOk()->assertJsonPath('order.status', 'approved');

        // accepting the order is a decision; the bottles are ordered or shipped however the owner arranges it
        $this->assertSame($before, $this->stockOf($this->khamrah));
        $this->assertSame(0, \DB::table('stock_movements')->where('ref_id', $id)->count());
    }

    public function test_approving_the_same_order_again_changes_nothing(): void
    {
        $before = $this->stockOf($this->khamrah);
        $id = $this->place(10)->assertCreated()->json('order.id');

        $this->api('POST', 'catalogue/orders/'.$id.'/approve')->assertOk();
        $this->api('POST', 'catalogue/orders/'.$id.'/approve')->assertOk()->assertJsonPath('order.status', 'approved');
        $this->api('POST', 'catalogue/orders/'.$id.'/approve')->assertOk();

        $this->assertSame($before, $this->stockOf($this->khamrah));
        $this->assertSame(1, WholesaleOrder::where('status', 'approved')->count(), 'still one approved order, not three');
    }

    public function test_an_approved_order_counts_towards_what_the_business_has_bought(): void
    {
        $id = $this->place(10)->assertCreated()->json('order.id');
        $this->api('POST', 'catalogue/orders/'.$id.'/approve')->assertOk();

        $customer = $this->api('GET', 'catalogue/customers/'.$this->customerId)->assertOk()->json('customer');
        $this->assertSame(1, $customer['ordersCount']);
        $this->assertSame(20000, $customer['ordersValueCents']);
    }

    // ───────────────────────── §44 Scenario 9 — refusal ─────────────────────────

    public function test_refusing_an_order_leaves_the_shelf_exactly_as_it_was(): void
    {
        $before = $this->stockOf($this->khamrah);
        $id = $this->place(10)->assertCreated()->json('order.id');

        $this->api('POST', 'catalogue/orders/'.$id.'/reject', ['reason' => 'Shipping to Türkiye is paused'])
            ->assertOk()->assertJsonPath('order.status', 'rejected');

        // there was nothing to give back, because nothing was ever taken or held
        $this->assertSame($before, $this->stockOf($this->khamrah));
    }

    public function test_cancelling_does_the_same_and_an_approved_order_cannot_be_cancelled(): void
    {
        $id = $this->place(10)->assertCreated()->json('order.id');
        $this->api('POST', 'catalogue/orders/'.$id.'/cancel')->assertOk()->assertJsonPath('order.status', 'cancelled');

        $other = $this->place(5)->assertCreated()->json('order.id');
        $this->api('POST', 'catalogue/orders/'.$other.'/approve')->assertOk();
        $this->api('POST', 'catalogue/orders/'.$other.'/cancel')
            ->assertStatus(422)->assertJsonPath('error.code', 'order_already_approved');
    }


    // ───────────────────────── §44 Scenario 10 — nothing expires ─────────────────────────

    public function test_an_order_nobody_looked_at_is_still_waiting_weeks_later(): void
    {
        $id = $this->place(10)->assertCreated()->json('order.id');

        // placed three weeks ago and nobody has looked at it
        WholesaleOrder::whereKey($id)->update(['placed_at' => now()->subWeeks(3)->getTimestampMs()]);

        // reading the catalogue, pricing a basket, listing orders — none of it decides anything
        $this->buyer()->getJson('/api/v1/wholesale/prices')->assertOk();
        $this->getJson('/api/v1/wholesale/products')->assertOk();
        $this->api('GET', 'catalogue/orders')->assertOk();

        $this->assertSame('pending_approval', WholesaleOrder::findOrFail($id)->status, 'only a person decides');
    }

    // ───────────────────────── what a buyer may see ─────────────────────────

    public function test_a_buyer_sees_their_own_orders_and_cannot_reach_another_business_order(): void
    {
        $mine = $this->place(10)->assertCreated()->json('order.reference');

        $other = $this->api('POST', 'catalogue/customers', ['businessName' => 'Ankara Scents', 'countryId' => $this->turkeyId])->assertCreated()->json('customer.id');
        $theirToken = $this->unlock($other);
        $this->api('PUT', 'catalogue/prices/'.$this->turkeyId, ['prices' => [$this->khamrah->id => 2000]])->assertOk();
        $theirs = $this->place(5, [], [], $theirToken)->assertCreated()->json('order.reference');

        $mineList = $this->buyer()->getJson('/api/v1/wholesale/orders')->assertOk()->json('orders');
        $this->assertCount(1, $mineList);
        $this->assertSame($mine, $mineList[0]['reference']);

        // their reference, my token: not found rather than forbidden — I should not learn it exists
        $this->buyer()->getJson("/api/v1/wholesale/orders/$theirs")->assertStatus(404);
    }

    public function test_an_order_carries_none_of_the_shops_own_notes_to_the_buyer(): void
    {
        $reference = $this->place(10)->assertCreated()->json('order.reference');
        $order = WholesaleOrder::firstOrFail();
        $order->update(['admin_note' => 'this shop pays late']);

        $body = $this->buyer()->getJson("/api/v1/wholesale/orders/$reference")->assertOk()->getContent();

        $this->assertStringNotContainsString('pays late', $body);
        $this->assertStringNotContainsString('adminNote', $body);
        $this->assertStringNotContainsString('reservation', $body);
    }

    public function test_a_business_put_on_hold_cannot_send_an_order(): void
    {
        $this->api('PATCH', 'catalogue/customers/'.$this->customerId.'/status', ['status' => 'suspended'])->assertOk();

        $this->place(10)->assertStatus(401);   // its session was closed the moment it was suspended
    }

    public function test_only_someone_who_may_handle_orders_can_decide_on_one(): void
    {
        $id = $this->place(10)->assertCreated()->json('order.id');
        $this->makeUser('Kamal', 'kamal', 'catalogue_manager', '4343');

        $owner = $this->auth;
        $res = $this->api('POST', 'auth/login', ['username' => 'kamal', 'password' => 'Passw0rd!x', 'app' => 'admin'], [])->assertOk();
        $this->auth = ['Authorization' => 'Bearer '.$res->json('token')];

        $this->api('POST', 'catalogue/orders/'.$id.'/approve')->assertStatus(403)->assertJsonPath('error.params.permission', 'catalogue.orders');
        $this->assertSame('pending_approval', WholesaleOrder::findOrFail($id)->status, 'and it is still waiting');

        $this->auth = $owner;
    }

    public function test_every_move_an_order_made_is_kept(): void
    {
        $id = $this->place(10)->assertCreated()->json('order.id');
        $this->api('POST', 'catalogue/orders/'.$id.'/reject', ['reason' => 'out of season'])->assertOk();

        $history = $this->api('GET', 'catalogue/orders/'.$id)->assertOk()->json('order.history');
        $this->assertSame(['', 'pending_approval'], [$history[0]['from'], $history[0]['to']]);
        $this->assertSame(['pending_approval', 'rejected'], [$history[1]['from'], $history[1]['to']]);
        $this->assertSame('out of season', $history[1]['reason']);
        $this->assertSame('Owner', $history[1]['byName']);
    }

    public function test_a_country_can_be_told_apart_on_an_order(): void
    {
        $this->place(10)->assertCreated();
        $order = $this->api('GET', 'catalogue/orders', ['countryId' => $this->turkeyId])->assertOk()->json('orders');
        $this->assertCount(1, $order);
        $this->assertSame('TR', $order[0]['country']['iso2']);

        $iraq = CatalogueCountry::where('iso2', 'IQ')->firstOrFail();
        $this->assertSame([], $this->api('GET', 'catalogue/orders', ['countryId' => $iraq->id])->assertOk()->json('orders'));
    }

    /**
     * A business that has traded is closed, not deleted.
     *
     * Its orders are commercial records, one of them may be holding stock off the shelf this minute, and the
     * payments and status history hang off them. The owner is told why, by name, rather than meeting a database
     * error — the schema refuses it too (`restrictOnDelete`), but that is the net, not the message.
     */
    public function test_a_business_that_has_ordered_cannot_be_removed(): void
    {
        $this->place(10)->assertCreated();

        $this->api('DELETE', 'catalogue/customers/'.$this->customerId)
            ->assertStatus(422)
            ->assertJsonPath('error.code', 'customer_has_orders')
            ->assertJsonPath('error.params.orders', 1);

        $this->assertDatabaseHas('wholesale_customers', ['id' => $this->customerId]);
        $this->assertSame(1, WholesaleOrder::where('customer_id', $this->customerId)->count(), 'and the order is untouched');

        // closing it is the way: it stops buying, and every figure stays where it is
        $this->api('PATCH', 'catalogue/customers/'.$this->customerId.'/status', ['status' => 'closed'])->assertOk();
        $this->assertSame(1, WholesaleOrder::where('customer_id', $this->customerId)->count());
    }
}
