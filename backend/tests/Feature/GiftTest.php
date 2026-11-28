<?php

namespace Tests\Feature;

use App\Models\Sale;
use App\Models\User;
use App\Models\Variant;
use Illuminate\Support\Str;
use Tests\ApiTestCase;

/**
 * A perfume given as a gift at the till: the customer pays nothing for it, the bottle leaves stock, and the shop's
 * profit goes down by what the bottle COST — never by its selling price. Giving one is for managers; a cashier needs
 * a manager's PIN.
 */
class GiftTest extends ApiTestCase
{
    /** Two Khamrah paid, a third given as a gift. */
    private function giftSale(Variant $v, array $over = [])
    {
        return $this->api('POST', 'sales', $over + [
            'lines' => [['variantId' => $v->id, 'qty' => 3, 'discountPct' => 0, 'giftQty' => 1]], 'redeemPoints' => 0,
            'payments' => [['method' => 'cash_iqd', 'tendered' => 2 * $v->retail_iqd]],
        ]);
    }

    public function test_a_gift_is_free_leaves_stock_and_costs_the_shop_its_cost_price(): void
    {
        $this->shop();
        $kh = $this->variantOf('Khamrah');
        $before = $this->stockOf($kh);
        $this->asOwner();
        $sale = $this->giftSale($kh)->assertCreated()->json('sale');

        // the bill: two paid, one on its own line at 0
        $this->assertSame(2 * $kh->retail_iqd, $sale['totalIQD']);
        $this->assertSame([[2, false, 2 * $kh->retail_iqd], [1, true, 0]], array_map(fn ($i) => [$i['qty'], $i['gift'], $i['lineTotalIQD']], $sale['items']));
        $this->assertSame($kh->retail_iqd, $sale['items'][1]['unitPriceIQD'], 'the gift keeps its price, to show what it was worth');
        $this->assertSame($before - 3, $this->stockOf($kh), 'all three bottles left the shelf');

        // profit: two sold, three paid for — the gift costs the shop exactly one bottle's cost
        $t = $this->api('GET', 'dashboard?period=today')->assertOk()->json('totals');
        $this->assertSame(2 * $kh->retail_iqd - 3 * $kh->cost_iqd, $t['profitIQD']);
        $this->assertSame(2 * $kh->retail_iqd, $t['revenueIQD']);
        $this->assertSame([2, $kh->cost_iqd, 1], [$t['unitsSold'], $t['giftsCostIQD'], $t['giftUnits']]);

        // giving a gift back refunds nothing; its cost comes back off the gifts
        $r = $this->api('POST', 'returns', ['saleId' => $sale['id'], 'lines' => [['saleItemIndex' => 1, 'qty' => 1, 'restock' => true]], 'refundMethod' => 'cash_iqd'])->assertCreated()->json('return');
        $this->assertSame(0, $r['refundIQD']);
        $this->assertSame($before - 2, $this->stockOf($kh));
    }

    public function test_a_cashier_needs_a_managers_pin_to_give_a_gift(): void
    {
        $this->shop();
        $kh = $this->variantOf('Khamrah');
        $cashier = $this->cashierWithShift();
        $this->giftSale($kh)->assertStatus(403)->assertJsonPath('error.code', 'approval_required')->assertJsonPath('error.params.permission', 'sales.gift');

        // a manager's approval lets it through, and is kept on the bill
        $owner = User::where('username', 'owner')->first();
        $sale = $this->giftSale($kh, ['approvedBy' => ['id' => $owner->id, 'name' => $owner->name]])->assertCreated()->json('sale');
        $this->assertSame($owner->id, Sale::find($sale['id'])->approved_by);
        unset($cashier);

        // more gifts than bottles, or a negative count, is refused
        $this->asOwner();
        $this->api('POST', 'sales', ['lines' => [['variantId' => $kh->id, 'qty' => 1, 'giftQty' => 2]], 'redeemPoints' => 0, 'payments' => []])->assertStatus(422);
    }

    public function test_managers_may_give_gifts_and_cashiers_may_not(): void
    {
        $this->shop();
        $roles = collect($this->api('GET', 'roles')->assertOk()->json('roles'))->keyBy('key');
        $this->assertContains('sales.gift', $roles['manager']['permissions']);
        $this->assertNotContains('sales.gift', $roles['cashier']['permissions']);
    }

    public function test_a_till_sale_with_a_gift_is_recorded_and_flagged_when_nobody_allowed_it(): void
    {
        $this->shop();
        $kh = $this->variantOf('Khamrah');
        $cashier = $this->cashierWithShift();
        $till = function (?string $approvedBy) use ($kh, $cashier) {
            $paid = $kh->retail_iqd;
            $item = fn (int $qty, bool $gift) => [
                'variantId' => $kh->id, 'productId' => $kh->product_id, 'name' => $kh->product->name, 'brand' => 'Lattafa', 'label' => $kh->label, 'sku' => $kh->sku,
                'barcode' => $kh->barcode, 'qty' => $qty, 'unitPriceIQD' => $kh->retail_iqd, 'unitCostIQD' => 0, 'discountPct' => 0, 'discountIQD' => 0,
                'lineTotalIQD' => $gift ? 0 : $paid, 'returnedQty' => 0, 'gift' => $gift,
            ];

            return [
                'id' => (string) Str::uuid(), 'number' => 'ST1-8'.random_int(10000, 99999), 'shiftId' => null, 'userId' => $cashier, 'userName' => 'Till',
                'customerId' => null, 'customerName' => '', 'channel' => 'store', 'status' => 'completed', 'items' => [$item(1, false), $item(1, true)],
                'subtotalIQD' => $paid, 'itemDiscountIQD' => 0, 'orderDiscountIQD' => 0, 'orderDiscount' => null, 'giftWrapIQD' => 0, 'taxIQD' => 0, 'roundingIQD' => 0,
                'pointsRedeemedIQD' => 0, 'totalIQD' => $paid,
                'payments' => [['method' => 'cash_iqd', 'amountIQD' => $paid, 'tendered' => $paid, 'currency' => 'IQD', 'rate' => 1460, 'reference' => '']],
                'paidIQD' => $paid, 'changeIQD' => 0, 'dueIQD' => 0, 'pointsEarned' => 0, 'pointsRedeemed' => 0, 'exchangeRate' => 1460, 'note' => '', 'approvedBy' => $approvedBy,
                'deviceId' => $this->deviceId, 'createdAt' => (int) (microtime(true) * 1000), 'voidedAt' => null, 'voidReason' => '',
            ];
        };

        $s = $till(null);
        $r = $this->api('POST', 'sync/push', ['items' => [['entity' => 'sale', 'id' => $s['id'], 'data' => $s]]])->assertOk()->json('results.0');
        $this->assertSame(['ok', ['gift_not_allowed']], [$r['status'], $r['flags']], 'the arithmetic adds up; only the permission is missing');
        $this->assertSame([false, true], Sale::find($s['id'])->items()->orderBy('position')->pluck('is_gift')->all());

        $owner = User::where('username', 'owner')->first();
        $s = $till($owner->id);
        $r = $this->api('POST', 'sync/push', ['items' => [['entity' => 'sale', 'id' => $s['id'], 'data' => $s]]])->assertOk()->json('results.0');
        $this->assertSame([], $r['flags']);
    }

    public function test_a_gift_stays_a_gift_when_the_bill_is_corrected(): void
    {
        $this->shop();
        $kh = $this->variantOf('Khamrah');
        $this->asOwner();
        $sale = $this->giftSale($kh)->assertCreated()->json('sale');
        // the paid line should have been one bottle, not two
        $fixed = $this->api('POST', "sales/{$sale['id']}/correct", ['lines' => [['index' => 0, 'qty' => 1]], 'reason' => 'typed 2'])->assertOk()->json('sale');
        $this->assertSame($kh->retail_iqd, $fixed['totalIQD']);
        $this->assertSame([[1, false], [1, true]], array_map(fn ($i) => [$i['qty'], $i['gift']], $fixed['items']));
    }

    public function test_the_reports_show_gifts_at_cost_apart_from_what_was_sold(): void
    {
        $this->shop();
        $kh = $this->variantOf('Khamrah');
        $this->asOwner();
        $sale = $this->giftSale($kh)->assertCreated()->json('sale');

        // profit & loss: cost of the bottles sold, and the gifts on a line of their own; the profit is down by the gift's cost
        $pl = collect($this->api('GET', 'reports/table/profit-loss')->assertOk()->json('rows'))->keyBy('item');
        $this->assertSame([2 * $kh->retail_iqd, -2 * $kh->cost_iqd, -$kh->cost_iqd, 2 * $kh->retail_iqd - 3 * $kh->cost_iqd],
            [$pl['pl.sales']['amount'], $pl['pl.cogs']['amount'], $pl['pl.gifts']['amount'], $pl['pl.gross_profit']['amount']]);

        // by product: two sold, one gifted, and the gift's cost is in the perfume's cost
        $row = collect($this->api('GET', 'reports/table/sales-by-product')->assertOk()->json('rows'))->firstWhere('sku', $kh->sku);
        $this->assertSame([2, 1, 2 * $kh->retail_iqd, 3 * $kh->cost_iqd], [$row['units'], $row['gifted'], $row['revenue'], $row['cost']]);
        $this->assertSame(2, $this->api('GET', 'reports/table/sales-by-day')->json('totals.units'));

        // the gifts report: one bottle, its value and its cost
        $g = $this->api('GET', 'reports/table/gifts')->assertOk()->json();
        $this->assertSame([1, $kh->retail_iqd, $kh->cost_iqd, $sale['number'], 'Owner'], [$g['rows'][0]['qty'], $g['rows'][0]['value'], $g['rows'][0]['cost'], $g['rows'][0]['number'], $g['rows'][0]['by']]);

        // given back: it leaves the gifts report and its cost comes off the gifts line
        $this->api('POST', 'returns', ['saleId' => $sale['id'], 'lines' => [['saleItemIndex' => 1, 'qty' => 1, 'restock' => true]], 'refundMethod' => 'cash_iqd'])->assertCreated();
        $this->assertSame([], $this->api('GET', 'reports/table/gifts')->json('rows'));
        $pl = collect($this->api('GET', 'reports/table/profit-loss')->json('rows'))->keyBy('item');
        $this->assertArrayNotHasKey('pl.gifts', $pl->all());
    }
}
