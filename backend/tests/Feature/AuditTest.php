<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Variant;
use Illuminate\Support\Str;
use Tests\ApiTestCase;

/**
 * The activity log (admin panel → Users → Activity log): what tills and delegate phones send later still lands there,
 * by the person who did it, at the time it happened — and changes say from what to what.
 */
class AuditTest extends ApiTestCase
{
    private function entry(string $action): ?AuditLog
    {
        return AuditLog::where('action', $action)->orderByDesc('occurred_at')->first();
    }

    private function push(array $items): void
    {
        $res = $this->api('POST', 'sync/push', ['items' => array_map(fn ($d) => ['entity' => $d[0], 'id' => $d[1]['id'], 'data' => $d[1]], $items)])->assertOk();
        foreach ($res->json('results') as $r) {
            $this->assertContains($r['status'], ['ok', 'duplicate'], json_encode($r));
        }
    }

    private function sale(string $userId, Variant $v, int $at): array
    {
        return [
            'id' => (string) Str::uuid(), 'number' => 'ST1-90001', 'shiftId' => null, 'userId' => $userId, 'userName' => 'Till', 'customerId' => null, 'customerName' => '',
            'channel' => 'store', 'status' => 'completed',
            'items' => [['variantId' => $v->id, 'productId' => $v->product_id, 'name' => $v->product->name, 'brand' => 'Lattafa', 'label' => $v->label, 'sku' => $v->sku, 'barcode' => $v->barcode,
                'qty' => 1, 'unitPriceIQD' => $v->retail_iqd, 'unitCostIQD' => 0, 'discountPct' => 0, 'discountIQD' => 0, 'lineTotalIQD' => $v->retail_iqd, 'returnedQty' => 0]],
            'subtotalIQD' => $v->retail_iqd, 'itemDiscountIQD' => 0, 'orderDiscountIQD' => 0, 'orderDiscount' => null, 'giftWrapIQD' => 0, 'taxIQD' => 0, 'roundingIQD' => 0,
            'pointsRedeemedIQD' => 0, 'totalIQD' => $v->retail_iqd,
            'payments' => [['method' => 'cash_iqd', 'amountIQD' => $v->retail_iqd, 'tendered' => $v->retail_iqd, 'currency' => 'IQD', 'rate' => 1460, 'reference' => '']],
            'paidIQD' => $v->retail_iqd, 'changeIQD' => 0, 'dueIQD' => 0, 'pointsEarned' => 0, 'pointsRedeemed' => 0, 'exchangeRate' => 1460, 'note' => '', 'approvedBy' => null,
            'deviceId' => $this->deviceId, 'createdAt' => $at, 'voidedAt' => null, 'voidReason' => '',
        ];
    }

    public function test_what_tills_and_phones_send_later_is_logged_by_who_did_it_at_the_time_it_happened(): void
    {
        $this->shop();
        $till = $this->makeUser('Till', 'till', 'cashier', '2468');
        $this->asUser($till, '2468');
        $now = (int) (microtime(true) * 1000);

        // a shift opened two hours ago, with cash taken out an hour ago — sent only now
        $shift = [
            'id' => (string) Str::uuid(), 'userId' => $till, 'userName' => 'Till', 'deviceId' => $this->deviceId, 'status' => 'open', 'openedAt' => $now - 7_200_000, 'closedAt' => null,
            'openingIQD' => 50000, 'openingUSD' => 0, 'movements' => [['id' => (string) Str::uuid(), 'type' => 'out', 'amountIQD' => 2000, 'reason' => 'lunch', 'userId' => $till, 'createdAt' => $now - 3_600_000]],
            'countedIQD' => null, 'countedUSD' => null, 'varianceIQD' => null, 'totals' => null, 'note' => '',
        ];
        $this->push([['shift', $shift]]);
        $this->push([['shift', $shift]]); // a resend logs nothing twice
        $open = $this->entry('shift.open');
        $this->assertSame('Till', $open->user_name);
        $this->assertSame($now - 7_200_000, (int) $open->occurred_at);
        $this->assertNotNull($open->device_id);
        $this->assertSame(1, AuditLog::where('action', 'shift.open')->count());
        $this->assertSame(['type' => 'out', 'amount' => 2000, 'reason' => 'lunch'], $this->entry('shift.cash_movement')->meta);
        $this->assertSame($now - 3_600_000, (int) $this->entry('shift.cash_movement')->occurred_at);

        $closed = ['status' => 'closed', 'closedAt' => $now - 60_000, 'countedIQD' => 47000, 'countedUSD' => 0, 'varianceIQD' => -1000, 'totals' => ['expectedIQD' => 48000]] + $shift;
        $this->push([['shift', $closed]]);
        $this->assertSame(['expectedIQD' => 48000, 'countedIQD' => 47000, 'variance' => -1000], $this->entry('shift.close')->meta);

        // a customer added at the till, then their credit limit raised
        $c = ['id' => (string) Str::uuid(), 'name' => 'Road Shop', 'phone' => '0750 000 1111', 'type' => 'shop', 'city' => 'Zakho', 'notes' => '', 'creditLimitIQD' => 100000, 'active' => true, 'createdAt' => $now - 50_000, 'updatedAt' => $now - 50_000];
        $this->push([['customer', $c]]);
        $this->assertSame(['name' => 'Road Shop'], $this->entry('customer.create')->meta);
        $this->push([['customer', ['creditLimitIQD' => 500000, 'updatedAt' => $now + 5_000] + $c]]); // newer than the server's copy
        $upd = $this->entry('customer.update');
        $this->assertSame(['credit_limit_iqd'], $upd->meta['changed']);
        $this->assertSame([100000, 500000], $upd->meta['creditLimit']);
        $this->assertSame('Till', $upd->user_name);

        // a bottle written off as damaged at the till
        $v = $this->variantOf('Khamrah');
        $mv = ['id' => (string) Str::uuid(), 'variantId' => $v->id, 'locationId' => 'loc-store', 'type' => 'damage', 'qty' => -1, 'balanceAfter' => 13, 'refType' => null, 'refId' => null, 'note' => 'dropped', 'userId' => $till, 'createdAt' => $now - 30_000];
        $this->push([['stock_movement', $mv]]);
        $adj = $this->entry('stock.adjust');
        $this->assertSame(['type' => 'damage', 'qty' => -1, 'balance' => 13, 'note' => 'dropped'], $adj->meta);
        $this->assertSame($now - 30_000, (int) $adj->occurred_at);

        // an offline sale is logged when it was made, not when it arrived
        $this->push([['sale', $this->sale($till, $v, $now - 20_000)]]);
        $this->assertSame($now - 20_000, (int) $this->entry('sale.create')->occurred_at);
    }

    public function test_price_and_settings_changes_say_from_what_to_what(): void
    {
        $this->shop();
        $p = $this->api('POST', 'products', [
            'product' => ['name' => ['en' => 'Test Scent', 'ar' => '', 'ku' => ''], 'brand' => 'Lattafa', 'category' => 'perfume', 'gender' => 'unisex', 'concentration' => 'EDP'],
            'variants' => [['label' => '100 ml', 'ml' => 100, 'sku' => 'T-1', 'costIQD' => 10000, 'retailIQD' => 20000, 'wholesaleIQD' => 16000]],
        ])->assertCreated()->json('product');
        $this->api('PUT', "products/{$p['id']}", [
            'product' => ['name' => ['en' => 'Test Scent', 'ar' => '', 'ku' => ''], 'brand' => 'Lattafa', 'category' => 'perfume', 'gender' => 'unisex', 'concentration' => 'EDP'],
            'variants' => [['id' => $p['variants'][0]['id'], 'label' => '100 ml', 'ml' => 100, 'sku' => 'T-1', 'costIQD' => 10000, 'retailIQD' => 25000, 'wholesaleIQD' => 18000]],
        ])->assertOk();
        $this->assertSame([
            ['size' => '100 ml', 'price' => 'retail', 'from' => 20000, 'to' => 25000],
            ['size' => '100 ml', 'price' => 'wholesale', 'from' => 16000, 'to' => 18000],
        ], $this->entry('product.update')->meta['prices']);

        $this->api('PUT', 'settings', ['currency' => ['rate' => 1500], 'store' => ['phone' => '0750 111 2222']])->assertOk();
        $changes = $this->entry('settings.update')->meta['changes'];
        $this->assertSame([1460, 1500], $changes['currency.rate']);
        $this->assertSame(['', '0750 111 2222'], $changes['store.phone']);
        $this->assertArrayNotHasKey('currency.usdEnabled', $changes); // only what changed

        // the customer menu's own settings: one entry (the menu's), carrying the change — no extra "settings changed"
        $before = AuditLog::where('action', 'settings.update')->count();
        $this->api('PUT', 'menu/manage', ['products' => [], 'settings' => ['showPrices' => false]])->assertOk();
        $this->assertSame([true, false], $this->entry('menu.update')->meta['changes']['showPrices']);
        $this->assertSame($before, AuditLog::where('action', 'settings.update')->count());
    }

    public function test_sign_out_and_supervisor_approvals_are_logged(): void
    {
        $this->shop();
        $cashier = $this->makeUser('Lana', 'lana', 'cashier', '4242');
        $this->asUser($cashier, '4242');

        $this->api('POST', 'auth/approve', ['pin' => '9999', 'permission' => 'sales.void'])->assertStatus(403);
        $this->assertSame(['permission' => 'sales.void'], $this->entry('auth.approval_failed')->meta);
        $this->api('POST', 'auth/approve', ['pin' => '1111', 'permission' => 'sales.void'])->assertOk(); // the owner's PIN
        $ok = $this->entry('auth.approval');
        $this->assertSame('Lana', $ok->user_name); // asked for by the cashier…
        $this->assertSame(['permission' => 'sales.void', 'approver' => 'Owner'], $ok->meta); // …approved by the owner

        $this->api('POST', 'auth/logout')->assertOk();
        $this->assertSame('Lana', $this->entry('auth.logout')->user_name);
    }
}
