<?php

namespace Tests\Feature;

use App\Models\Customer;
use App\Models\Device;
use App\Models\Role;
use App\Models\Variant;
use App\Support\Time;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\ApiTestCase;

/** The admin panel: who may sign in to it, and its dashboard. */
class AdminPanelTest extends ApiTestCase
{
    private const DAY = 86_400_000;

    /** A paid bill as a till or a delegate phone sends it through sync. */
    private function syncedSale(string $uid, string $name, Variant $v, int $qty, int $unit, string $channel, int $at): array
    {
        $total = $unit * $qty;

        return [
            'id' => (string) Str::uuid(), 'number' => ($channel === 'delegate' ? 'DL1-' : 'ST9-').str_pad((string) random_int(1, 999999), 6, '0', STR_PAD_LEFT),
            'shiftId' => null, 'userId' => $uid, 'userName' => $name, 'customerId' => null, 'customerName' => '', 'channel' => $channel, 'status' => 'completed',
            'items' => [['variantId' => $v->id, 'productId' => $v->product_id, 'name' => $v->product->name, 'brand' => $v->product->brand, 'label' => $v->label, 'sku' => $v->sku, 'barcode' => $v->barcode,
                'qty' => $qty, 'unitPriceIQD' => $unit, 'unitCostIQD' => 0, 'discountPct' => 0, 'discountIQD' => 0, 'lineTotalIQD' => $total, 'returnedQty' => 0]],
            'subtotalIQD' => $total, 'itemDiscountIQD' => 0, 'orderDiscountIQD' => 0, 'orderDiscount' => null, 'giftWrapIQD' => 0, 'taxIQD' => 0, 'roundingIQD' => 0, 'pointsRedeemedIQD' => 0,
            'totalIQD' => $total, 'payments' => [['method' => 'cash_iqd', 'amountIQD' => $total, 'tendered' => $total, 'currency' => 'IQD', 'rate' => 1460, 'reference' => '']],
            'paidIQD' => $total, 'changeIQD' => 0, 'dueIQD' => 0, 'pointsEarned' => 0, 'pointsRedeemed' => 0, 'exchangeRate' => 1460, 'note' => '', 'approvedBy' => null,
            'deviceId' => $this->deviceId, 'createdAt' => $at, 'voidedAt' => null, 'voidReason' => '',
        ];
    }

    private function push(array $sale): void
    {
        $this->api('POST', 'sync/push', ['items' => [['entity' => 'sale', 'id' => $sale['id'], 'data' => $sale]]])->assertOk()->assertJsonPath('results.0.status', 'ok');
    }

    public function test_the_admin_panel_lets_in_admin_roles_and_never_registers_the_computer_as_a_till(): void
    {
        $this->shop(false);
        $this->makeUser('Sara', 'sara', 'cashier', '2468');
        $this->makeUser('Kawa', 'kawa', 'stock_keeper', '3579');
        $tills = Device::count();
        $laptop = (string) Str::uuid(); // a computer at home, never seen before

        $r = $this->withHeaders(['X-Device-Id' => $laptop])->postJson('/api/v1/auth/login', ['username' => 'owner', 'password' => 'Owner1234', 'app' => 'admin', 'deviceId' => $laptop])->assertOk();
        $this->assertNull($r->json('device'));
        $this->assertSame($tills, Device::count());           // not registered as a till
        $this->assertNull(Device::find($laptop));
        $this->api('GET', 'dashboard', [], ['Authorization' => 'Bearer '.$r->json('token')])->assertOk();

        $this->postJson('/api/v1/auth/login', ['username' => 'kawa', 'password' => 'Passw0rd!x', 'app' => 'admin'])->assertOk(); // stock keepers have the admin panel
        $this->postJson('/api/v1/auth/login', ['username' => 'sara', 'password' => 'Passw0rd!x', 'app' => 'admin'])
            ->assertStatus(403)->assertJsonPath('error.code', 'app_not_allowed');                                             // cashiers do not
        $this->postJson('/api/v1/auth/login', ['username' => 'owner', 'password' => 'Owner1234', 'app' => 'nope'])->assertStatus(422);
    }

    public function test_the_dashboard_adds_up_the_shop_and_the_delegates(): void
    {
        $this->shop();
        $now = Time::nowMs();
        $khamrah = $this->variantOf('Khamrah');
        $owner = \App\Models\User::where('username', 'owner')->value('id');

        // today: a bill at the counter…
        $cashier = $this->cashierWithShift();
        $store = $this->checkout($khamrah, 2, [['method' => 'cash_iqd', 'tendered' => 2 * $khamrah->retail_iqd]])->assertCreated()->json('sale.totalIQD');
        // …and one from a delegate's van
        $this->asOwner();
        $ahmed = $this->makeUser('Ahmed', 'ahmed', 'delegate', '5151');
        $this->api('POST', "delegates/$ahmed/load", ['items' => [['variantId' => $khamrah->id, 'qty' => 5]]])->assertOk();
        $res = $this->api('POST', 'auth/pin-login', ['userId' => $ahmed, 'pin' => '5151', 'app' => 'delegate'], [])->assertOk();
        $this->auth = ['Authorization' => 'Bearer '.$res->json('token')];
        $this->push($this->syncedSale($ahmed, 'Ahmed', $khamrah, 1, $khamrah->wholesale_iqd, 'delegate', $now - 60_000));
        // three days ago: a till bill that only counts for the week
        $this->asOwner();
        $old = $this->syncedSale($owner, 'Owner', $khamrah, 1, $khamrah->retail_iqd, 'store', $now - 3 * self::DAY);
        $this->push($old);

        $d = $this->api('GET', 'dashboard?period=today')->assertOk()->json();
        $this->assertSame(['count' => 1, 'revenueIQD' => $store], $d['channels']['store']);
        $this->assertSame(['count' => 1, 'revenueIQD' => $khamrah->wholesale_iqd], $d['channels']['delegate']);
        $this->assertSame(2, $d['totals']['count']);
        $this->assertSame(3, $d['totals']['unitsSold']);
        $revenue = $store + $khamrah->wholesale_iqd;
        $this->assertSame($revenue, $d['totals']['revenueIQD']);
        $this->assertSame($revenue - 3 * $khamrah->cost_iqd, $d['totals']['profitIQD']); // the owner sees profit
        $this->assertSame(0, $d['previous']['count']);                                     // nothing yesterday by this time
        $this->assertSame('hour', $d['series']['unit']);
        $this->assertSame($revenue, collect($d['series']['points'])->sum(fn ($p) => $p['storeIQD'] + $p['delegateIQD']));
        $this->assertSame('Khamrah', $d['topProducts'][0]['name']['en']);
        $this->assertSame(3, $d['topProducts'][0]['units']);
        $this->assertSame(['Ahmed', $khamrah->wholesale_iqd, 1], [$d['delegates'][0]['name'], $d['delegates'][0]['salesIQD'], $d['delegates'][0]['salesCount']]);
        $owing = Customer::where('active', true)->where('balance_iqd', '>', 0);
        $this->assertSame([(int) $owing->sum('balance_iqd'), $owing->count()], [$d['debts']['totalIQD'], $d['debts']['customers']]);
        $low = DB::table('variants')->where('active', true)->get()->filter(fn ($v) => (int) DB::table('stock')->where('variant_id', $v->id)->where('location_id', 'loc-store')->value('qty') <= $v->min_stock)->count();
        $this->assertSame($low, $d['lowStock']['count']);
        $this->assertSame(['openRequests' => 0, 'pendingClosings' => 0, 'salesToReview' => DB::table('sales')->where('needs_review', true)->count(), 'ordersWaiting' => 0], $d['attention']);

        $w = $this->api('GET', 'dashboard?period=week')->assertOk()->json();
        $this->assertSame(3, $w['totals']['count']);                 // + the bill from three days ago
        $this->assertSame('day', $w['series']['unit']);
        $this->assertCount(7, $w['series']['points']);
        $this->assertSame(Time::at($now)->format('Y-m-d'), end($w['series']['points'])['key']);
        $this->assertSame($khamrah->retail_iqd, collect($w['series']['points'])->firstWhere('key', Time::at($now - 3 * self::DAY)->format('Y-m-d'))['storeIQD']);
        $this->assertCount(30, $this->api('GET', 'dashboard?period=month')->json('series.points'));
        $this->api('GET', 'dashboard?period=year')->assertStatus(422);

        // a return gives the money back and its cost back
        $this->auth = $this->pinSession($cashier, '2468');
        $sale = \App\Models\Sale::where('channel', 'store')->where('sold_at', '>', Time::startOfDayMs())->firstOrFail();
        $this->api('POST', 'returns', ['saleId' => $sale->id, 'lines' => [['saleItemIndex' => 0, 'qty' => 1, 'restock' => true, 'reason' => '']], 'refundMethod' => 'cash_iqd', 'note' => ''])->assertCreated();
        $this->asOwner();
        $after = $this->api('GET', 'dashboard?period=today')->json('totals');
        $this->assertSame($khamrah->retail_iqd, $after['refundsIQD']);
        $this->assertSame($revenue - $khamrah->retail_iqd - 2 * $khamrah->cost_iqd, $after['profitIQD']);
    }

    public function test_a_flagged_sale_is_checked_once_and_leaves_the_list(): void
    {
        $this->shop();
        $owner = \App\Models\User::where('username', 'owner')->value('id');
        $khamrah = $this->variantOf('Khamrah');
        // an offline till sold far more than the shop had: the server keeps the sale and flags it
        $sale = $this->syncedSale($owner, 'Owner', $khamrah, 500, $khamrah->retail_iqd, 'store', Time::nowMs() - 60_000);
        $this->push($sale);
        $listed = collect($this->api('GET', 'sales/review')->assertOk()->json('sales'))->firstWhere('id', $sale['id']);
        $this->assertContains('negative_stock', $listed['flags']);
        $this->assertTrue($listed['needsReview']);
        $before = $this->api('GET', 'dashboard')->json('attention.salesToReview');
        $this->assertGreaterThanOrEqual(1, $before);

        $cashier = $this->cashierWithShift();
        $this->api('POST', "sales/{$sale['id']}/reviewed", ['note' => 'x'])->assertStatus(403);

        $this->asOwner();
        $checked = $this->api('POST', "sales/{$sale['id']}/reviewed", ['note' => 'Counted the shelf: it was a delivery not entered yet'])->assertOk()->json('sale');
        $this->assertFalse($checked['needsReview']);
        $this->assertSame(['negative_stock'], array_values(array_intersect(['negative_stock'], $checked['flags']))); // the flags stay
        $this->assertSame($owner, $checked['reviewedBy']);
        $this->assertNotNull($checked['reviewedAt']);
        $this->assertNull(collect($this->api('GET', 'sales/review')->json('sales'))->firstWhere('id', $sale['id']));
        $this->assertSame($before - 1, $this->api('GET', 'dashboard')->json('attention.salesToReview'));

        $this->api('POST', "sales/{$sale['id']}/reviewed")->assertOk(); // a second click changes nothing
        $log = \App\Models\AuditLog::where('action', 'sale.reviewed')->sole();
        $this->assertSame($sale['number'], $log->meta['number']);
        $this->assertSame('Counted the shelf: it was a delivery not entered yet', $log->meta['note']);
        $this->api('POST', 'sales/'.Str::uuid().'/reviewed')->assertNotFound();
        unset($cashier);
    }

    public function test_people_only_see_the_parts_their_permissions_allow(): void
    {
        $this->shop();
        $role = $this->api('POST', 'roles', ['name' => 'Viewer', 'description' => '', 'permissions' => ['reports.view'], 'apps' => ['admin']])->assertCreated()->json('role.id');
        $viewer = $this->makeUser('Lana', 'lana', 'cashier', '4242', ['roleId' => $role]);
        $this->asUser($viewer, '4242');
        $d = $this->api('GET', 'dashboard?period=week')->assertOk()->json();
        $this->assertFalse($d['financial']);
        $this->assertNull($d['totals']['profitIQD']);
        $this->assertNull($d['previous']['profitIQD']);
        $this->assertNull($d['lowStock']);
        $this->assertNull($d['delegates']);
        $this->assertNull($d['debts']);
        $this->assertSame(['openRequests' => null, 'pendingClosings' => null, 'salesToReview' => null, 'ordersWaiting' => null], $d['attention']);
        $this->assertNull($d['expensesIQD']);
        $this->assertNull($d['suppliers']);

        $this->asOwner();
        $this->cashierWithShift(pin: '2580');
        $this->api('GET', 'dashboard')->assertStatus(403);
    }
}
