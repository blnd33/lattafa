<?php

namespace Tests;

use App\Models\Customer;
use App\Models\Product;
use App\Models\Role;
use App\Models\User;
use App\Models\Variant;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;

/**
 * Base for API feature tests: real HTTP-level requests with real Sanctum tokens against an in-memory database.
 */
abstract class ApiTestCase extends TestCase
{
    use RefreshDatabase;

    protected string $deviceId;

    /** @var array<string, string> Authorization header of whoever is "signed in" */
    protected array $auth = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->deviceId = (string) Str::uuid();
    }

    /** Runs first-run setup with demo data and signs in as the Super Admin. */
    protected function shop(bool $demo = true): void
    {
        $res = $this->postJson('/api/v1/setup', [
            'store' => ['name' => 'Lattafa Test', 'city' => 'Duhok'], 'rate' => 1460,
            'admin' => ['name' => 'Owner', 'username' => 'owner', 'password' => 'Owner1234', 'pin' => '1111'],
            'demoData' => $demo, 'deviceId' => $this->deviceId, 'deviceName' => 'Counter 1',
        ])->assertCreated();
        $this->auth = ['Authorization' => 'Bearer '.$res->json('token')];
    }

    /** @param array<string, mixed> $data */
    protected function api(string $method, string $uri, array $data = [], ?array $auth = null): TestResponse
    {
        $headers = ($auth ?? $this->auth) + ['X-Device-Id' => $this->deviceId, 'Accept' => 'application/json'];
        // the app instance is reused across calls in one test, so drop the previous request's resolved user
        $this->app['auth']->forgetGuards();

        return $this->json($method, '/api/v1/'.ltrim($uri, '/'), $data, $headers);
    }

    /** Creates an account as the current user and returns its id. */
    protected function makeUser(string $name, string $username, string $roleKey, string $pin, array $extra = []): string
    {
        $role = Role::where('key', $roleKey)->firstOrFail();

        return $this->api('POST', 'users', $extra + [
            'name' => $name, 'username' => $username, 'roleId' => $role->id, 'active' => true, 'pin' => $pin, 'password' => 'Passw0rd!x',
            'grants' => [], 'denies' => [], 'limits' => ['maxDiscountPct' => 10, 'maxRefundIQD' => 100000],
        ])->assertCreated()->json('user.id');
    }

    /** Signs in with a PIN on the registered till and returns the auth header. */
    protected function pinSession(string $userId, string $pin): array
    {
        $res = $this->api('POST', 'auth/pin-login', ['userId' => $userId, 'pin' => $pin], [])->assertOk();

        return ['Authorization' => 'Bearer '.$res->json('token')];
    }

    protected function asUser(string $userId, string $pin): void
    {
        $this->auth = $this->pinSession($userId, $pin);
    }

    protected function asOwner(): void
    {
        $res = $this->api('POST', 'auth/login', ['username' => 'owner', 'password' => 'Owner1234'], [])->assertOk();
        $this->auth = ['Authorization' => 'Bearer '.$res->json('token')];
    }

    protected function variantOf(string $productEn, int $index = 0): Variant
    {
        $p = Product::all()->first(fn (Product $p) => $p->name['en'] === $productEn);

        return $p->variants()->orderByDesc('ml')->get()[$index];
    }

    /** Units in the shop (not in delegates' vans). */
    protected function stockOf(Variant $v): int
    {
        return (int) \DB::table('stock')->where('variant_id', $v->id)->where('location_id', 'loc-store')->value('qty');
    }

    protected function customerNamed(string $name): Customer
    {
        return Customer::where('name', $name)->firstOrFail();
    }

    /** A cashier with an open shift; leaves the session as that cashier. Returns their user id. */
    protected function cashierWithShift(int $maxDiscount = 10, int $maxRefund = 100000, string $pin = '2468'): string
    {
        $id = $this->makeUser('Till', 'till', 'cashier', $pin, ['limits' => ['maxDiscountPct' => $maxDiscount, 'maxRefundIQD' => $maxRefund]]);
        $this->asUser($id, $pin);
        $this->api('POST', 'shifts/open', ['openingIQD' => 50000, 'openingUSD' => 0])->assertCreated();

        return $id;
    }

    /** @param array<string, mixed> $over */
    protected function checkout(Variant $v, int $qty, array $payments, array $over = []): TestResponse
    {
        return $this->api('POST', 'sales', $over + [
            'lines' => [['variantId' => $v->id, 'qty' => $qty, 'discountPct' => 0]], 'giftWrap' => false, 'redeemPoints' => 0, 'payments' => $payments,
        ]);
    }
}
