<?php

namespace Tests\Feature;

use App\Models\Variant;
use Illuminate\Support\Str;
use Tests\ApiTestCase;

/**
 * The dashboard tells sales apart from money: what came in (paid on the bills plus old debts paid back), what is
 * still owed, how much of the profit sits on bills not paid yet, and the cash the delegates took that the shop has
 * not received from them — until a manager presses "Received".
 */
class MoneyInTest extends ApiTestCase
{
    private function delegate(): string
    {
        return $this->makeUser('Karwan', 'karwan', 'delegate', '5151');
    }

    private function asDelegate(string $id): void
    {
        $res = $this->api('POST', 'auth/pin-login', ['userId' => $id, 'pin' => '5151', 'app' => 'delegate'], [])->assertOk();
        $this->auth = ['Authorization' => 'Bearer '.$res->json('token')];
    }

    /** A delegate sale as the phone stores it: cash, or on a shop's account when $customerId is given. */
    private function sale(string $uid, Variant $v, int $unit, ?string $customerId = null, ?int $at = null): array
    {
        $method = $customerId ? 'debt' : 'cash_iqd';

        return [
            'id' => (string) Str::uuid(), 'number' => 'DL1-'.random_int(100000, 999999), 'shiftId' => null, 'userId' => $uid, 'userName' => 'Karwan',
            'customerId' => $customerId, 'customerName' => '', 'channel' => 'delegate', 'status' => 'completed',
            'items' => [['variantId' => $v->id, 'productId' => $v->product_id, 'name' => $v->product->name, 'brand' => 'Lattafa', 'label' => $v->label, 'sku' => $v->sku, 'barcode' => $v->barcode,
                'qty' => 1, 'unitPriceIQD' => $unit, 'unitCostIQD' => 0, 'discountPct' => 0, 'discountIQD' => 0, 'lineTotalIQD' => $unit, 'returnedQty' => 0]],
            'subtotalIQD' => $unit, 'itemDiscountIQD' => 0, 'orderDiscountIQD' => 0, 'orderDiscount' => null, 'giftWrapIQD' => 0, 'taxIQD' => 0, 'roundingIQD' => 0, 'pointsRedeemedIQD' => 0,
            'totalIQD' => $unit, 'payments' => [['method' => $method, 'amountIQD' => $unit, 'tendered' => $unit, 'currency' => 'IQD', 'rate' => 1460, 'reference' => '']],
            'paidIQD' => $customerId ? 0 : $unit, 'changeIQD' => 0, 'dueIQD' => $customerId ? $unit : 0, 'pointsEarned' => 0, 'pointsRedeemed' => 0, 'exchangeRate' => 1460,
            'note' => '', 'approvedBy' => null, 'deviceId' => $this->deviceId, 'createdAt' => $at ?? (int) (microtime(true) * 1000), 'voidedAt' => null, 'voidReason' => '',
        ];
    }

    private function push(array $records): void
    {
        $items = array_map(fn ($r) => ['entity' => isset($r['items']) ? 'sale' : 'collection', 'id' => $r['id'], 'data' => $r], $records);
        $results = $this->api('POST', 'sync/push', ['items' => $items])->assertOk()->json('results');
        $this->assertSame(array_fill(0, count($records), 'ok'), array_column($results, 'status'));
    }

    private function dashboard(): array
    {
        return $this->api('GET', 'dashboard?period=today')->assertOk()->json();
    }

    public function test_money_received_owed_and_the_profit_still_on_debt(): void
    {
        $this->shop();
        $kh = $this->variantOf('Khamrah');
        $noor = $this->customerNamed('Al-Noor Perfumes');
        $id = $this->delegate();
        $owedBefore = $this->dashboard()['debts']['totalIQD'];
        $this->asDelegate($id);
        $col = ['id' => (string) Str::uuid(), 'customerId' => $noor->id, 'amountIQD' => 20000, 'method' => 'cash_iqd', 'shiftId' => null, 'userId' => $id, 'note' => '', 'createdAt' => (int) (microtime(true) * 1000)];
        $this->push([$this->sale($id, $kh, 40000), $this->sale($id, $kh, 36000, $noor->id), $col]);

        $this->asOwner();
        $d = $this->dashboard();
        $t = $d['totals'];
        // sold 76,000, of which 36,000 on the shop's account; 20,000 of old debt came back: 60,000 came in
        $this->assertSame([76000, 36000, 20000, 60000], [$t['revenueIQD'], $t['creditIQD'], $t['collectedIQD'], $t['receivedIQD']]);
        $this->assertSame($owedBefore + 36000 - 20000, $d['debts']['totalIQD'], 'everything owed right now, not only today');
        $this->assertSame(36000 - $kh->cost_iqd, $t['creditProfitIQD'], 'the profit on the bill left on debt');
        $this->assertSame(0, $d['previous']['receivedIQD']);
    }

    public function test_cash_stays_with_the_delegate_until_the_shop_receives_it(): void
    {
        $this->shop();
        $kh = $this->variantOf('Khamrah');
        $noor = $this->customerNamed('Al-Noor Perfumes');
        $id = $this->delegate();
        $this->asDelegate($id);
        $yesterday = (int) (microtime(true) * 1000) - 86_400_000;
        $col = ['id' => (string) Str::uuid(), 'customerId' => $noor->id, 'amountIQD' => 50000, 'method' => 'cash_iqd', 'shiftId' => null, 'userId' => $id, 'note' => '', 'createdAt' => (int) (microtime(true) * 1000)];
        // yesterday 30,000 never closed; today 72,000 cash + 50,000 collected; a debt sale brings no cash
        $this->push([$this->sale($id, $kh, 30000, null, $yesterday), $this->sale($id, $kh, 72000), $this->sale($id, $kh, 36000, $noor->id), $col]);
        // today's closing lists 5,000 of fuel, paid out of that cash
        $this->api('POST', 'delegate-closings', ['countedCashIQD' => 117000, 'expensesIQD' => 5000])->assertCreated();

        // a cashier may not receive it
        $this->asOwner();
        $this->cashierWithShift();
        $this->api('POST', "delegates/$id/receive-cash")->assertStatus(403);

        $this->asOwner();
        $w = $this->dashboard()['withDelegates'];
        $this->assertSame([147000, 147000], [$w['totalIQD'], $w['cashIQD']]);
        $this->assertSame([$id, 147000, 2], [$w['delegates'][0]['id'], $w['delegates'][0]['cashIQD'], $w['delegates'][0]['days']]);

        // the owner receives it: today's closing is approved, yesterday gets one written
        $r = $this->api('POST', "delegates/$id/receive-cash")->assertOk()->json();
        $this->assertSame([147000, 2], [$r['cashIQD'], count($r['days'])]);
        $this->assertSame([0, []], [$this->dashboard()['withDelegates']['totalIQD'], $this->dashboard()['withDelegates']['delegates']]);
        $closings = collect($this->api('GET', "delegate-closings?userId=$id")->json('closings'));
        $this->assertSame(['approved', 'approved'], $closings->pluck('status')->all());
        $this->assertSame(30000, $closings->last()['countedCashIQD']);
        $this->api('POST', "delegates/$id/receive-cash")->assertStatus(422)->assertJsonPath('error.code', 'nothing_to_receive');

        // he keeps selling today: that cash is with him again, until the next "Received"
        usleep(5000);
        $this->asDelegate($id);
        $this->push([$this->sale($id, $kh, 40000)]);
        $this->asOwner();
        $this->assertSame(40000, $this->dashboard()['withDelegates']['totalIQD']);
        $this->assertSame(40000, $this->api('POST', "delegates/$id/receive-cash")->assertOk()->json('cashIQD'));
        $this->assertSame(0, $this->dashboard()['withDelegates']['totalIQD']);
    }

    public function test_dollars_are_held_apart_and_valued_at_the_rate(): void
    {
        $this->shop();
        $kh = $this->variantOf('Khamrah');
        $id = $this->delegate();
        $this->asDelegate($id);
        $s = $this->sale($id, $kh, 73000);
        $s['payments'] = [['method' => 'cash_usd', 'amountIQD' => 73000, 'tendered' => 50, 'currency' => 'USD', 'rate' => 1460, 'reference' => '']];
        $this->push([$s]);
        $this->asOwner();
        $w = $this->dashboard()['withDelegates'];
        $this->assertEquals([0, 50, 73000], [$w['cashIQD'], $w['cashUSD'], $w['totalIQD']]);
    }
}
