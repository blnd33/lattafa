<?php

namespace Tests\Feature;

use App\Models\Sale;
use App\Models\User;
use Tests\ApiTestCase;

/** Checkout, payments, discounts, loyalty, credit, void, returns, shifts, visibility and reports. */
class SalesTest extends ApiTestCase
{
    private function cash(int $n): array
    {
        return [['method' => 'cash_iqd', 'tendered' => $n]];
    }

    private function ownerId(): string
    {
        return User::where('username', 'owner')->value('id');
    }

    /* ─────────── checkout ─────────── */

    public function test_checkout_prices_on_the_server_moves_stock_and_returns_change(): void
    {
        $this->shop();
        $v = $this->variantOf('Khamrah'); // 100 ml · 45,000 · 14 in stock
        $this->cashierWithShift();

        $res = $this->checkout($v, 1, $this->cash(50000))->assertCreated();
        $sale = $res->json('sale');
        $this->assertSame(45000, $sale['totalIQD']);
        $this->assertSame(45000, $sale['paidIQD']);
        $this->assertSame(5000, $sale['changeIQD']);
        $this->assertSame('completed', $sale['status']);
        $this->assertMatchesRegularExpression('/^ST1-\d{6}$/', $sale['number']);
        $this->assertSame(13, $this->stockOf($v));
        $this->assertSame(0, $sale['items'][0]['unitCostIQD']); // a cashier never sees cost
        $this->assertNotNull($sale['shiftId']);
        $this->assertSame([], $sale['flags']);
    }

    public function test_receipt_numbers_are_sequential_per_till(): void
    {
        $this->shop();
        $v = $this->variantOf('Khamrah');
        $this->cashierWithShift();
        $a = $this->checkout($v, 1, $this->cash(45000))->json('sale.number');
        $b = $this->checkout($v, 1, $this->cash(45000))->json('sale.number');
        $this->assertSame((int) substr($a, 4) + 1, (int) substr($b, 4));
    }

    public function test_retrying_a_checkout_with_the_same_id_never_double_charges(): void
    {
        $this->shop();
        $v = $this->variantOf('Khamrah');
        $this->cashierWithShift();
        $id = (string) \Illuminate\Support\Str::uuid();
        $first = $this->checkout($v, 2, $this->cash(90000), ['id' => $id])->assertCreated()->json('sale.number');
        $again = $this->checkout($v, 2, $this->cash(90000), ['id' => $id])->assertCreated()->json('sale.number');
        $this->assertSame($first, $again);
        $this->assertSame(12, $this->stockOf($v)); // 14 − 2, not − 4
        $this->assertSame(1, Sale::count());
    }

    public function test_insufficient_stock_rolls_the_whole_cart_back(): void
    {
        $this->shop();
        $khamrah = $this->variantOf('Khamrah');
        $raghba = $this->variantOf('Raghba'); // only 3
        $this->cashierWithShift();

        $this->api('POST', 'sales', [
            'lines' => [['variantId' => $khamrah->id, 'qty' => 1, 'discountPct' => 0], ['variantId' => $raghba->id, 'qty' => 4, 'discountPct' => 0]],
            'giftWrap' => false, 'redeemPoints' => 0, 'payments' => $this->cash(500000),
        ])->assertStatus(422)->assertJsonPath('error.code', 'insufficient_stock');

        $this->assertSame(14, $this->stockOf($khamrah)); // the first line was not left half-applied
        $this->assertSame(3, $this->stockOf($raghba));
        $this->assertSame(0, Sale::count());
    }

    public function test_payment_must_cover_the_total(): void
    {
        $this->shop();
        $v = $this->variantOf('Khamrah');
        $this->cashierWithShift();
        $this->checkout($v, 1, $this->cash(40000))->assertStatus(422)->assertJsonPath('error.code', 'underpayment')->assertJsonPath('error.params.remaining', 5000);
        $this->checkout($v, 1, [['method' => 'card', 'tendered' => 50000]])->assertStatus(422)->assertJsonPath('error.code', 'overpayment_non_cash');
        $this->assertSame(14, $this->stockOf($v));
    }

    public function test_split_payment_card_plus_cash(): void
    {
        $this->shop();
        $v = $this->variantOf('Khamrah');
        $this->cashierWithShift();
        $sale = $this->checkout($v, 1, [['method' => 'card', 'tendered' => 20000, 'reference' => 'AUTH1'], ['method' => 'cash_iqd', 'tendered' => 30000]])->assertCreated()->json('sale');
        $this->assertSame(5000, $sale['changeIQD']);
        $methods = collect($sale['payments'])->pluck('amountIQD', 'method')->all();
        $this->assertSame(20000, $methods['card']);
        $this->assertSame(25000, $methods['cash_iqd']); // cash only counts what was actually needed
    }

    public function test_usd_cash_is_converted_at_the_shop_rate_and_change_is_in_dinar(): void
    {
        $this->shop();
        $v = $this->variantOf('Khamrah');
        $this->cashierWithShift();
        $sale = $this->checkout($v, 1, [['method' => 'cash_usd', 'tendered' => 31]])->assertCreated()->json('sale'); // 31 × 1460 = 45,260
        $this->assertSame(260, $sale['changeIQD']);
        $usd = collect($sale['payments'])->firstWhere('method', 'cash_usd');
        $this->assertSame('USD', $usd['currency']);
        $this->assertSame(1460, $usd['rate']);
        $this->assertSame(45000, $usd['amountIQD']);
    }

    public function test_a_new_shop_sells_without_opening_a_shift(): void
    {
        $this->shop();
        $v = $this->variantOf('Khamrah');
        $id = $this->makeUser('Till', 'till', 'cashier', '2468');
        $this->asUser($id, '2468');
        $sale = $this->checkout($v, 1, $this->cash(50000))->assertCreated()->json('sale');
        $this->assertNull($sale['shiftId']);
        $this->assertNull($this->api('GET', 'shifts/current')->json('shift'));
    }

    public function test_checkout_needs_an_open_shift_and_a_sellable_product(): void
    {
        $this->shop();
        $this->api('PUT', 'settings', ['sales' => ['requireShift' => true]])->assertOk(); // Settings → "Require a shift to sell"
        $v = $this->variantOf('Khamrah');
        $id = $this->makeUser('Till', 'till', 'cashier', '2468');
        $this->asUser($id, '2468');
        $this->checkout($v, 1, $this->cash(50000))->assertStatus(422)->assertJsonPath('error.code', 'shift_required');

        $this->api('POST', 'shifts/open', ['openingIQD' => 0])->assertCreated();
        $this->asOwner();
        $this->api('PATCH', "products/{$v->product_id}/active", ['active' => false])->assertOk();
        $this->asUser($id, '2468');
        $this->checkout($v, 1, $this->cash(50000))->assertStatus(422)->assertJsonPath('error.code', 'product_unavailable');
    }

    public function test_gift_wrap_and_rounding(): void
    {
        $this->shop();
        $v = $this->variantOf('Ana Abiyedh'); // 30,000
        $this->cashierWithShift();
        $sale = $this->checkout($v, 1, $this->cash(40000), ['giftWrap' => true])->assertCreated()->json('sale');
        $this->assertSame(2000, $sale['giftWrapIQD']);
        $this->assertSame(32000, $sale['totalIQD']);
    }

    /* ─────────── discounts & approvals ─────────── */

    public function test_discount_within_the_cashiers_limit_needs_no_approval(): void
    {
        $this->shop();
        $v = $this->variantOf('Khamrah');
        $this->cashierWithShift(10);
        $sale = $this->api('POST', 'sales', ['lines' => [['variantId' => $v->id, 'qty' => 1, 'discountPct' => 10]], 'giftWrap' => false, 'redeemPoints' => 0, 'payments' => $this->cash(40500)])->assertCreated()->json('sale');
        $this->assertSame(40500, $sale['totalIQD']);
        $this->assertSame(4500, $sale['itemDiscountIQD']);
    }

    public function test_discount_above_the_limit_needs_a_real_supervisor(): void
    {
        $this->shop();
        $v = $this->variantOf('Khamrah');
        $cashier = $this->cashierWithShift(10);
        $body = fn (array $extra = []) => $extra + ['lines' => [['variantId' => $v->id, 'qty' => 1, 'discountPct' => 20]], 'giftWrap' => false, 'redeemPoints' => 0, 'payments' => $this->cash(36000)];

        $this->api('POST', 'sales', $body())->assertStatus(403)->assertJsonPath('error.code', 'approval_required');
        // approving yourself (or anyone without the permission) is refused
        $this->api('POST', 'sales', $body(['approvedBy' => ['id' => $cashier]]))->assertStatus(403)->assertJsonPath('error.code', 'approval_invalid');
        $this->assertSame(14, $this->stockOf($v));

        $sale = $this->api('POST', 'sales', $body(['approvedBy' => ['id' => $this->ownerId()]]))->assertCreated()->json('sale');
        $this->assertSame(36000, $sale['totalIQD']);
        $this->assertSame($this->ownerId(), $sale['approvedBy']);
    }

    public function test_order_discount_is_applied_to_the_whole_bill(): void
    {
        $this->shop();
        $v = $this->variantOf('Khamrah');
        $this->cashierWithShift(10);
        $sale = $this->checkout($v, 2, $this->cash(81000), ['orderDiscount' => ['type' => 'pct', 'value' => 10]])->assertCreated()->json('sale');
        $this->assertSame(9000, $sale['orderDiscountIQD']);
        $this->assertSame(81000, $sale['totalIQD']);
    }

    /* ─────────── customers: loyalty & credit ─────────── */

    public function test_loyalty_points_are_earned_and_redeemed(): void
    {
        $this->shop();
        $v = $this->variantOf('Khamrah');
        $zana = $this->customerNamed('Zana Ahmed'); // 320 points
        $this->cashierWithShift();

        $sale = $this->checkout($v, 1, $this->cash(45000), ['customerId' => $zana->id, 'redeemPoints' => 100])->assertCreated()->json('sale');
        $this->assertSame(1000, $sale['pointsRedeemedIQD']); // 100 pts × 10 IQD
        $this->assertSame(44000, $sale['totalIQD']);
        $this->assertSame(44, $sale['pointsEarned']);
        $this->assertSame(320 - 100 + 44, $zana->fresh()->points);

        $this->checkout($v, 1, $this->cash(45000), ['customerId' => $zana->id, 'redeemPoints' => 99999])->assertStatus(422)->assertJsonPath('error.code', 'not_enough_points');
        $this->checkout($v, 1, $this->cash(45000), ['redeemPoints' => 10])->assertStatus(422)->assertJsonPath('error.code', 'loyalty_unavailable');
    }

    public function test_selling_on_credit_needs_a_customer_permission_and_room_under_the_limit(): void
    {
        $this->shop();
        $v = $this->variantOf('Khamrah');
        $noor = $this->customerNamed('Al-Noor Perfumes'); // owes 350,000 · limit 1,000,000
        $zana = $this->customerNamed('Zana Ahmed');       // limit 0
        $noor->update(['credit_limit_iqd' => 400000]);    // room for exactly one more bottle
        $this->cashierWithShift();
        $debt = [['method' => 'debt', 'tendered' => 45000]];

        $this->checkout($v, 1, $debt)->assertStatus(422)->assertJsonPath('error.code', 'customer_required_for_debt');
        $this->checkout($v, 1, $debt, ['customerId' => $zana->id])->assertStatus(422)->assertJsonPath('error.code', 'credit_limit_exceeded');
        $this->checkout($v, 1, $debt, ['customerId' => $noor->id])->assertCreated()->assertJsonPath('sale.dueIQD', 45000);
        $this->assertSame(395000, $noor->fresh()->balance_iqd);

        $this->checkout($v, 1, $debt, ['customerId' => $noor->id])->assertStatus(422)->assertJsonPath('error.code', 'credit_limit_exceeded');
        $this->assertSame(395000, $noor->fresh()->balance_iqd);
        $this->assertSame(13, $this->stockOf($v)); // the refused sale left no trace
    }

    public function test_a_user_without_the_credit_permission_cannot_sell_on_credit(): void
    {
        $this->shop();
        $v = $this->variantOf('Khamrah');
        $noor = $this->customerNamed('Al-Noor Perfumes');
        $id = $this->makeUser('Till', 'till', 'cashier', '2468', ['denies' => ['customers.credit']]);
        $this->asUser($id, '2468');
        $this->api('POST', 'shifts/open', ['openingIQD' => 0])->assertCreated();
        $this->checkout($v, 1, [['method' => 'debt', 'tendered' => 45000]], ['customerId' => $noor->id])->assertStatus(403)->assertJsonPath('error.code', 'forbidden');
    }

    public function test_collecting_a_debt_reduces_the_balance_and_appears_on_the_statement(): void
    {
        $this->shop();
        $noor = $this->customerNamed('Al-Noor Perfumes');
        $this->cashierWithShift();
        $this->api('POST', "customers/{$noor->id}/collect", ['amountIQD' => 100000, 'method' => 'cash_iqd', 'note' => 'part payment'])->assertCreated();
        $this->assertSame(250000, $noor->fresh()->balance_iqd);
        $this->api('POST', "customers/{$noor->id}/collect", ['amountIQD' => 999999, 'method' => 'cash_iqd'])->assertStatus(422)->assertJsonPath('error.code', 'overpayment');

        $rows = collect($this->api('GET', "customers/{$noor->id}/statement")->assertOk()->json('rows'));
        $this->assertSame(-100000, $rows->firstWhere('kind', 'payment')['amountIQD']);

        // the same client-generated id twice is one collection
        $cid = (string) \Illuminate\Support\Str::uuid();
        $this->api('POST', "customers/{$noor->id}/collect", ['amountIQD' => 10000, 'method' => 'cash_iqd', 'id' => $cid])->assertCreated();
        $this->api('POST', "customers/{$noor->id}/collect", ['amountIQD' => 10000, 'method' => 'cash_iqd', 'id' => $cid])->assertCreated();
        $this->assertSame(240000, $noor->fresh()->balance_iqd);
    }

    public function test_customer_crud_rules(): void
    {
        $this->shop();
        $this->cashierWithShift();
        $mk = fn (string $name, string $phone) => $this->api('POST', 'customers', ['name' => $name, 'phone' => $phone, 'type' => 'retail', 'city' => 'Duhok']);
        $id = $mk('Nadia', '0750 999 0000')->assertCreated()->json('customer.id');
        $mk('Other', '0750 999 0000')->assertStatus(422)->assertJsonPath('error.code', 'phone_taken');
        // cashiers can add customers, but editing and deleting them is a manager's job
        $this->api('PUT', "customers/$id", ['name' => 'Nadia', 'phone' => '0750 999 0000', 'type' => 'retail', 'creditLimitIQD' => 500000])->assertStatus(403);
        $this->api('DELETE', "customers/$id")->assertStatus(403);

        $this->asOwner();
        $this->api('PUT', "customers/$id", ['name' => 'Nadia K', 'phone' => '0750 999 0000', 'type' => 'shop', 'creditLimitIQD' => 500000])->assertOk()->assertJsonPath('customer.creditLimitIQD', 500000);
        $this->api('DELETE', "customers/$id")->assertOk();
        $this->assertNotContains($id, collect($this->api('GET', 'customers')->json('customers'))->pluck('id')->all());
    }

    /* ─────────── void ─────────── */

    public function test_void_needs_a_supervisor_and_puts_everything_back(): void
    {
        $this->shop();
        $v = $this->variantOf('Khamrah');
        $noor = $this->customerNamed('Al-Noor Perfumes');
        $this->cashierWithShift();
        $sale = $this->checkout($v, 2, [['method' => 'debt', 'tendered' => 90000]], ['customerId' => $noor->id])->assertCreated()->json('sale');
        $this->assertSame(12, $this->stockOf($v));
        $this->assertSame(440000, $noor->fresh()->balance_iqd);

        $this->api('POST', "sales/{$sale['id']}/void", ['reason' => 'wrong item'])->assertStatus(403)->assertJsonPath('error.code', 'approval_required');
        $this->api('POST', "sales/{$sale['id']}/void", ['reason' => 'wrong item', 'approvedBy' => ['id' => $this->ownerId()]])->assertOk()->assertJsonPath('sale.status', 'voided');
        $this->assertSame(14, $this->stockOf($v));
        $this->assertSame(350000, $noor->fresh()->balance_iqd);
        $this->api('POST', "sales/{$sale['id']}/void", ['reason' => 'again', 'approvedBy' => ['id' => $this->ownerId()]])->assertStatus(422)->assertJsonPath('error.code', 'sale_not_voidable');
    }

    public function test_the_owner_can_void_directly_and_a_reason_is_mandatory(): void
    {
        $this->shop();
        $v = $this->variantOf('Khamrah');
        $this->cashierWithShift();
        $sale = $this->checkout($v, 1, $this->cash(45000))->json('sale');
        $this->asOwner();
        $this->api('POST', "sales/{$sale['id']}/void", ['reason' => ''])->assertStatus(422);
        $this->api('POST', "sales/{$sale['id']}/void", ['reason' => 'customer changed mind'])->assertOk()->assertJsonPath('sale.voidReason', 'customer changed mind');
    }

    /* ─────────── returns ─────────── */

    public function test_partial_then_full_return_restocks_and_tracks_status(): void
    {
        $this->shop();
        $v = $this->variantOf('Khamrah');
        $this->cashierWithShift();
        $sale = $this->checkout($v, 2, $this->cash(90000))->json('sale');

        $r1 = $this->api('POST', 'returns', ['saleId' => $sale['id'], 'lines' => [['saleItemIndex' => 0, 'qty' => 1, 'restock' => true, 'reason' => 'gift']], 'refundMethod' => 'cash_iqd'])->assertCreated()->json('return');
        $this->assertSame(45000, $r1['refundIQD']);
        $this->assertSame(13, $this->stockOf($v));
        $this->assertSame('partially_returned', $this->api('GET', "sales/{$sale['id']}")->json('sale.status'));
        $this->assertSame(1, $this->api('GET', "sales/{$sale['id']}")->json('sale.items.0.returnedQty'));

        $this->api('POST', 'returns', ['saleId' => $sale['id'], 'lines' => [['saleItemIndex' => 0, 'qty' => 2]], 'refundMethod' => 'cash_iqd'])->assertStatus(422)->assertJsonPath('error.code', 'invalid_quantity');
        $this->api('POST', 'returns', ['saleId' => $sale['id'], 'lines' => [['saleItemIndex' => 0, 'qty' => 1, 'restock' => false]], 'refundMethod' => 'cash_iqd'])->assertCreated();
        $this->assertSame(13, $this->stockOf($v)); // damaged: refunded but not put back on the shelf
        $this->assertSame('returned', $this->api('GET', "sales/{$sale['id']}")->json('sale.status'));
        $this->assertCount(2, $this->api('GET', 'returns')->json('returns'));
    }

    public function test_a_return_refunds_the_discounted_price_not_the_shelf_price(): void
    {
        $this->shop();
        $v = $this->variantOf('Khamrah');
        $this->cashierWithShift(10);
        $sale = $this->checkout($v, 1, $this->cash(40500), ['orderDiscount' => ['type' => 'pct', 'value' => 10]])->assertCreated()->json('sale');
        $this->assertSame(40500, $sale['totalIQD']);
        $ret = $this->api('POST', 'returns', ['saleId' => $sale['id'], 'lines' => [['saleItemIndex' => 0, 'qty' => 1]], 'refundMethod' => 'cash_iqd'])->assertCreated()->json('return');
        $this->assertSame(40500, $ret['refundIQD']);
    }

    public function test_large_refunds_and_late_returns_need_a_supervisor(): void
    {
        $this->shop();
        $v = $this->variantOf('Khamrah');
        $this->cashierWithShift(10, 30000);
        $sale = $this->checkout($v, 1, $this->cash(45000))->json('sale');
        $body = ['saleId' => $sale['id'], 'lines' => [['saleItemIndex' => 0, 'qty' => 1]], 'refundMethod' => 'cash_iqd'];

        $this->api('POST', 'returns', $body)->assertStatus(403)->assertJsonPath('error.code', 'approval_required');
        $this->api('POST', 'returns', $body + ['approvedBy' => ['id' => $this->ownerId()]])->assertCreated()->assertJsonPath('return.approvedBy', $this->ownerId());
    }

    public function test_cannot_return_a_voided_sale_or_reduce_debt_without_one(): void
    {
        $this->shop();
        $v = $this->variantOf('Khamrah');
        $this->cashierWithShift();
        $sale = $this->checkout($v, 1, $this->cash(45000))->json('sale');
        $this->api('POST', 'returns', ['saleId' => $sale['id'], 'lines' => [['saleItemIndex' => 0, 'qty' => 1]], 'refundMethod' => 'debt_reduction'])->assertStatus(422)->assertJsonPath('error.code', 'customer_required_for_debt');

        $this->api('POST', "sales/{$sale['id']}/void", ['reason' => 'x', 'approvedBy' => ['id' => $this->ownerId()]])->assertOk();
        $this->api('POST', 'returns', ['saleId' => $sale['id'], 'lines' => [['saleItemIndex' => 0, 'qty' => 1]], 'refundMethod' => 'cash_iqd'])->assertStatus(422)->assertJsonPath('error.code', 'sale_voided');
    }

    public function test_returning_against_a_debt_sale_reduces_what_the_customer_owes(): void
    {
        $this->shop();
        $v = $this->variantOf('Khamrah');
        $noor = $this->customerNamed('Al-Noor Perfumes');
        $this->cashierWithShift();
        $sale = $this->checkout($v, 1, [['method' => 'debt', 'tendered' => 45000]], ['customerId' => $noor->id])->json('sale');
        $this->api('POST', 'returns', ['saleId' => $sale['id'], 'lines' => [['saleItemIndex' => 0, 'qty' => 1]], 'refundMethod' => 'debt_reduction'])->assertCreated();
        $this->assertSame(350000, $noor->fresh()->balance_iqd);
    }

    /* ─────────── shifts ─────────── */

    public function test_shift_lifecycle_with_cash_movements_and_variance(): void
    {
        $this->shop();
        $this->api('PUT', 'settings', ['sales' => ['requireShift' => true]])->assertOk();
        $v = $this->variantOf('Khamrah');
        $this->cashierWithShift(); // opened with 50,000
        $this->assertNotNull($this->api('GET', 'shifts/current')->json('shift'));
        $this->api('POST', 'shifts/open', ['openingIQD' => 1])->assertStatus(422)->assertJsonPath('error.code', 'shift_already_open');
        // a plain cashier can't move cash in/out of the drawer — it takes an explicit grant
        $this->api('POST', 'shifts/cash-movements', ['type' => 'out', 'amountIQD' => 3000, 'reason' => 'lunch'])->assertStatus(403);

        $this->api('POST', 'shifts/close', ['countedIQD' => 50000])->assertOk();
        $this->asOwner();
        $id = $this->makeUser('Lead', 'lead', 'cashier', '9753', ['grants' => ['shifts.cash_movement']]);
        $this->asUser($id, '9753');
        $this->api('POST', 'shifts/open', ['openingIQD' => 50000])->assertCreated();

        $this->checkout($v, 1, $this->cash(50000))->assertCreated(); // +45,000 net cash (5,000 change)
        $this->api('POST', 'shifts/cash-movements', ['type' => 'out', 'amountIQD' => 3000, 'reason' => 'lunch'])->assertOk();
        $this->api('POST', 'shifts/cash-movements', ['type' => 'in', 'amountIQD' => 1000, 'reason' => 'float top-up'])->assertOk();
        $this->api('POST', 'shifts/cash-movements', ['type' => 'out', 'amountIQD' => 100, 'reason' => ''])->assertStatus(422);

        $t = $this->api('GET', 'shifts/current')->json('totals');
        $this->assertSame(1, $t['salesCount']);
        $this->assertSame(45000, $t['cashIQD']);
        $this->assertSame(50000 + 45000 + 1000 - 3000, $t['expectedIQD']); // 93,000

        $closed = $this->api('POST', 'shifts/close', ['countedIQD' => 92000, 'note' => 'short 1000'])->assertOk()->json('shift');
        $this->assertSame('closed', $closed['status']);
        $this->assertSame(-1000, $closed['varianceIQD']);
        $this->assertNull($this->api('GET', 'shifts/current')->json('shift'));
        $this->checkout($v, 1, $this->cash(45000))->assertStatus(422)->assertJsonPath('error.code', 'shift_required');
    }

    public function test_cashiers_only_see_their_own_shifts_and_sales(): void
    {
        $this->shop();
        $v = $this->variantOf('Khamrah');
        $this->cashierWithShift(pin: '2468');
        $mine = $this->checkout($v, 1, $this->cash(45000))->json('sale');

        $this->asOwner();
        $other = $this->makeUser('Other', 'othr', 'cashier', '1357');
        $this->asUser($other, '1357');
        $this->api('POST', 'shifts/open', ['openingIQD' => 0])->assertCreated();
        $this->assertCount(0, $this->api('GET', 'sales')->json('sales'));
        $this->api('GET', "sales/{$mine['id']}")->assertStatus(403);
        $this->assertCount(1, $this->api('GET', 'shifts')->json('shifts'));

        $this->asOwner();
        $this->assertCount(1, $this->api('GET', 'sales')->json('sales'));
        $this->assertCount(2, $this->api('GET', 'shifts')->json('shifts'));
        // a receipt can be found by its number too (scanned barcode)
        $this->api('GET', 'sales/'.strtolower($mine['number']))->assertOk()->assertJsonPath('sale.id', $mine['id']);
    }

    /* ─────────── reports ─────────── */

    public function test_sales_report_totals_and_cost_visibility(): void
    {
        $this->shop();
        $v = $this->variantOf('Khamrah'); // cost 27,000
        $this->cashierWithShift();
        $this->checkout($v, 2, $this->cash(90000))->assertCreated();
        $sale = $this->checkout($v, 1, $this->cash(45000))->json('sale');
        $this->api('POST', 'returns', ['saleId' => $sale['id'], 'lines' => [['saleItemIndex' => 0, 'qty' => 1]], 'refundMethod' => 'cash_iqd'])->assertCreated();

        $this->api('GET', 'reports/sales')->assertStatus(403); // cashier has no reports.view

        $this->asOwner();
        $r = $this->api('GET', 'reports/sales')->assertOk()->json('report');
        $this->assertSame(2, $r['count']);
        $this->assertSame(135000, $r['revenueIQD']);
        $this->assertSame(45000, $r['refundsIQD']);
        $this->assertSame(90000, $r['netIQD']);
        $this->assertSame(3, $r['unitsSold']);
        $this->assertSame(2 * 27000, $r['costIQD']);   // 3 sold − 1 returned
        $this->assertSame(90000 - 54000, $r['profitIQD']);

        // a manager sees the numbers but profit needs reports.financial
        $mgr = $this->makeUser('Boss', 'boss', 'manager', '6666', ['denies' => ['reports.financial']]);
        $this->asUser($mgr, '6666');
        $r = $this->api('GET', 'reports/sales')->assertOk()->json('report');
        $this->assertNull($r['profitIQD']);
        $this->api('GET', 'reports/stock-valuation')->assertStatus(403);
    }

    public function test_debtors_report_lists_customers_who_owe(): void
    {
        $this->shop();
        $rows = $this->api('GET', 'reports/debtors')->assertOk()->json('customers');
        $this->assertSame(['Al-Noor Perfumes'], collect($rows)->pluck('name')->all());
        $val = $this->api('GET', 'reports/stock-valuation')->assertOk()->json();
        $this->assertGreaterThan($val['costIQD'], $val['retailIQD']);
    }
}
