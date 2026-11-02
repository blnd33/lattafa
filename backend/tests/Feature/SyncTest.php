<?php

namespace Tests\Feature;

use App\Models\Customer;
use App\Models\Device;
use App\Models\Sale;
use App\Models\Shift;
use App\Models\User;
use App\Models\Variant;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\ApiTestCase;

/** Offline tills pushing their work (idempotently, never losing a paid sale) and pulling server changes. */
class SyncTest extends ApiTestCase
{
    private int $seq = 0;

    /** A sale exactly as the POS stores it in IndexedDB (see pos/src/data/types.ts). */
    private function tillSale(string $userId, Variant $v, int $qty = 1, array $over = []): array
    {
        $gross = $v->retail_iqd * $qty;
        $this->seq++;

        return $over + [
            'id' => (string) Str::uuid(), 'number' => 'ST1-9'.str_pad((string) $this->seq, 5, '0', STR_PAD_LEFT), 'shiftId' => null, 'userId' => $userId, 'userName' => 'Till',
            'customerId' => null, 'customerName' => '', 'channel' => 'store', 'status' => 'completed',
            'items' => [[
                'variantId' => $v->id, 'productId' => $v->product_id, 'name' => $v->product->name, 'brand' => 'Lattafa', 'label' => $v->label, 'sku' => $v->sku, 'barcode' => $v->barcode,
                'qty' => $qty, 'unitPriceIQD' => $v->retail_iqd, 'unitCostIQD' => 0, 'discountPct' => 0, 'discountIQD' => 0, 'lineTotalIQD' => $gross, 'returnedQty' => 0,
            ]],
            'subtotalIQD' => $gross, 'itemDiscountIQD' => 0, 'orderDiscountIQD' => 0, 'orderDiscount' => null, 'giftWrapIQD' => 0, 'taxIQD' => 0, 'roundingIQD' => 0,
            'pointsRedeemedIQD' => 0, 'totalIQD' => $gross,
            'payments' => [['method' => 'cash_iqd', 'amountIQD' => $gross, 'tendered' => $gross, 'currency' => 'IQD', 'rate' => 1460, 'reference' => '']],
            'paidIQD' => $gross, 'changeIQD' => 0, 'dueIQD' => 0, 'pointsEarned' => 0, 'pointsRedeemed' => 0, 'exchangeRate' => 1460, 'note' => '', 'approvedBy' => null,
            'deviceId' => $this->deviceId, 'createdAt' => (int) (microtime(true) * 1000) - 3_600_000, 'voidedAt' => null, 'voidReason' => '',
        ];
    }

    private function item(string $entity, array $data): array
    {
        return ['entity' => $entity, 'id' => $data['id'], 'data' => $data];
    }

    /** @param array<int, array<string, mixed>> $items */
    private function push(array $items): TestResponse
    {
        return $this->api('POST', 'sync/push', ['items' => $items])->assertOk();
    }

    /** A cashier signed in on the till, with the till's user id. @return array{0: string, 1: array} */
    private function till(): array
    {
        $id = $this->makeUser('Till', 'till', 'cashier', '2468', ['limits' => ['maxDiscountPct' => 10, 'maxRefundIQD' => 100000]]);
        $this->asUser($id, '2468');

        return [$id, $this->auth];
    }

    /* ─────────── push: sales ─────────── */

    public function test_an_offline_sale_is_recorded_once_with_its_original_time_and_number(): void
    {
        $this->shop();
        $v = $this->variantOf('Khamrah');
        [$uid] = $this->till();
        $sale = $this->tillSale($uid, $v, 2);

        $r = $this->push([$this->item('sale', $sale)])->json('results.0');
        $this->assertSame('ok', $r['status']);
        $this->assertSame([], $r['flags']);
        $this->assertSame(12, $this->stockOf($v));

        $stored = Sale::find($sale['id']);
        $this->assertSame($sale['number'], $stored->number);
        $this->assertSame($sale['createdAt'], $stored->sold_at);
        $this->assertSame(90000, $stored->total_iqd);
        $this->assertSame($uid, $stored->user_id);
        $this->assertFalse((bool) $stored->needs_review);
        $this->assertSame(0, $stored->items[0]->discount_pct);
        $this->assertSame($v->cost_iqd, $stored->items[0]->unit_cost_iqd); // cost is filled in by the server, never trusted from a till
        $this->assertSame($sale['createdAt'], \App\Models\StockMovement::where('ref_id', $sale['id'])->value('occurred_at'));

        // the same batch again (a retry after a dropped connection) changes nothing
        $r = $this->push([$this->item('sale', $sale)])->json('results.0');
        $this->assertSame('duplicate', $r['status']);
        $this->assertSame(12, $this->stockOf($v));
        $this->assertSame(1, Sale::count());
    }

    public function test_a_paid_sale_is_never_rejected_for_business_reasons_but_is_flagged(): void
    {
        $this->shop();
        $raghba = $this->variantOf('Raghba'); // 3 in stock
        [$uid] = $this->till();
        $sale = $this->tillSale($uid, $raghba, 5);

        $r = $this->push([$this->item('sale', $sale)])->json('results.0');
        $this->assertSame('ok', $r['status']);
        $this->assertContains('negative_stock', $r['flags']);
        $this->assertSame(-2, $this->stockOf($raghba));
        $this->assertTrue((bool) Sale::find($sale['id'])->needs_review);

        $this->asOwner();
        $review = $this->api('GET', 'sales/review')->assertOk()->json('sales');
        $this->assertSame([$sale['id']], collect($review)->pluck('id')->all());
        $this->assertContains('negative_stock', $review[0]['flags']);
    }

    public function test_price_total_discount_and_cashier_anomalies_are_flagged_not_refused(): void
    {
        $this->shop();
        $v = $this->variantOf('Khamrah');
        [$uid] = $this->till();

        // the shop raised prices while the till was offline
        $stale = $this->tillSale($uid, $v, 1);
        $stale['items'][0]['unitPriceIQD'] = 40000;
        $stale['items'][0]['lineTotalIQD'] = 40000;
        $stale['subtotalIQD'] = $stale['totalIQD'] = $stale['paidIQD'] = 40000;
        $stale['payments'][0]['amountIQD'] = $stale['payments'][0]['tendered'] = 40000;
        $r = $this->push([$this->item('sale', $stale)])->json('results.0');
        $this->assertSame('ok', $r['status']);
        $this->assertSame(['price_mismatch'], $r['flags']);

        // arithmetic that doesn't add up
        $bad = $this->tillSale($uid, $v, 1);
        $bad['totalIQD'] = 1000;
        $r = $this->push([$this->item('sale', $bad)])->json('results.0');
        $this->assertSame('ok', $r['status']);
        $this->assertContains('total_mismatch', $r['flags']);
        $this->assertContains('payment_mismatch', $r['flags']);

        // a 30 % discount by someone limited to 10 %, with no supervisor
        $disc = $this->tillSale($uid, $v, 1);
        $disc['items'][0]['discountPct'] = 30;
        $disc['items'][0]['discountIQD'] = 13500;
        $disc['items'][0]['lineTotalIQD'] = 31500;
        $disc['itemDiscountIQD'] = 13500;
        $disc['totalIQD'] = $disc['paidIQD'] = 31500;
        $disc['payments'][0]['amountIQD'] = $disc['payments'][0]['tendered'] = 31500;
        $r = $this->push([$this->item('sale', $disc)])->json('results.0');
        $this->assertSame(['discount_over_limit'], $r['flags']);
        $this->assertSame(30, Sale::find($disc['id'])->items[0]->discount_pct);

        // a cashier the server has never heard of is attributed to the signed-in user
        $ghost = $this->tillSale((string) Str::uuid(), $v, 1);
        $r = $this->push([$this->item('sale', $ghost)])->json('results.0');
        $this->assertSame(['unknown_cashier'], $r['flags']);
        $this->assertSame($uid, Sale::find($ghost['id'])->user_id);
    }

    public function test_offline_credit_sale_over_the_limit_is_kept_and_flagged(): void
    {
        $this->shop();
        $v = $this->variantOf('Khamrah');
        $zana = $this->customerNamed('Zana Ahmed'); // credit limit 0
        [$uid] = $this->till();
        $sale = $this->tillSale($uid, $v, 1, [
            'customerId' => $zana->id, 'customerName' => 'Zana Ahmed', 'dueIQD' => 45000, 'paidIQD' => 0,
            'payments' => [['method' => 'debt', 'amountIQD' => 45000, 'tendered' => 45000, 'currency' => 'IQD', 'rate' => 1460, 'reference' => '']],
        ]);
        $r = $this->push([$this->item('sale', $sale)])->json('results.0');
        $this->assertSame('ok', $r['status']);
        $this->assertContains('credit_limit_exceeded', $r['flags']);
        $this->assertSame(45000, $zana->fresh()->balance_iqd);
    }

    public function test_two_different_sales_cannot_share_a_receipt_number(): void
    {
        $this->shop();
        $v = $this->variantOf('Khamrah');
        [$uid] = $this->till();
        $a = $this->tillSale($uid, $v);
        $b = $this->tillSale($uid, $v, 1, ['number' => $a['number']]);
        $r = $this->push([$this->item('sale', $a), $this->item('sale', $b)])->json('results');
        $this->assertSame('ok', $r[0]['status']);
        $this->assertSame('rejected', $r[1]['status']);
        $this->assertSame('number_taken', $r[1]['code']);
        $this->assertSame(13, $this->stockOf($v)); // only the first one moved stock
    }

    public function test_a_sale_voided_on_the_till_after_syncing_is_voided_here_too(): void
    {
        $this->shop();
        $v = $this->variantOf('Khamrah');
        [$uid] = $this->till();
        $sale = $this->tillSale($uid, $v);
        $this->push([$this->item('sale', $sale)]);
        $this->assertSame(13, $this->stockOf($v));

        $voided = $sale;
        $voided['status'] = 'voided';
        $voided['voidReason'] = 'wrong item';
        $voided['voidedAt'] = $sale['createdAt'] + 60000;
        $this->assertSame('ok', $this->push([$this->item('sale', $voided)])->json('results.0.status'));
        $this->assertSame(14, $this->stockOf($v));
        $this->assertSame('voided', Sale::find($sale['id'])->status);
        $this->assertSame($voided['voidedAt'], Sale::find($sale['id'])->voided_at);

        $this->assertSame('duplicate', $this->push([$this->item('sale', $voided)])->json('results.0.status'));
        $this->assertSame(14, $this->stockOf($v)); // not restocked twice
    }

    public function test_a_sale_that_was_voided_before_it_ever_synced_nets_out_to_nothing(): void
    {
        $this->shop();
        $v = $this->variantOf('Khamrah');
        [$uid] = $this->till();
        $sale = $this->tillSale($uid, $v, 1, ['status' => 'voided', 'voidReason' => 'mistake', 'voidedAt' => (int) (microtime(true) * 1000)]);
        $this->assertSame('ok', $this->push([$this->item('sale', $sale)])->json('results.0.status'));
        $this->assertSame(14, $this->stockOf($v));
        $this->assertSame('voided', Sale::find($sale['id'])->status);
    }

    /* ─────────── push: returns, shifts, collections, customers, movements ─────────── */

    public function test_a_return_that_arrives_before_its_sale_is_told_to_retry(): void
    {
        $this->shop();
        $v = $this->variantOf('Khamrah');
        [$uid] = $this->till();
        $sale = $this->tillSale($uid, $v, 2);
        $ret = [
            'id' => (string) Str::uuid(), 'number' => 'ST1-R00001', 'saleId' => $sale['id'], 'saleNumber' => $sale['number'], 'shiftId' => null, 'userId' => $uid, 'userName' => 'Till',
            'items' => [['saleItemIndex' => 0, 'variantId' => $v->id, 'productId' => $v->product_id, 'name' => $v->product->name, 'label' => '100 ml', 'qty' => 1, 'unitNetIQD' => 45000, 'restock' => true, 'reason' => 'gift']],
            'refundIQD' => 45000, 'refundMethod' => 'cash_iqd', 'note' => '', 'approvedBy' => null, 'createdAt' => (int) (microtime(true) * 1000),
        ];

        $r = $this->push([$this->item('return', $ret)])->json('results.0');
        $this->assertSame('retry', $r['status']);
        $this->assertSame('sale_not_synced', $r['code']);

        // sale first, then the return (as the till's outbox would send them in order)
        $rs = $this->push([$this->item('sale', $sale), $this->item('return', $ret)])->json('results');
        $this->assertSame(['ok', 'ok'], [$rs[0]['status'], $rs[1]['status']]);
        $this->assertSame(13, $this->stockOf($v)); // 14 − 2 + 1
        $this->assertSame('partially_returned', Sale::find($sale['id'])->status);
        $this->assertSame('duplicate', $this->push([$this->item('return', $ret)])->json('results.0.status'));
        $this->assertSame(13, $this->stockOf($v));
    }

    public function test_shift_open_close_and_cash_movements_sync(): void
    {
        $this->shop();
        [$uid] = $this->till();
        $now = (int) (microtime(true) * 1000);
        $shift = [
            'id' => (string) Str::uuid(), 'userId' => $uid, 'userName' => 'Till', 'deviceId' => $this->deviceId, 'status' => 'open', 'openedAt' => $now - 7200000, 'closedAt' => null,
            'openingIQD' => 50000, 'openingUSD' => 0, 'movements' => [['id' => (string) Str::uuid(), 'type' => 'out', 'amountIQD' => 2000, 'reason' => 'lunch', 'userId' => $uid, 'createdAt' => $now - 3600000]],
            'countedIQD' => null, 'countedUSD' => null, 'varianceIQD' => null, 'totals' => null, 'note' => '',
        ];
        $this->assertSame('ok', $this->push([$this->item('shift', $shift)])->json('results.0.status'));
        $this->assertSame('open', Shift::find($shift['id'])->status);
        $this->assertSame('duplicate', $this->push([$this->item('shift', $shift)])->json('results.0.status')); // nothing new

        $closed = $shift + [];
        $closed['status'] = 'closed';
        $closed['closedAt'] = $now;
        $closed['countedIQD'] = 48000;
        $closed['countedUSD'] = 0;
        $closed['varianceIQD'] = 0;
        $closed['totals'] = ['salesCount' => 0, 'expectedIQD' => 48000];
        $this->assertSame('ok', $this->push([$this->item('shift', $closed)])->json('results.0.status'));
        $stored = Shift::find($shift['id']);
        $this->assertSame('closed', $stored->status);
        $this->assertSame(48000, $stored->counted_iqd);
        $this->assertSame(1, $stored->movements()->count());
        $this->assertSame('duplicate', $this->push([$this->item('shift', $closed)])->json('results.0.status'));
    }

    public function test_collections_are_idempotent_and_never_push_a_balance_below_zero(): void
    {
        $this->shop();
        $noor = $this->customerNamed('Al-Noor Perfumes'); // owes 350,000
        [$uid] = $this->till();
        $c = ['id' => (string) Str::uuid(), 'customerId' => $noor->id, 'amountIQD' => 100000, 'method' => 'cash_iqd', 'shiftId' => null, 'userId' => $uid, 'note' => 'offline', 'createdAt' => (int) (microtime(true) * 1000)];
        $this->assertSame('ok', $this->push([$this->item('collection', $c)])->json('results.0.status'));
        $this->assertSame(250000, $noor->fresh()->balance_iqd);
        $this->assertSame('duplicate', $this->push([$this->item('collection', $c)])->json('results.0.status'));
        $this->assertSame(250000, $noor->fresh()->balance_iqd);

        $big = ['id' => (string) Str::uuid(), 'amountIQD' => 999999] + $c;
        $this->assertSame('ok', $this->push([$this->item('collection', $big)])->json('results.0.status')); // money was taken; record it
        $this->assertSame(0, $noor->fresh()->balance_iqd);
    }

    public function test_customers_created_offline_sync_and_keep_server_owned_balances(): void
    {
        $this->shop();
        [$uid] = $this->till();
        $now = (int) (microtime(true) * 1000);
        $new = ['id' => (string) Str::uuid(), 'name' => 'Offline Customer', 'phone' => '0750 000 1111', 'type' => 'shop', 'city' => 'Zakho', 'notes' => '', 'balanceIQD' => 999999, 'creditLimitIQD' => 100000, 'points' => 999, 'active' => true, 'createdAt' => $now, 'updatedAt' => $now];
        $this->assertSame('ok', $this->push([$this->item('customer', $new)])->json('results.0.status'));
        $c = Customer::find($new['id']);
        $this->assertSame('Offline Customer', $c->name);
        $this->assertSame(0, $c->balance_iqd); // a till cannot set its own balance or points
        $this->assertSame(0, $c->points);

        $edit = ['name' => 'Renamed', 'updatedAt' => $now + 5000] + $new;
        $this->assertSame('ok', $this->push([$this->item('customer', $edit)])->json('results.0.status'));
        $this->assertSame('Renamed', $c->fresh()->name);
        $stale = ['name' => 'Old edit', 'updatedAt' => $now - 999999] + $new;
        $this->assertSame('duplicate', $this->push([$this->item('customer', $stale)])->json('results.0.status'));
        $this->assertSame('Renamed', $c->fresh()->name);

        $nameless = ['id' => (string) Str::uuid(), 'name' => '  '] + $new;
        $this->assertSame('rejected', $this->push([$this->item('customer', $nameless)])->json('results.0.status'));
    }

    public function test_offline_stock_movements_apply_once_and_sales_movements_are_not_accepted_that_way(): void
    {
        $this->shop();
        $v = $this->variantOf('Khamrah');
        [$uid] = $this->till();
        $mv = ['id' => (string) Str::uuid(), 'variantId' => $v->id, 'locationId' => 'loc-store', 'type' => 'damage', 'qty' => -1, 'balanceAfter' => 13, 'refType' => null, 'refId' => null, 'note' => 'dropped', 'userId' => $uid, 'createdAt' => (int) (microtime(true) * 1000)];
        $this->assertSame('ok', $this->push([$this->item('stock_movement', $mv)])->json('results.0.status'));
        $this->assertSame(13, $this->stockOf($v));
        $this->assertSame('duplicate', $this->push([$this->item('stock_movement', $mv)])->json('results.0.status'));
        $this->assertSame(13, $this->stockOf($v));

        $sneaky = ['id' => (string) Str::uuid(), 'type' => 'sale', 'qty' => -13] + $mv;
        $r = $this->push([$this->item('stock_movement', $sneaky)])->json('results.0');
        $this->assertSame('rejected', $r['status']);
        $this->assertSame(13, $this->stockOf($v));
    }

    public function test_one_bad_item_never_blocks_the_rest_of_the_batch(): void
    {
        $this->shop();
        $v = $this->variantOf('Khamrah');
        [$uid] = $this->till();
        $good = $this->tillSale($uid, $v);
        $broken = ['id' => (string) Str::uuid(), 'number' => 'ST1-BAD'];  // malformed sale
        $unknown = ['id' => (string) Str::uuid()];
        $r = $this->push([$this->item('sale', $broken), $this->item('spaceship', $unknown), $this->item('sale', $good)])->json('results');
        $this->assertContains($r[0]['status'], ['error', 'rejected']);
        $this->assertSame('rejected', $r[1]['status']);
        $this->assertSame('unknown_entity', $r[1]['code']);
        $this->assertSame('ok', $r[2]['status']);
        $this->assertSame(13, $this->stockOf($v));
        $this->assertSame(1, Sale::count());
    }

    public function test_push_is_authenticated_validated_and_bound_to_a_live_device(): void
    {
        $this->shop();
        $this->postJson('/api/v1/sync/push', ['items' => []])->assertStatus(401);
        $this->api('POST', 'sync/push', ['items' => []])->assertStatus(422);
        $this->api('POST', 'sync/push', ['items' => array_fill(0, 201, ['entity' => 'sale', 'id' => 'x', 'data' => ['a' => 1]])])->assertStatus(422);

        // sending work marks the till as seen
        $this->push([['entity' => 'spaceship', 'id' => (string) Str::uuid(), 'data' => ['a' => 1]]]);
        $this->assertNotNull(Device::find($this->deviceId)->last_seen_at);

        // a revoked till can't push (it may be stolen): its tokens die with it, even after its code was renamed
        $devices = $this->api('GET', 'devices')->json('devices');
        $this->api('PUT', "devices/{$devices[0]['id']}", ['name' => 'Renamed till', 'code' => 'NEW1'])->assertOk();
        $this->api('POST', "devices/{$devices[0]['id']}/revoke")->assertOk();
        $this->api('POST', 'sync/push', ['items' => [['entity' => 'sale', 'id' => (string) Str::uuid(), 'data' => ['a' => 1]]]])->assertStatus(401);
        $this->assertSame(0, \Laravel\Sanctum\PersonalAccessToken::count());
    }

    public function test_the_device_header_cannot_be_used_to_borrow_another_tills_identity(): void
    {
        $this->shop();
        [$uid, $cashierAuth] = $this->till();
        // a second, revoked device exists; the cashier's token belongs to the first one
        $other = (string) Str::uuid();
        Device::create(['id' => $other, 'name' => 'Old till', 'code' => 'OLD', 'revoked' => true]);
        $res = $this->withHeaders($cashierAuth + ['X-Device-Id' => $other, 'Accept' => 'application/json'])->getJson('/api/v1/auth/me');
        $res->assertOk(); // the token decides which till this is, not the header
        $this->assertSame($this->deviceId, Device::where('last_seen_at', '!=', null)->orderByDesc('last_seen_at')->first()->id);
    }

    /* ─────────── pull ─────────── */

    public function test_full_pull_returns_settings_roles_users_catalogue_and_customers_without_credentials(): void
    {
        $this->shop();
        $this->makeUser('Ali', 'alii', 'cashier', '3333');
        $res = $this->api('GET', 'sync/pull')->assertOk();
        $j = $res->json();

        $this->assertSame(1460, $j['settings']['currency']['rate']);
        $this->assertCount(5, $j['roles']);
        $this->assertEqualsCanonicalizing(['owner', 'alii'], collect($j['users'])->pluck('username')->all());
        $this->assertCount(13, $j['products']);
        $this->assertCount(3, $j['customers']);
        $this->assertSame(['products' => [], 'users' => [], 'roles' => []], $j['deleted']);
        $khamrah = collect($j['products'])->first(fn ($p) => $p['name']['en'] === 'Khamrah');
        $this->assertSame(14, collect($khamrah['variants'])->firstWhere('ml', 100)['stock']);

        $raw = $res->getContent();
        foreach (['pin_hash', 'pin_fingerprint', 'password', 'remember_token', 'Owner1234'] as $secret) {
            $this->assertStringNotContainsString($secret, $raw, "pull must never expose $secret");
        }
    }

    public function test_pull_hides_cost_from_tills_signed_in_as_a_cashier(): void
    {
        $this->shop();
        $owner = $this->api('GET', 'sync/pull')->json('products');
        $this->assertGreaterThan(0, $owner[0]['variants'][0]['costIQD']);
        [$uid] = $this->till();
        $costs = collect($this->api('GET', 'sync/pull')->json('products'))->flatMap(fn ($p) => collect($p['variants'])->pluck('costIQD'))->unique()->all();
        $this->assertSame([0], $costs);
    }

    public function test_every_pull_says_how_big_the_whole_catalogue_is_so_a_device_can_spot_a_gap(): void
    {
        $this->shop();
        $full = $this->api('GET', 'sync/pull')->json();
        $this->assertSame(['products' => count($full['products']), 'variants' => collect($full['products'])->sum(fn ($p) => count($p['variants']))], $full['catalog']);

        // a pull with nothing new still gives the totals, not the size of the (empty) list of changes
        $none = $this->api('GET', 'sync/pull?since='.($full['serverTime'] + 3600000))->json();
        $this->assertSame([], $none['products']);
        $this->assertSame($full['catalog'], $none['catalog']);
    }

    public function test_incremental_pull_only_returns_what_changed_including_edits_in_the_same_second(): void
    {
        $this->shop();
        $first = $this->api('GET', 'sync/pull')->json();
        $since = $first['serverTime'];

        $again = $this->api('GET', 'sync/pull?since='.$since)->json();
        // within the overlap window an unchanged catalogue may be re-sent; it must never be *missing* changes
        $v = $this->variantOf('Asad');
        $this->api('POST', 'products/bulk-price', ['mode' => 'fixed', 'value' => 1000, 'target' => 'retail', 'productIds' => [$v->product_id]])->assertOk();
        $after = $this->api('GET', 'sync/pull?since='.$since)->json();
        $changed = collect($after['products'])->first(fn ($p) => $p['name']['en'] === 'Asad');
        $this->assertNotNull($changed, 'a price change right after a pull must reach the till');
        $this->assertSame(43000, $changed['variants'][0]['retailIQD']);

        // far in the future = nothing to send
        $none = $this->api('GET', 'sync/pull?since='.($since + 3600000))->json();
        $this->assertSame([], $none['products']);
        $this->assertSame([], $none['customers']);
    }

    public function test_stock_changes_from_other_tills_reach_a_pulling_till(): void
    {
        $this->shop();
        $since = $this->api('GET', 'sync/pull')->json('serverTime');
        $v = $this->variantOf('Haya');
        $this->api('POST', 'stock/receive', ['items' => [['variantId' => $v->id, 'qty' => 5]]])->assertOk();
        $p = collect($this->api('GET', 'sync/pull?since='.$since)->json('products'))->first(fn ($p) => $p['name']['en'] === 'Haya');
        $this->assertNotNull($p);
        $this->assertSame(15, $p['variants'][0]['stock']);
    }

    public function test_deleted_products_are_announced_as_tombstones(): void
    {
        $this->shop();
        $since = $this->api('GET', 'sync/pull')->json('serverTime');
        $v = $this->variantOf('Haya');
        $this->api('DELETE', "products/{$v->product_id}")->assertOk()->assertJsonPath('result', 'deleted');
        $pull = $this->api('GET', 'sync/pull?since='.$since)->json();
        $this->assertSame([$v->product_id], $pull['deleted']['products']);
        $this->assertNotContains($v->product_id, collect($pull['products'])->pluck('id')->all());
    }

    public function test_the_push_then_pull_round_trip_reflects_offline_sales_in_stock_and_balances(): void
    {
        $this->shop();
        $v = $this->variantOf('Khamrah');
        $noor = $this->customerNamed('Al-Noor Perfumes');
        [$uid] = $this->till();
        $sale = $this->tillSale($uid, $v, 3, [
            'customerId' => $noor->id, 'customerName' => $noor->name, 'dueIQD' => 135000, 'paidIQD' => 0,
            'payments' => [['method' => 'debt', 'amountIQD' => 135000, 'tendered' => 135000, 'currency' => 'IQD', 'rate' => 1460, 'reference' => '']],
        ]);
        $since = $this->api('GET', 'sync/pull')->json('serverTime');
        $this->push([$this->item('sale', $sale)]);

        $pull = $this->api('GET', 'sync/pull?since='.$since)->json();
        $khamrah = collect($pull['products'])->first(fn ($p) => $p['name']['en'] === 'Khamrah');
        $this->assertSame(11, collect($khamrah['variants'])->firstWhere('ml', 100)['stock']);
        $this->assertSame(485000, collect($pull['customers'])->firstWhere('id', $noor->id)['balanceIQD']);
    }

    public function test_sign_in_and_pull_tell_the_till_its_device_code_and_receipt_counters(): void
    {
        $this->shop();
        $v = $this->variantOf('Khamrah');
        $login = $this->api('POST', 'auth/login', ['username' => 'owner', 'password' => 'Owner1234'], [])->assertOk()->json();
        $this->assertSame(['id' => $this->deviceId, 'code' => 'ST1'], collect($login['device'])->only(['id', 'code'])->all());
        $this->auth = ['Authorization' => 'Bearer '.$login['token']]; // signing in again on this till replaced the previous token

        $pull = $this->api('GET', 'sync/pull')->json();
        $this->assertSame('ST1', $pull['device']['code']);
        $this->assertSame(['sale' => 0, 'return' => 0], $pull['counters']);

        // a till pushes ST1-000041; after its storage is wiped it must continue from 42, not 1
        [$uid] = $this->till();
        $sale = $this->tillSale($uid, $v, 1, ['number' => 'ST1-000041']);
        $this->push([$this->item('sale', $sale)]);
        $this->assertSame(41, $this->api('GET', 'sync/pull')->json('counters.sale'));

        // the server's own numbering (online checkout on the same device) skips numbers a till already used
        $this->api('POST', 'shifts/open', ['openingIQD' => 0])->assertCreated();
        for ($i = 0; $i < 2; $i++) {
            $this->checkout($v, 1, [['method' => 'cash_iqd', 'tendered' => 45000]])->assertCreated();
        }
        $numbers = \App\Models\Sale::orderBy('number')->pluck('number')->all();
        $this->assertSame(['ST1-000001', 'ST1-000002', 'ST1-000041'], $numbers);
        \DB::table('counters')->where('key', 'sale:ST1')->update(['value' => 40]); // force the clash
        $next = $this->checkout($v, 1, [['method' => 'cash_iqd', 'tendered' => 45000]])->assertCreated()->json('sale.number');
        $this->assertSame('ST1-000042', $next);
    }

    public function test_next_barcode_is_free_and_needs_catalogue_rights(): void
    {
        $this->shop();
        $code = $this->api('GET', 'products/next-barcode')->assertOk()->json('barcode');
        $this->assertMatchesRegularExpression('/^\d{13}$/', $code);
        $this->assertFalse(Variant::where('barcode', $code)->exists());
        $this->till();
        $this->api('GET', 'products/next-barcode')->assertStatus(403);
    }
}
