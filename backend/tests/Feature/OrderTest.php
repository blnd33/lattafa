<?php

namespace Tests\Feature;

use App\Models\Customer;
use App\Models\Order;
use App\Models\Variant;
use Tests\ApiTestCase;

/** Orders shops send from the customer menu: anyone may send one, delegates take them, the first one wins. */
class OrderTest extends ApiTestCase
{
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

    /** @param array<int, array{variantId: string, qty: int}> $items */
    private function place(array $items, array $over = []): \Illuminate\Testing\TestResponse
    {
        return $this->postJson('/api/v1/orders', $over + [
            'shopName' => 'Al-Noor Perfumes', 'phone' => '0750 111 2233', 'note' => 'before Thursday', 'items' => $items,
        ]);
    }

    public function test_a_shop_orders_from_the_menu_without_signing_in(): void
    {
        $this->shop();
        $kh = $this->variantOf('Khamrah');
        $as = $this->variantOf('Asad');

        $res = $this->place([['variantId' => $kh->id, 'qty' => 6], ['variantId' => $as->id, 'qty' => 3]])->assertCreated();
        $this->assertSame(1, $res->json('order.number'));   // the number the shop quotes on the phone
        $this->assertNull($res->json('order.id'));          // and nothing else about the shop's own order comes back

        $order = Order::first();
        $this->assertSame(['new', 9, 'Al-Noor Perfumes', 'before Thursday'], [$order->status, $order->units, $order->shop_name, $order->note]);
        $this->assertSame([6, 3], array_column($order->items, 'qty'));
        $this->assertSame($kh->sku, $order->items[0]['sku']);     // what was ordered is kept as it was that day

        // an order for something not on sale is refused outright, and nothing is written
        $gone = Variant::whereKey($as->id)->first();
        $gone->update(['active' => false]);
        $this->place([['variantId' => $gone->id, 'qty' => 1]])->assertStatus(422)->assertJsonPath('error.code', 'product_unavailable');
        $this->place([])->assertStatus(422);
        $this->place([['variantId' => $kh->id, 'qty' => 0]])->assertStatus(422);
        $this->assertSame(1, Order::count());
    }

    public function test_a_shop_already_on_file_is_recognised_by_its_phone(): void
    {
        $this->shop();
        $noor = Customer::where('name', 'like', 'Al-Noor%')->first();
        $noor->update(['phone' => '0750 111 2233']);

        $this->place([['variantId' => $this->variantOf('Khamrah')->id, 'qty' => 2]])->assertCreated();
        $this->assertSame($noor->id, Order::first()->customer_id);

        // an unknown phone is still a perfectly good order, just not tied to anyone
        $this->place([['variantId' => $this->variantOf('Khamrah')->id, 'qty' => 1]], ['phone' => '0770 999 8877'])->assertCreated();
        $this->assertNull(Order::orderByDesc('number')->first()->customer_id);
    }

    public function test_the_delegate_takes_the_order_and_the_second_one_is_told_it_is_gone(): void
    {
        $this->shop();
        $ahmed = $this->delegate();
        $sara = $this->makeUser('Sara', 'sara', 'delegate', '6262');
        $this->place([['variantId' => $this->variantOf('Khamrah')->id, 'qty' => 4]])->assertCreated();
        $id = Order::first()->id;

        // both delegates see it waiting
        $this->asDelegate($ahmed);
        $this->assertSame(1, $this->api('GET', 'orders')->assertOk()->json('waiting'));
        $this->assertSame('Al-Noor Perfumes', $this->api('GET', 'orders')->json('orders.0.shopName'));
        $this->assertSame(1, $this->api('GET', 'orders/waiting')->assertOk()->json('waiting'));

        $this->api('POST', "orders/{$id}/accept")->assertOk()->assertJsonPath('order.status', 'accepted')->assertJsonPath('order.handledByName', 'Ahmed');

        // the one who was slower is told who took it, and nothing changes
        $this->asDelegate($sara, '6262');
        $this->api('POST', "orders/{$id}/accept")->assertStatus(409)->assertJsonPath('error.code', 'order_taken')->assertJsonPath('error.params.by', 'Ahmed');
        $this->assertSame(0, $this->api('GET', 'orders/waiting')->json('waiting'));
        $this->assertSame($ahmed, Order::whereKey($id)->value('handled_by'));
    }

    public function test_an_order_can_be_refused_with_a_reason_and_the_owner_sees_everything(): void
    {
        $this->shop();
        $ahmed = $this->delegate();
        $this->place([['variantId' => $this->variantOf('Khamrah')->id, 'qty' => 2]])->assertCreated();
        $id = Order::first()->id;

        $this->asDelegate($ahmed);
        $this->api('POST', "orders/{$id}/refuse", ['reason' => 'They still owe for the last one'])->assertOk()
            ->assertJsonPath('order.status', 'refused')->assertJsonPath('order.refuseReason', 'They still owe for the last one');

        $this->asOwner();
        $list = $this->api('GET', 'orders')->assertOk();
        $this->assertSame([0, 'refused', 'Ahmed'], [$list->json('waiting'), $list->json('orders.0.status'), $list->json('orders.0.handledByName')]);
        $this->assertSame(1, count($this->api('GET', 'orders?status=refused')->json('orders')));
        $this->assertSame(0, count($this->api('GET', 'orders?status=new')->json('orders')));
    }

    public function test_the_dollar_price_list_is_set_on_the_delegate_side_only(): void
    {
        $this->shop();
        $kham = Variant::where('sku', 'LTF-KHAM-100')->first();
        $retailBefore = $kham->retail_iqd;

        // the shop's perfumes are the list; none of them has a dollar price to begin with
        $prices = $this->api('GET', 'delegate-prices')->assertOk()->json('prices');
        $mine = collect($prices)->firstWhere('sku', 'LTF-KHAM-100');
        $this->assertSame([0, $retailBefore], [$mine['usdCents'], $mine['retailIQD']]);

        $this->api('PUT', 'delegate-prices', ['prices' => [['variantId' => $kham->id, 'usdCents' => 2370]]])->assertOk()->assertJsonPath('changed', 1);
        $this->assertSame(2370, $kham->fresh()->wholesale_usd_cents);
        $this->assertSame($retailBefore, $kham->fresh()->retail_iqd);   // the shop's dinar price never moves
        $this->api('PUT', 'delegate-prices', ['prices' => [['variantId' => $kham->id, 'usdCents' => 2370]]])->assertOk()->assertJsonPath('changed', 0);

        // what it costs us, in dollars, sits beside the selling price — and only that figure moves
        $costBefore = $kham->fresh()->cost_iqd;
        $this->api('PUT', 'delegate-prices', ['prices' => [['variantId' => $kham->id, 'costCents' => 1454]]])->assertOk()->assertJsonPath('changed', 1);
        $this->assertSame([1454, 2370, $costBefore], [$kham->fresh()->cost_usd_cents, $kham->fresh()->wholesale_usd_cents, $kham->fresh()->cost_iqd]);
        $row = collect($this->api('GET', 'delegate-prices')->json('prices'))->firstWhere('sku', 'LTF-KHAM-100');
        $this->assertSame([1454, 2370], [$row['costCents'], $row['usdCents']]);   // he sees both

        // the delegate can set them too; a cashier at the till cannot even look
        $ahmed = $this->delegate();
        $this->asDelegate($ahmed);
        $this->api('PUT', 'delegate-prices', ['prices' => [['variantId' => $kham->id, 'usdCents' => 2500]]])->assertOk();
        $this->assertSame(2500, $kham->fresh()->wholesale_usd_cents);

        $this->asOwner();
        $cashier = $this->makeUser('Ali', 'alii', 'cashier', '3333');
        $this->asUser($cashier, '3333');
        $this->api('GET', 'delegate-prices')->assertStatus(403);
        $this->api('PUT', 'delegate-prices', ['prices' => [['variantId' => $kham->id, 'usdCents' => 1]]])->assertStatus(403);
        $this->assertSame(2500, $kham->fresh()->wholesale_usd_cents);
    }

    public function test_the_delegate_adds_a_perfume_from_his_phone_and_it_shares_the_shop_s_stock(): void
    {
        $this->shop();
        $ahmed = $this->delegate();
        $this->asDelegate($ahmed);

        $v = $this->api('POST', 'delegate-products', ['nameEn' => 'Road Special', 'nameAr' => 'خاص الطريق', 'size' => 100, 'unit' => 'ml', 'usdCents' => 1850, 'openingStock' => 12])
            ->assertCreated()->json('variant');
        $this->assertSame(['1850 cents', '100 ml'], [$v['wholesaleUSDCents'].' cents', $v['label']]);
        $this->assertStringStartsWith('DLG-ROAD-SPECIAL', $v['sku']);
        $this->assertNotSame('', $v['barcode']);                       // it can be scanned like any other

        // it is the shop's one list and one stock: the till sees it, with 12 bottles
        $this->asOwner();
        $stored = Variant::whereKey($v['id'])->first();
        $this->assertSame(12, $this->stockOf($stored));
        $onTill = collect($this->api('GET', 'products')->json('products'))->flatMap(fn ($p) => $p['variants'])->firstWhere('sku', $v['sku']);
        $this->assertSame(12, $onTill['stock']);
        // the shop may reprice it in dinars without touching the delegate's dollar price
        $stored->update(['retail_iqd' => 40000]);
        $this->assertSame([40000, 1850], [$stored->fresh()->retail_iqd, $stored->fresh()->wholesale_usd_cents]);

        // a cashier still cannot add one this way
        $cashier = $this->makeUser('Ali', 'alii', 'cashier', '3333');
        $this->asUser($cashier, '3333');
        $this->api('POST', 'delegate-products', ['nameEn' => 'Nope', 'usdCents' => 100])->assertStatus(403);
        // and a nameless one is refused
        $this->asDelegate($ahmed);
        $this->api('POST', 'delegate-products', ['usdCents' => 100])->assertStatus(422)->assertJsonPath('error.code', 'required_fields');
    }

    public function test_only_delegates_and_managers_may_see_or_work_orders(): void
    {
        $this->shop();
        $cashier = $this->makeUser('Ali', 'alii', 'cashier', '3333');
        $this->place([['variantId' => $this->variantOf('Khamrah')->id, 'qty' => 1]])->assertCreated();
        $id = Order::first()->id;

        $this->asUser($cashier, '3333');
        $this->api('GET', 'orders')->assertStatus(403);
        $this->api('POST', "orders/{$id}/accept")->assertStatus(403);
        $this->assertSame('new', Order::whereKey($id)->value('status'));
    }
}
