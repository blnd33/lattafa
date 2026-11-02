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
