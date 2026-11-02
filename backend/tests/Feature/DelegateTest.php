<?php

namespace Tests\Feature;

use App\Models\Customer;
use App\Models\Sale;
use App\Models\Variant;
use App\Services\SaleService;
use Illuminate\Support\Str;
use Tests\ApiTestCase;

/** Field sales: delegates sell the shop's stock (in dollars or dinars, with where), visits, the daily closing — and the older van tools. */
class DelegateTest extends ApiTestCase
{
    private function van(string $delegateId, Variant $v): int
    {
        return (int) \DB::table('stock')->where('variant_id', $v->id)->where('location_id', 'van:'.$delegateId)->value('qty');
    }

    /** A delegate account; the session stays as the owner. */
    private function delegate(string $pin = '5151', string $username = 'ahmed', string $name = 'Ahmed'): string
    {
        return $this->makeUser($name, $username, 'delegate', $pin);
    }

    private function asDelegate(string $id, string $pin = '5151'): void
    {
        $res = $this->api('POST', 'auth/pin-login', ['userId' => $id, 'pin' => $pin, 'app' => 'delegate'], [])->assertOk();
        $this->auth = ['Authorization' => 'Bearer '.$res->json('token')];
    }

    /** A sale exactly as the delegate app stores it. */
    private function delegateSale(string $uid, Variant $v, int $qty, int $unit, array $over = []): array
    {
        $total = $unit * $qty;

        return $over + [
            'id' => (string) Str::uuid(), 'number' => 'DL1-'.str_pad((string) random_int(1, 999999), 6, '0', STR_PAD_LEFT), 'shiftId' => null, 'userId' => $uid, 'userName' => 'Ahmed',
            'customerId' => null, 'customerName' => '', 'channel' => 'delegate', 'status' => 'completed',
            'items' => [['variantId' => $v->id, 'productId' => $v->product_id, 'name' => $v->product->name, 'brand' => 'Lattafa', 'label' => $v->label, 'sku' => $v->sku, 'barcode' => $v->barcode,
                'qty' => $qty, 'unitPriceIQD' => $unit, 'unitCostIQD' => 0, 'discountPct' => 0, 'discountIQD' => 0, 'lineTotalIQD' => $total, 'returnedQty' => 0]],
            'subtotalIQD' => $total, 'itemDiscountIQD' => 0, 'orderDiscountIQD' => 0, 'orderDiscount' => null, 'giftWrapIQD' => 0, 'taxIQD' => 0, 'roundingIQD' => 0, 'pointsRedeemedIQD' => 0,
            'totalIQD' => $total, 'payments' => [['method' => 'cash_iqd', 'amountIQD' => $total, 'tendered' => $total, 'currency' => 'IQD', 'rate' => 1460, 'reference' => '']],
            'paidIQD' => $total, 'changeIQD' => 0, 'dueIQD' => 0, 'pointsEarned' => 0, 'pointsRedeemed' => 0, 'exchangeRate' => 1460, 'note' => '', 'approvedBy' => null,
            'deviceId' => $this->deviceId, 'createdAt' => (int) (microtime(true) * 1000), 'voidedAt' => null, 'voidReason' => '',
        ];
    }

    private function push(array $items): array
    {
        return $this->api('POST', 'sync/push', ['items' => $items])->assertOk()->json('results');
    }

    public function test_delegates_sign_in_to_the_delegate_app_only(): void
    {
        $this->shop();
        $id = $this->delegate();
        $this->makeUser('Ali', 'alii', 'cashier', '3333');
        $tiles = collect($this->api('GET', 'auth/login-users?app=delegate', [], [])->json('users'))->pluck('name')->all();
        $this->assertSame(['Ahmed'], $tiles);
        $this->api('POST', 'auth/pin-login', ['userId' => $id, 'pin' => '5151'], [])->assertStatus(403)->assertJsonPath('error.code', 'app_not_allowed'); // POS
        $this->asDelegate($id);
        $this->assertContains('delegate.sell', $this->api('GET', 'auth/me')->json('user.permissions'));
    }

    public function test_the_super_admin_binds_a_phone_and_it_gets_a_delegate_code(): void
    {
        $this->shop();
        $phone = (string) Str::uuid();
        $r = $this->withHeaders(['X-Device-Id' => $phone])->postJson('/api/v1/auth/login', ['username' => 'owner', 'password' => 'Owner1234', 'app' => 'delegate', 'deviceName' => "Ahmed's phone"])->assertOk();
        $this->assertSame('DL1', $r->json('device.code'));
    }

    public function test_loading_and_unloading_a_van_moves_stock_between_shop_and_van(): void
    {
        $this->shop();
        $id = $this->delegate();
        $v = $this->variantOf('Khamrah'); // 14 in the shop
        $this->api('POST', "delegates/$id/load", ['items' => [['variantId' => $v->id, 'qty' => 5]], 'note' => 'morning load'])->assertOk()->assertJsonPath('units', 5);
        $this->assertSame(9, $this->stockOf($v));
        $this->assertSame(5, $this->van($id, $v));
        $this->api('POST', "delegates/$id/load", ['items' => [['variantId' => $v->id, 'qty' => 50]]])->assertStatus(422)->assertJsonPath('error.code', 'insufficient_stock');

        $row = collect($this->api('GET', 'delegates')->assertOk()->json('delegates'))->firstWhere('id', $id);
        $this->assertSame(5, $row['vanUnits']);
        $this->assertSame(5 * $v->wholesale_iqd, $row['vanValueIQD']);
        $this->assertSame(5, $this->api('GET', "delegates/$id/van")->json('items.0.qty'));

        $this->api('POST', "delegates/$id/unload", ['items' => [['variantId' => $v->id, 'qty' => 2]]])->assertOk();
        $this->assertSame([11, 3], [$this->stockOf($v), $this->van($id, $v)]);
        $this->api('POST', "delegates/$id/unload", ['items' => [['variantId' => $v->id, 'qty' => 9]]])->assertStatus(422);
        $types = \App\Models\StockMovement::where('variant_id', $v->id)->pluck('type')->unique()->values()->all();
        $this->assertEqualsCanonicalizing(['opening', 'transfer_out', 'transfer_in'], $types);
    }

    public function test_only_managers_load_vans_and_a_delegate_sees_only_their_own(): void
    {
        $this->shop();
        $a = $this->delegate();
        $b = $this->delegate('5252', 'sara', 'Sara');
        $v = $this->variantOf('Khamrah');
        $this->asDelegate($a);
        $this->api('POST', "delegates/$a/load", ['items' => [['variantId' => $v->id, 'qty' => 1]]])->assertStatus(403);
        $this->api('GET', "delegates/$a/van")->assertOk();
        $this->api('GET', "delegates/$b/van")->assertStatus(403);
        $this->api('GET', 'delegates')->assertStatus(403);
    }

    public function test_a_delegate_sale_comes_out_of_the_shops_stock_at_wholesale_price(): void
    {
        $this->shop();
        $id = $this->delegate();
        $v = $this->variantOf('Khamrah'); // 14 in the shop
        $this->asDelegate($id);

        $sale = $this->delegateSale($id, $v, 3, $v->wholesale_iqd);
        $r = $this->push([['entity' => 'sale', 'id' => $sale['id'], 'data' => $sale]]);
        $this->assertSame(['ok', []], [$r[0]['status'], $r[0]['flags']]); // wholesale is a valid list price for a delegate
        $this->assertSame(11, $this->stockOf($v));
        $stored = Sale::find($sale['id']);
        $this->assertSame(['delegate', 'loc-store', 'IQD'], [$stored->channel, $stored->location_id, $stored->currency]);

        // more than the shop has: still recorded (it was sold), flagged for a manager
        $over = $this->delegateSale($id, $v, 12, $v->wholesale_iqd);
        $r = $this->push([['entity' => 'sale', 'id' => $over['id'], 'data' => $over]]);
        $this->assertContains('negative_stock', $r[0]['flags']);
        $this->assertSame(-1, $this->stockOf($v));

        // voiding it puts the bottles back on the shop's shelf
        $this->asOwner();
        $this->api('POST', "sales/{$over['id']}/void", ['reason' => 'wrong customer'])->assertOk();
        $this->assertSame(11, $this->stockOf($v));
    }

    public function test_a_dollar_bill_uses_dollar_prices_and_keeps_where_it_was_sold(): void
    {
        $this->shop();
        $id = $this->delegate();
        $v = $this->variantOf('Khamrah');
        $noor = $this->customerNamed('Al-Noor Perfumes');
        $this->asDelegate($id);

        // 36,000 IQD at 1,460 is $24.66 → $24.50 a bottle (35,770): two are $49
        $usd = $this->delegateSale($id, $v, 2, 35770, ['customerId' => $noor->id, 'currency' => 'USD', 'note' => 'Zakho, main market',
            'lat' => 37.1436, 'lng' => 42.6819, 'accuracyM' => 12,
            'payments' => [['method' => 'cash_usd', 'amountIQD' => 71540, 'tendered' => 49, 'currency' => 'USD', 'rate' => 1460, 'reference' => '']]]);
        $r = $this->push([['entity' => 'sale', 'id' => $usd['id'], 'data' => $usd]]);
        $this->assertSame(['ok', []], [$r[0]['status'], $r[0]['flags']]); // a dollar list price is not a price mismatch
        $stored = Sale::find($usd['id']);
        $this->assertSame('USD', $stored->currency);
        $this->assertEqualsWithDelta(37.1436, (float) $stored->lat, 0.00001);
        $this->asOwner();
        $shown = $this->api('GET', "sales/{$usd['id']}")->assertOk()->json('sale');
        $this->assertSame(['USD', 12], [$shown['currency'], $shown['accuracyM']]);
        $this->assertEqualsWithDelta(42.6819, $shown['lng'], 0.00001);

        // a made-up price is flagged; an impossible spot is dropped, the sale is kept
        $this->asDelegate($id);
        $odd = $this->delegateSale($id, $v, 1, 30000, ['lat' => 0, 'lng' => 0]);
        $bad = $this->delegateSale($id, $v, 1, $v->wholesale_iqd, ['lat' => 95.5, 'lng' => 42.6]);
        $r = $this->push([['entity' => 'sale', 'id' => $odd['id'], 'data' => $odd], ['entity' => 'sale', 'id' => $bad['id'], 'data' => $bad]]);
        $this->assertContains('price_mismatch', $r[0]['flags']);
        $this->assertSame([null, null], [Sale::find($odd['id'])->lat, Sale::find($bad['id'])->lat]);
    }

    public function test_a_size_with_its_own_dollar_price_sells_at_exactly_that_price(): void
    {
        $this->shop();
        $id = $this->delegate();
        $v = $this->variantOf('Khamrah');
        $v->update(['wholesale_usd_cents' => 2370]); // the shop's dollar price list: $23.70 to shops
        $this->asDelegate($id);

        // $23.70 × 1,460 = 34,602 a bottle — exact to the cent, not nudged to the nearest half dollar
        $sale = $this->delegateSale($id, $v, 2, 34602, ['currency' => 'USD',
            'payments' => [['method' => 'cash_usd', 'amountIQD' => 69204, 'tendered' => 47.4, 'currency' => 'USD', 'rate' => 1460, 'reference' => '']]]);
        $r = $this->push([['entity' => 'sale', 'id' => $sale['id'], 'data' => $sale]]);
        $this->assertSame(['ok', []], [$r[0]['status'], $r[0]['flags']]);

        // the converted price still works for sizes with no dollar price of their own
        $plain = $this->variantOf('Asad');
        $old = $this->delegateSale($id, $plain, 1, SaleService::usdListPrice($plain->wholesale_iqd, 1460), ['currency' => 'USD']);
        $this->assertSame([], $this->push([['entity' => 'sale', 'id' => $old['id'], 'data' => $old]])[0]['flags']);
    }

    public function test_the_delegate_sales_report_shows_what_where_and_for_how_much(): void
    {
        $this->shop();
        $id = $this->delegate();
        $kh = $this->variantOf('Khamrah');
        $noor = $this->customerNamed('Al-Noor Perfumes');
        $noor->update(['lat' => 36.8669, 'lng' => 42.9503]); // the shop's pin
        $this->cashierWithShift();
        $this->checkout($kh, 1, [['method' => 'cash_iqd', 'tendered' => $kh->retail_iqd]])->assertCreated(); // a till sale: not in this report
        $this->asDelegate($id);

        $usd = $this->delegateSale($id, $kh, 2, 35770, ['customerId' => $noor->id, 'currency' => 'USD', 'lat' => 37.1436, 'lng' => 42.6819, 'accuracyM' => 8,
            'payments' => [['method' => 'cash_usd', 'amountIQD' => 71540, 'tendered' => 49, 'currency' => 'USD', 'rate' => 1460, 'reference' => '']]]);
        $debt = $this->delegateSale($id, $kh, 1, 36000, ['customerId' => $noor->id, 'dueIQD' => 36000, 'paidIQD' => 0, 'createdAt' => (int) (microtime(true) * 1000) - 60_000,
            'payments' => [['method' => 'debt', 'amountIQD' => 36000, 'tendered' => 36000, 'currency' => 'IQD', 'rate' => 1460, 'reference' => '']]]);
        $this->push([['entity' => 'sale', 'id' => $usd['id'], 'data' => $usd], ['entity' => 'sale', 'id' => $debt['id'], 'data' => $debt]]);
        $this->api('GET', 'reports/table/delegate-sales')->assertStatus(403); // delegates don't see each other's sales

        $this->asOwner();
        $t = $this->api('GET', 'reports/table/delegate-sales')->assertOk()->json();
        $this->assertCount(2, $t['rows']);
        [$a, $b] = $t['rows']; // newest first
        $this->assertSame(['Ahmed', 'Al-Noor Perfumes', '37.1436,42.6819', 2, 49, 'USD', 71540, 0], [$a['delegate'], $a['soldTo'], $a['place'], $a['units'], $a['amount'], $a['currency'], $a['amountIQD'], $a['debt']]);
        $this->assertSame(['en' => 'Khamrah'], array_intersect_key($a['sold'][0]['name'], ['en' => 1]));
        $this->assertSame([$kh->label, 2], [$a['sold'][0]['label'], $a['sold'][0]['qty']]);
        // no GPS on the bill: the shop's own pin stands in
        $this->assertSame(['36.8669,42.9503', 36000, 'IQD', 36000], [$b['place'], $b['amount'], $b['currency'], $b['debt']]);
        $this->assertSame([3, 107540, 36000], [$t['totals']['units'], $t['totals']['amountIQD'], $t['totals']['debt']]);
        $this->assertEquals(49, collect($t['summary'])->firstWhere('label', 'rc.usd_received')['value']);
        $this->assertSame('map', collect($t['columns'])->firstWhere('key', 'place')['type']);
    }

    public function test_a_store_cashier_cannot_pass_a_sale_off_as_a_delegate_sale(): void
    {
        $this->shop();
        $cashier = $this->makeUser('Ali', 'alii', 'cashier', '3333');
        $v = $this->variantOf('Khamrah');
        $this->asUser($cashier, '3333');
        $sale = $this->delegateSale($cashier, $v, 1, $v->wholesale_iqd);
        $r = $this->push([['entity' => 'sale', 'id' => $sale['id'], 'data' => $sale]]);
        $this->assertContains('not_a_delegate', $r[0]['flags']);
    }

    public function test_stock_requests_are_created_offline_and_fulfilled_by_loading_the_van(): void
    {
        $this->shop();
        $id = $this->delegate();
        $v = $this->variantOf('Asad');
        $this->asDelegate($id);
        $req = ['id' => (string) Str::uuid(), 'userId' => $id, 'items' => [['variantId' => $v->id, 'qty' => 6]], 'note' => 'Zakho shops', 'createdAt' => (int) (microtime(true) * 1000)];
        $this->assertSame('ok', $this->push([['entity' => 'stock_request', 'id' => $req['id'], 'data' => $req]])[0]['status']);
        $this->assertSame('ok', $this->push([['entity' => 'stock_request', 'id' => $req['id'], 'data' => $req]])[0]['status']); // retry: same request
        $this->assertCount(1, $this->api('GET', 'stock-requests')->json('requests'));
        $pull = $this->api('GET', 'sync/pull')->json('van');
        $this->assertSame('open', $pull['requests'][0]['status']);

        $this->asOwner();
        $this->assertSame(1, collect($this->api('GET', 'delegates')->json('delegates'))->firstWhere('id', $id)['openRequests']);
        $this->api('POST', "delegates/$id/load", ['items' => $req['items'], 'requestId' => $req['id']])->assertOk();
        $this->assertSame('fulfilled', $this->api('GET', 'stock-requests')->json('requests.0.status'));
        $this->assertSame(6, $this->van($id, $v));
    }

    public function test_visits_record_gps_and_pin_the_shop_on_the_map(): void
    {
        $this->shop();
        $id = $this->delegate();
        $shop = $this->customerNamed('Rose Gift Gallery');
        $this->asDelegate($id);
        $visit = ['id' => (string) Str::uuid(), 'userId' => $id, 'customerId' => $shop->id, 'lat' => 37.1430, 'lng' => 42.6820, 'accuracyM' => 12, 'outcome' => 'no_sale', 'note' => 'owner away', 'createdAt' => (int) (microtime(true) * 1000)];
        $this->assertSame('ok', $this->push([['entity' => 'visit', 'id' => $visit['id'], 'data' => $visit]])[0]['status']);
        $shop->refresh();
        $this->assertEqualsWithDelta(37.143, $shop->lat, 0.0001);
        $this->assertSame('no_sale', $this->api('GET', 'visits')->json('visits.0.outcome'));
        $this->assertEqualsWithDelta(42.682, collect($this->api('GET', 'customers')->json('customers'))->firstWhere('id', $shop->id)['lng'], 0.0001);
    }

    public function test_the_daily_closing_is_computed_by_the_server_and_approved_by_a_manager(): void
    {
        $this->shop();
        $id = $this->delegate();
        $v = $this->variantOf('Khamrah');
        $noor = $this->customerNamed('Al-Noor Perfumes');
        $this->asDelegate($id);

        $cash = $this->delegateSale($id, $v, 2, 36000);                                  // 72,000 cash
        $credit = $this->delegateSale($id, $v, 1, 36000, ['customerId' => $noor->id, 'dueIQD' => 36000, 'paidIQD' => 0,
            'payments' => [['method' => 'debt', 'amountIQD' => 36000, 'tendered' => 36000, 'currency' => 'IQD', 'rate' => 1460, 'reference' => '']]]);
        $col = ['id' => (string) Str::uuid(), 'customerId' => $noor->id, 'amountIQD' => 50000, 'method' => 'cash_iqd', 'shiftId' => null, 'userId' => $id, 'note' => '', 'createdAt' => (int) (microtime(true) * 1000)];
        $this->push([
            ['entity' => 'sale', 'id' => $cash['id'], 'data' => $cash], ['entity' => 'sale', 'id' => $credit['id'], 'data' => $credit],
            ['entity' => 'collection', 'id' => $col['id'], 'data' => $col],
        ]);

        $f = $this->api('GET', 'delegate-closings/figures')->assertOk()->json('figures');
        // vanUnits: bottles sold that day
        $this->assertSame([2, 108000, 72000, 36000, 50000, 122000, 3], [$f['salesCount'], $f['salesIQD'], $f['cashSalesIQD'], $f['creditSalesIQD'], $f['collectionsIQD'], $f['expectedCashBeforeExpensesIQD'], $f['vanUnits']]);

        $closing = ['id' => (string) Str::uuid(), 'userId' => $id, 'countedCashIQD' => 117000, 'expensesIQD' => 5000, 'note' => 'fuel 5,000', 'createdAt' => (int) (microtime(true) * 1000)];
        $this->assertSame('ok', $this->push([['entity' => 'closing', 'id' => $closing['id'], 'data' => $closing]])[0]['status']);
        $c = $this->api('GET', 'delegate-closings')->json('closings.0');
        $this->assertSame([117000, 117000, 0, 'submitted'], [$c['expectedCashIQD'], $c['countedCashIQD'], $c['varianceIQD'], $c['status']]);

        $this->asOwner();
        $this->assertSame(1, collect($this->api('GET', 'delegates')->json('delegates'))->firstWhere('id', $id)['pendingClosings']);
        $this->api('POST', "delegate-closings/{$c['id']}/reject", [])->assertStatus(422); // a reason is required
        $this->api('POST', "delegate-closings/{$c['id']}/approve", ['note' => 'ok'])->assertOk()->assertJsonPath('closing.status', 'approved');

        // an approved day is final
        $this->asDelegate($id);
        $this->api('POST', 'delegate-closings', ['countedCashIQD' => 1])->assertStatus(422)->assertJsonPath('error.code', 'closing_already_approved');
    }

    public function test_dollars_are_sold_collected_and_counted_on_their_own(): void
    {
        $this->shop();
        $id = $this->delegate();
        $v = $this->variantOf('Khamrah');
        $noor = $this->customerNamed('Al-Noor Perfumes');
        $this->asDelegate($id);

        // a dollar bill: 2 × 36,000 = 72,000 rounded to whole dollars at 1,460 → $49 = 71,540 (rounding −460)
        $usd = $this->delegateSale($id, $v, 2, 36000, ['roundingIQD' => -460, 'totalIQD' => 71540, 'paidIQD' => 71540,
            'payments' => [['method' => 'cash_usd', 'amountIQD' => 71540, 'tendered' => 49, 'currency' => 'USD', 'rate' => 1460, 'reference' => '']]]);
        $iqd = $this->delegateSale($id, $v, 1, 36000); // 36,000 in dinars
        $col = ['id' => (string) Str::uuid(), 'customerId' => $noor->id, 'amountIQD' => 146000, 'method' => 'cash_usd', 'tendered' => 100, 'currency' => 'USD', 'rate' => 1460,
            'shiftId' => null, 'userId' => $id, 'note' => '', 'createdAt' => (int) (microtime(true) * 1000)];
        $res = $this->push([
            ['entity' => 'sale', 'id' => $usd['id'], 'data' => $usd], ['entity' => 'sale', 'id' => $iqd['id'], 'data' => $iqd],
            ['entity' => 'collection', 'id' => $col['id'], 'data' => $col],
        ]);
        $this->assertSame([[], []], [$res[0]['flags'] ?? [], $res[1]['flags'] ?? []]); // dollar rounding is not a "total mismatch"

        $stored = \App\Models\Collection::find($col['id']);
        $this->assertSame([146000, 100.0, 'USD', 1460], [$stored->amount_iqd, $stored->tendered, $stored->currency, $stored->rate]);
        $this->assertSame(350000 - 146000, $noor->fresh()->balance_iqd); // balances stay in dinars

        $f = $this->api('GET', 'delegate-closings/figures')->assertOk()->json('figures');
        $this->assertSame(36000, $f['expectedCashBeforeExpensesIQD']); // only the dinar notes
        $this->assertEquals([49, 100, 149], [$f['cashSalesUSD'], $f['collectionsUSD'], $f['expectedCashUSD']]);
        $this->assertSame(107540, $f['cashSalesIQD']); // value of all cash sales, for the report

        $this->api('POST', 'delegate-closings', ['countedCashIQD' => 31000, 'countedCashUSD' => 148.5, 'expensesIQD' => 5000])->assertCreated();
        $c = $this->api('GET', 'delegate-closings')->json('closings.0');
        $this->assertSame([31000, 0], [$c['expectedCashIQD'], $c['varianceIQD']]);
        $this->assertEquals([149, 148.5, -0.5], [$c['expectedCashUSD'], $c['countedCashUSD'], $c['varianceUSD']]);
    }

    public function test_the_pos_can_take_a_debt_payment_in_dollars(): void
    {
        $this->shop();
        $noor = $this->customerNamed('Al-Noor Perfumes');
        $this->api('POST', "customers/{$noor->id}/collect", ['amountIQD' => 73000, 'method' => 'cash_usd'])->assertStatus(422); // how many dollars?
        $res = $this->api('POST', "customers/{$noor->id}/collect", ['amountIQD' => 73000, 'method' => 'cash_usd', 'tenderedUSD' => 50])->assertCreated();
        $this->assertSame(['USD', 50, 1460], [$res->json('collection.currency'), $res->json('collection.tendered'), $res->json('collection.rate')]);
        $this->assertSame(350000 - 73000, $res->json('customer.balanceIQD'));
    }

    public function test_live_location_reaches_the_owner(): void
    {
        $this->shop();
        $id = $this->delegate();
        $now = (int) (microtime(true) * 1000);
        $this->asDelegate($id);
        $res = $this->api('POST', 'delegate-locations', ['points' => [
            ['lat' => 36.8669, 'lng' => 42.9503, 'accuracyM' => 12, 'at' => $now - 600_000],   // Duhok, 10 minutes ago
            ['lat' => 36.8701, 'lng' => 42.9612, 'accuracyM' => 8, 'at' => $now - 60_000],     // a minute ago
            ['lat' => 0, 'lng' => 0, 'at' => $now],                                             // a phone with no fix
            ['lat' => 95, 'lng' => 42.9, 'at' => $now],                                         // impossible
            ['lat' => 36.9, 'lng' => 43.0, 'at' => $now - 30 * 86_400_000],                     // a month old
            'garbage',
        ]])->assertOk();
        $this->assertSame(2, $res->json('saved'));
        // sending the same point again (a retry after a dropped connection) stores nothing new
        $this->api('POST', 'delegate-locations', ['points' => [['lat' => 36.8701, 'lng' => 42.9612, 'at' => $now - 60_000]]])->assertOk()->assertJsonPath('saved', 0);

        $this->asOwner();
        $row = collect($this->api('GET', 'delegates')->json('delegates'))->firstWhere('id', $id);
        $this->assertEquals(['lat' => 36.8701, 'lng' => 42.9612, 'accuracyM' => 8, 'at' => $now - 60_000], $row['lastLocation']);
        $trail = $this->api('GET', "delegates/$id/locations")->assertOk();
        $this->assertSame([42.9503, 42.9612], array_column($trail->json('points'), 'lng'));
        $this->assertEquals(36.8701, $trail->json('last.lat'));
        // only delegates send points; only managers see them
        $this->api('POST', 'delegate-locations', ['points' => [['lat' => 36.8, 'lng' => 42.9, 'at' => $now]]])->assertStatus(403);
        $cashier = $this->makeUser('Ali', 'alii', 'cashier', '3333');
        $this->asUser($cashier, '3333');
        $this->api('GET', "delegates/$id/locations")->assertStatus(403);
    }

    public function test_a_delegate_pull_carries_their_van(): void
    {
        $this->shop();
        $id = $this->delegate();
        $v = $this->variantOf('Yara');
        $this->api('POST', "delegates/$id/load", ['items' => [['variantId' => $v->id, 'qty' => 7]]])->assertOk();
        $this->asDelegate($id);
        $van = $this->api('GET', 'sync/pull')->assertOk()->json('van');
        $this->assertSame('van:'.$id, $van['locationId']);
        $this->assertSame(7, $van['stock'][$v->id]);
        // a store cashier gets no van block
        $this->asOwner();
        $cashier = $this->makeUser('Ali', 'alii', 'cashier', '3333');
        $this->asUser($cashier, '3333');
        $this->assertNull($this->api('GET', 'sync/pull')->json('van'));
    }

    public function test_shops_set_up_before_delegates_get_the_delegate_permissions(): void
    {
        $this->shop();
        // built-in roles as an older version created them
        \DB::table('roles')->where('key', 'delegate')->update(['permissions' => json_encode(['customers.view', 'products.view']), 'apps' => json_encode(['delegate'])]);
        \DB::table('roles')->where('key', 'manager')->update(['permissions' => json_encode(['pos.sell', 'reports.view'])]);
        \DB::table('roles')->where('key', 'super_admin')->update(['apps' => json_encode(['pos', 'admin'])]);
        $id = $this->delegate();
        $this->assertSame([], $this->api('GET', 'delegates')->json('delegates'));

        (require database_path('migrations/2026_10_04_100001_upgrade_system_roles_for_delegates.php'))->up();

        $this->assertSame([$id], collect($this->api('GET', 'delegates')->assertOk()->json('delegates'))->pluck('id')->all());
        $manager = json_decode(\DB::table('roles')->where('key', 'manager')->value('permissions'), true);
        $this->assertContains('delegates.manage', $manager);
        $this->assertContains('pos.sell', $manager); // nothing the shop had is taken away
        $this->assertNotContains('delegate.sell', json_decode(\DB::table('roles')->where('key', 'cashier')->value('permissions'), true));
        $this->assertContains('delegate', json_decode(\DB::table('roles')->where('key', 'super_admin')->value('apps'), true));
    }
}
