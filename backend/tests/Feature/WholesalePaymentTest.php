<?php

namespace Tests\Feature;

use App\Models\Variant;
use App\Models\WholesaleOrder;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\ApiTestCase;

/**
 * Money against an order, and the thing the brief is most careful about: payment and approval are two separate
 * tracks. Neither writes the other, and **no stock ever moves because money arrived**.
 */
class WholesalePaymentTest extends ApiTestCase
{
    private string $orderId;

    private Variant $khamrah;

    protected function setUp(): void
    {
        parent::setUp();
        $this->shop();

        $turkey = $this->api('POST', 'catalogue/countries', ['iso2' => 'TR', 'name' => ['en' => 'Türkiye'], 'language' => 'en', 'enabled' => true])
            ->assertCreated()->json('country.id');
        $customer = $this->api('POST', 'catalogue/customers', ['businessName' => 'Istanbul Perfumes', 'countryId' => $turkey])
            ->assertCreated()->json('customer.id');

        $this->khamrah = $this->variantOf('Khamrah');
        $this->api('POST', 'stock/adjust', ['variantId' => $this->khamrah->id, 'newQty' => 100, 'reason' => 'adjustment'])->assertOk();
        $this->api('PUT', 'catalogue/prices/'.$turkey, ['prices' => [$this->khamrah->id => 2000]])->assertOk();

        $code = $this->api('POST', 'catalogue/customers/'.$customer.'/codes')->assertCreated()->json('plain');
        $token = $this->postJson('/api/v1/wholesale/unlock', ['code' => $code, 'country' => 'TR'])->assertOk()->json('token');

        $this->app['auth']->forgetGuards();
        $this->orderId = $this->withHeaders(['Authorization' => 'Bearer '.$token, 'Accept' => 'application/json'])
            ->postJson('/api/v1/wholesale/orders', [
                'lines' => [['variantId' => $this->khamrah->id, 'qty' => 10]],     // $200.00
                'businessName' => 'Istanbul Perfumes',
            ])->assertCreated()->json('order.id');
    }

    private function pay(int $cents, array $over = [])
    {
        return $this->api('POST', 'catalogue/orders/'.$this->orderId.'/payments', $over + [
            'method' => 'bank_transfer', 'amountCents' => $cents, 'reference' => 'TR-9912',
        ]);
    }

    private function order(): array
    {
        return $this->api('GET', 'catalogue/orders/'.$this->orderId)->assertOk()->json('order');
    }

    // ───────────────────────── taking money ─────────────────────────

    public function test_an_order_starts_unpaid(): void
    {
        $order = $this->order();
        $this->assertSame('unpaid', $order['paymentStatus']);
        $this->assertSame(0, $order['paidCents']);
        $this->assertSame(20000, $order['subtotalCents']);
    }

    public function test_a_part_payment_is_a_part_payment_and_the_rest_settles_it(): void
    {
        $this->pay(5000)->assertCreated();
        $this->assertSame(['partial', 5000], [$this->order()['paymentStatus'], $this->order()['paidCents']]);

        $this->pay(15000)->assertCreated();
        $this->assertSame(['paid', 20000], [$this->order()['paymentStatus'], $this->order()['paidCents']]);
    }

    public function test_money_the_shop_has_not_confirmed_yet_is_not_money_in(): void
    {
        $this->pay(20000, ['status' => 'pending'])->assertCreated();

        $order = $this->order();
        $this->assertSame('pending', $order['paymentStatus']);
        $this->assertSame(0, $order['paidCents'], 'nothing is counted until it is confirmed');
    }

    public function test_confirming_a_pending_payment_settles_the_order(): void
    {
        $paymentId = $this->pay(20000, ['status' => 'pending'])->assertCreated()->json('payment.id');

        $this->api('PATCH', 'catalogue/payments/'.$paymentId, ['status' => 'confirmed'])->assertOk();

        $this->assertSame(['paid', 20000], [$this->order()['paymentStatus'], $this->order()['paidCents']]);
    }

    public function test_a_refund_takes_the_money_back_out(): void
    {
        $paymentId = $this->pay(20000)->assertCreated()->json('payment.id');
        $this->assertSame('paid', $this->order()['paymentStatus']);

        $this->api('PATCH', 'catalogue/payments/'.$paymentId, ['status' => 'refunded'])->assertOk();

        $order = $this->order();
        $this->assertSame('refunded', $order['paymentStatus']);
        $this->assertSame(0, $order['paidCents']);
    }

    public function test_a_payment_recorded_by_mistake_can_be_taken_off_again(): void
    {
        $paymentId = $this->pay(20000)->assertCreated()->json('payment.id');
        $this->api('DELETE', 'catalogue/payments/'.$paymentId)->assertOk();

        $this->assertSame(['unpaid', 0], [$this->order()['paymentStatus'], $this->order()['paidCents']]);
    }

    public function test_the_payment_keeps_its_reference_and_who_recorded_it(): void
    {
        $payment = $this->pay(20000, ['note' => 'Ziraat, same day'])->assertCreated()->json('payment');

        $this->assertSame('bank_transfer', $payment['method']);
        $this->assertSame('TR-9912', $payment['reference']);
        $this->assertSame('Ziraat, same day', $payment['note']);
        $this->assertSame('Owner', $payment['byName']);
    }

    // ───────────────────────── the two tracks never touch ─────────────────────────

    public function test_paying_for_an_order_moves_no_stock_and_does_not_approve_it(): void
    {
        $before = $this->stockOf($this->khamrah);

        $this->pay(20000)->assertCreated();

        $order = $this->order();
        $this->assertSame('paid', $order['paymentStatus']);
        $this->assertSame('pending_approval', $order['status'], 'money is not approval');
        $this->assertSame($before, $this->stockOf($this->khamrah), 'and nothing came off the shelf');
    }

    public function test_approving_an_order_does_not_pretend_it_was_paid(): void
    {
        $this->api('POST', 'catalogue/orders/'.$this->orderId.'/approve')->assertOk();

        $order = $this->order();
        $this->assertSame('approved', $order['status']);
        $this->assertSame('unpaid', $order['paymentStatus'], 'approved and unpaid is a perfectly ordinary thing');
    }

    public function test_an_order_can_be_paid_and_still_refused(): void
    {
        $this->pay(20000)->assertCreated();
        $this->api('POST', 'catalogue/orders/'.$this->orderId.'/reject', ['reason' => 'out of stock upstream'])->assertOk();

        $order = $this->order();
        $this->assertSame('rejected', $order['status']);
        $this->assertSame('paid', $order['paymentStatus'], 'the money is still recorded — what to do about it is the shop’s call');
    }

    // ───────────────────────── what is not built ─────────────────────────

    public function test_card_payment_is_refused_rather_than_faked(): void
    {
        $this->api('POST', 'catalogue/orders/'.$this->orderId.'/payments', ['method' => 'online', 'amountCents' => 20000])
            ->assertStatus(422);

        $this->assertSame('unpaid', $this->order()['paymentStatus']);
    }

    public function test_the_same_notification_from_a_provider_can_only_ever_be_stored_once(): void
    {
        // no provider is connected; this is the guard that will make one safe when it is
        $row = fn () => [
            'id' => (string) Str::uuid(), 'provider' => 'some-gateway', 'external_id' => 'evt_123',
            'payload' => json_encode(['amount' => 20000]), 'received_at' => 1, 'created_at' => now(), 'updated_at' => now(),
        ];

        DB::table('wholesale_payment_events')->insert($row());
        $this->expectException(QueryException::class);
        DB::table('wholesale_payment_events')->insert($row());
    }

    // ───────────────────────── who may touch the money ─────────────────────────

    public function test_only_someone_who_may_handle_payments_can_record_one(): void
    {
        $this->makeUser('Kamal', 'kamal', 'catalogue_manager', '4343');
        $owner = $this->auth;

        $res = $this->api('POST', 'auth/login', ['username' => 'kamal', 'password' => 'Passw0rd!x', 'app' => 'admin'], [])->assertOk();
        $this->auth = ['Authorization' => 'Bearer '.$res->json('token')];

        $this->pay(20000)->assertStatus(403)->assertJsonPath('error.params.permission', 'catalogue.payments');

        $this->auth = $owner;
        $this->assertSame('unpaid', $this->order()['paymentStatus']);
    }

    public function test_a_buyer_can_never_record_a_payment_against_their_own_order(): void
    {
        $order = WholesaleOrder::findOrFail($this->orderId);
        $this->app['auth']->forgetGuards();

        $this->withHeaders(['Accept' => 'application/json'])
            ->postJson('/api/v1/catalogue/orders/'.$order->id.'/payments', ['method' => 'cash', 'amountCents' => 20000])
            ->assertStatus(401);
    }
}
