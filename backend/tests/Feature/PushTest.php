<?php

namespace Tests\Feature;

use App\Models\PushSubscription;
use Tests\ApiTestCase;

/** Being told about new orders with the app closed. Off until the shop sets up the keys — and off must never break anything. */
class PushTest extends ApiTestCase
{
    private array $sub = [
        'endpoint' => 'https://fcm.googleapis.com/fcm/send/abc-123',
        'p256dh' => 'BExampleKeyExampleKeyExampleKeyExampleKeyExampleKeyExampleKeyExampleKeyExampleKeyEx',
        'auth' => 'ExampleAuthToken1234',
    ];

    public function test_without_keys_the_apps_are_told_it_is_off_and_orders_still_work(): void
    {
        $this->shop();
        config(['push.public' => '', 'push.private' => '']);

        $this->api('GET', 'push/key')->assertOk()->assertJsonPath('enabled', false);
        // an order still goes through: nothing about notifications may stop a shop ordering
        $this->postJson('/api/v1/orders', ['shopName' => 'Al-Noor', 'phone' => '0750 111 2233', 'items' => [['variantId' => $this->variantOf('Khamrah')->id, 'qty' => 1]]])
            ->assertCreated();
    }

    public function test_a_phone_subscribes_once_and_can_stop(): void
    {
        $this->shop();
        config(['push.public' => 'test-public-key', 'push.private' => 'test-private-key']);
        $this->api('GET', 'push/key')->assertOk()->assertJsonPath('enabled', true)->assertJsonPath('publicKey', 'test-public-key');

        $this->api('POST', 'push/subscribe', $this->sub + ['app' => 'delegate'])->assertOk();
        $this->api('POST', 'push/subscribe', $this->sub + ['app' => 'delegate'])->assertOk(); // the same browser again
        $this->assertSame(1, PushSubscription::count());

        $this->api('POST', 'push/unsubscribe', ['endpoint' => $this->sub['endpoint']])->assertOk();
        $this->assertSame(0, PushSubscription::count());
    }

    public function test_only_a_signed_in_person_may_subscribe(): void
    {
        $this->shop();
        $this->postJson('/api/v1/push/subscribe', $this->sub)->assertStatus(401);
        $this->postJson('/api/v1/orders', ['shopName' => 'x'])->assertStatus(422); // and the public order route still validates
    }
}
