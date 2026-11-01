<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Role;
use App\Models\StockMovement;
use App\Models\Variant;
use Illuminate\Support\Facades\DB;
use Tests\ApiTestCase;

/** Suppliers, purchase orders, receiving into stock, and what the shop owes. */
class PurchasingTest extends ApiTestCase
{
    private function supplier(string $name = 'Dubai Perfume House', string $currency = 'USD'): string
    {
        return $this->api('POST', 'suppliers', ['name' => $name, 'currency' => $currency, 'phone' => '+971 50 000 0000'])->assertCreated()->json('supplier.id');
    }

    private function item(array $order, Variant $v): int
    {
        return collect($order['items'])->firstWhere('variantId', $v->id)['id'];
    }

    public function test_an_order_arrives_in_two_parts_and_the_shop_owes_what_came(): void
    {
        $this->shop();
        $kh = $this->variantOf('Khamrah');
        $asad = $this->variantOf('Asad');
        [$khBefore, $asadBefore] = [$this->stockOf($kh), $this->stockOf($asad)];
        $sup = $this->supplier();

        $o = $this->api('POST', 'purchase-orders', ['supplierId' => $sup, 'rate' => 1500, 'note' => 'Autumn stock', 'lines' => [
            ['variantId' => $kh->id, 'qty' => 10, 'unitCost' => 18.5], ['variantId' => $asad->id, 'qty' => 6, 'unitCost' => 12],
        ]])->assertCreated()->json('order');
        $this->assertSame(['PO-000001', 'open', 'USD', 1500, 257.0, 16, 0], [$o['number'], $o['status'], $o['currency'], $o['rate'], (float) $o['total'], $o['units'], $o['receivedUnits']]);
        $this->assertSame($khBefore, $this->stockOf($kh)); // ordering alone changes nothing in the shop

        // the first box: 4 Khamrah
        $o = $this->api('POST', "purchase-orders/{$o['id']}/receive", ['lines' => [['itemId' => $this->item($o, $kh), 'qty' => 4]]])->assertOk()->json('order');
        $this->assertSame(['partial', 4, 74.0], [$o['status'], $o['receivedUnits'], (float) $o['receivedTotal']]);
        $this->assertSame($khBefore + 4, $this->stockOf($kh));
        $this->assertSame(27750, Variant::find($kh->id)->cost_iqd); // $18.50 × 1,500
        $mv = StockMovement::where('variant_id', $kh->id)->where('ref_type', 'purchase_receipt')->sole(); // every bottle can be explained
        $this->assertSame(['purchase', 4, 'PO-000001'], [$mv->type, (int) $mv->qty, $mv->note]);

        // more than is still coming is refused
        $this->api('POST', "purchase-orders/{$o['id']}/receive", ['lines' => [['itemId' => $this->item($o, $kh), 'qty' => 7]]])
            ->assertStatus(422)->assertJsonPath('error.code', 'over_received')->assertJsonPath('error.params.left', 6);

        // the rest; the invoice says Asad went up to $12.50, at a new rate
        $o = $this->api('POST', "purchase-orders/{$o['id']}/receive", ['rate' => 1520, 'lines' => [
            ['itemId' => $this->item($o, $kh), 'qty' => 6], ['itemId' => $this->item($o, $asad), 'qty' => 6, 'unitCost' => 12.5],
        ]])->assertOk()->json('order');
        $this->assertSame(['received', 16], [$o['status'], $o['receivedUnits']]);
        $this->assertNotNull($o['closedAt']);
        $this->assertCount(2, $o['receipts']);
        $this->assertSame([$khBefore + 10, $asadBefore + 6], [$this->stockOf($kh), $this->stockOf($asad)]);
        $this->assertSame(19000, Variant::find($asad->id)->cost_iqd); // $12.50 × 1,520
        $this->api('POST', "purchase-orders/{$o['id']}/receive", ['lines' => [['itemId' => $this->item($o, $kh), 'qty' => 1]]])->assertStatus(422)->assertJsonPath('error.code', 'order_locked');

        // owed: 74 + 6 × 18.5 + 6 × 12.5 = 260 dollars
        $st = $this->api('GET', "suppliers/$sup/statement")->assertOk()->json();
        $this->assertSame(260.0, (float) $st['balance']);
        $this->assertSame(['receipt', 'receipt'], array_column($st['rows'], 'type'));

        $pay = $this->api('POST', "suppliers/$sup/payments", ['amount' => 100, 'method' => 'bank', 'rate' => 1500, 'note' => 'Transfer #44', 'purchaseOrderId' => $o['id']])->assertCreated()->json('payment');
        $this->assertSame([100.0, 'USD', 150000], [(float) $pay['amount'], $pay['currency'], $pay['amountIQD']]);
        $st = $this->api('GET', "suppliers/$sup/statement")->json();
        $this->assertSame(160.0, (float) $st['balance']);
        $this->assertSame(['payment', 160.0], [$st['rows'][0]['type'], (float) $st['rows'][0]['balance']]); // newest first, with the running balance
        $this->assertSame('PO-000001', $st['rows'][0]['orderNumber']);
        $row = collect($this->api('GET', 'suppliers')->json('suppliers'))->firstWhere('id', $sup);
        $this->assertSame([160.0, 0], [(float) $row['balance'], $row['openOrders']]);

        $d = $this->api('GET', 'dashboard')->json();
        $this->assertSame([160.0, 0, 1460 * 160], [(float) $d['suppliers']['owedUSD'], $d['suppliers']['owedIQD'], $d['suppliers']['totalIQD']]);
        $this->assertSame(0, $d['attention']['ordersWaiting']);

        // a payment typed by mistake can be taken back; the activity log remembers it
        $this->api('DELETE', "supplier-payments/{$pay['id']}")->assertOk();
        $this->assertSame(260.0, (float) $this->api('GET', "suppliers/$sup/statement")->json('balance'));
        $this->assertSame(1, AuditLog::where('action', 'supplier.payment_delete')->count());

        // the currency is fixed once there are orders
        $this->api('PUT', "suppliers/$sup", ['name' => 'Dubai Perfume House', 'currency' => 'IQD'])->assertStatus(422)->assertJsonPath('error.code', 'supplier_currency_locked');
        $this->assertSame(['purchase.order', 'purchase.receive'], AuditLog::whereIn('action', ['purchase.order', 'purchase.receive'])->orderBy('occurred_at')->pluck('action')->unique()->values()->all());
    }

    public function test_receive_now_edit_cancel_and_close(): void
    {
        $this->shop();
        $yara = $this->variantOf('Yara');
        $before = $this->stockOf($yara);
        $sup = $this->supplier('Erbil Wholesale', 'IQD');

        // the goods came with the invoice: one step
        $o = $this->api('POST', 'purchase-orders', ['supplierId' => $sup, 'receiveNow' => true, 'lines' => [['variantId' => $yara->id, 'qty' => 5, 'unitCost' => 25000.4]]])->assertCreated()->json('order');
        $this->assertSame(['received', 125000.0], [$o['status'], (float) $o['receivedTotal']]); // whole dinars
        $this->assertSame($before + 5, $this->stockOf($yara));
        $this->assertSame(25000, Variant::find($yara->id)->cost_iqd);
        $this->assertSame(125000.0, (float) $this->api('GET', "suppliers/$sup/statement")->json('balance'));

        // an order nothing arrived for can still change, then be cancelled
        $o2 = $this->api('POST', 'purchase-orders', ['supplierId' => $sup, 'lines' => [['variantId' => $yara->id, 'qty' => 2, 'unitCost' => 24000]]])->json('order');
        $this->assertSame('PO-000002', $o2['number']);
        $o2 = $this->api('PUT', "purchase-orders/{$o2['id']}", ['lines' => [['variantId' => $yara->id, 'qty' => 3, 'unitCost' => 24000]]])->assertOk()->json('order');
        $this->assertSame(72000.0, (float) $o2['total']);
        $this->assertSame('cancelled', $this->api('POST', "purchase-orders/{$o2['id']}/cancel")->assertOk()->json('order.status'));
        $this->api('PUT', "purchase-orders/{$o2['id']}", ['lines' => [['variantId' => $yara->id, 'qty' => 1, 'unitCost' => 1]]])->assertStatus(422)->assertJsonPath('error.code', 'order_locked');

        // part came, the rest never will: closed
        $o3 = $this->api('POST', 'purchase-orders', ['supplierId' => $sup, 'lines' => [['variantId' => $yara->id, 'qty' => 4, 'unitCost' => 24000]]])->json('order');
        $o3 = $this->api('POST', "purchase-orders/{$o3['id']}/receive", ['lines' => [['itemId' => $o3['items'][0]['id'], 'qty' => 1]]])->json('order');
        $this->api('PUT', "purchase-orders/{$o3['id']}", ['lines' => [['variantId' => $yara->id, 'qty' => 9, 'unitCost' => 1]]])->assertStatus(422);
        $this->assertSame('closed', $this->api('POST', "purchase-orders/{$o3['id']}/cancel")->json('order.status'));

        $this->assertSame(['PO-000003'], collect($this->api('GET', 'purchase-orders?status=received')->json('orders'))->where('status', 'closed')->pluck('number')->all());
        $this->assertCount(0, $this->api('GET', 'purchase-orders?status=waiting')->json('orders'));
        $this->assertCount(3, $this->api('GET', "purchase-orders?supplierId=$sup")->json('orders'));

        // a supplier the shop stopped buying from takes no new orders
        $this->api('PUT', "suppliers/$sup", ['name' => 'Erbil Wholesale', 'currency' => 'IQD', 'active' => false])->assertOk();
        $this->api('POST', 'purchase-orders', ['supplierId' => $sup, 'lines' => [['variantId' => $yara->id, 'qty' => 1, 'unitCost' => 1]]])->assertStatus(422)->assertJsonPath('error.code', 'supplier_inactive');
    }

    public function test_stock_keepers_order_and_receive_but_only_managers_pay(): void
    {
        $this->shop();
        $sup = $this->supplier();
        $kh = $this->variantOf('Khamrah');
        $keeper = $this->makeUser('Kawa', 'kawa', 'stock_keeper', '3579');
        $this->asUser($keeper, '3579');
        $o = $this->api('POST', 'purchase-orders', ['supplierId' => $sup, 'lines' => [['variantId' => $kh->id, 'qty' => 2, 'unitCost' => 18]]])->assertCreated()->json('order');
        $this->api('POST', "purchase-orders/{$o['id']}/receive", ['lines' => [['itemId' => $o['items'][0]['id'], 'qty' => 2]]])->assertOk();
        $this->api('POST', "suppliers/$sup/payments", ['amount' => 10, 'method' => 'cash'])->assertStatus(403)->assertJsonPath('error.params.permission', 'purchasing.pay');

        $this->asOwner();
        $this->cashierWithShift();
        $this->api('GET', 'suppliers')->assertStatus(403);
        $this->api('GET', 'purchase-orders')->assertStatus(403);
    }

    public function test_shops_set_up_earlier_get_the_new_permissions(): void
    {
        $this->shop(false);
        $strip = fn (string $key) => Role::where('key', $key)->firstOrFail()->update(['permissions' => array_values(array_filter(
            Role::where('key', $key)->value('permissions'), fn ($p) => ! str_starts_with($p, 'purchasing.') && ! str_starts_with($p, 'expenses.'),
        ))]);
        $strip('manager');
        $strip('stock_keeper');
        $this->assertNotContains('purchasing.pay', Role::where('key', 'manager')->value('permissions'));

        (require database_path('migrations/2026_10_10_100003_upgrade_system_roles_for_purchasing.php'))->up();

        $manager = Role::where('key', 'manager')->value('permissions');
        foreach (['purchasing.view', 'purchasing.manage', 'purchasing.pay', 'expenses.view', 'expenses.manage'] as $p) {
            $this->assertContains($p, $manager);
        }
        $keeper = Role::where('key', 'stock_keeper')->value('permissions');
        $this->assertContains('purchasing.manage', $keeper);
        $this->assertNotContains('purchasing.pay', $keeper);
        $this->assertNotContains('expenses.view', $keeper);
        $this->assertSame(['*'], Role::where('key', 'super_admin')->value('permissions'));
        $this->assertSame(1, DB::table('roles')->where('key', 'manager')->count());
    }
}
