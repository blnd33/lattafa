<?php

namespace Tests\Feature;

use App\Models\Product;
use Illuminate\Support\Facades\Storage;
use Tests\ApiTestCase;

/** Cross-cutting behaviour: CORS, product photos, error shape, settings. */
class PlatformTest extends ApiTestCase
{
    // 1×1 transparent PNG
    private const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

    private function productBody(array $product = []): array
    {
        return [
            'product' => $product + ['name' => ['en' => 'Photo Test'], 'brand' => 'Lattafa', 'category' => 'perfume', 'gender' => 'unisex', 'concentration' => 'EDP'],
            'variants' => [['label' => '100 ml', 'ml' => 100, 'sku' => 'PH-1', 'costIQD' => 1, 'retailIQD' => 2000, 'openingStock' => 1]],
        ];
    }

    public function test_cors_allows_the_pos_origin_and_the_device_header_but_not_strangers(): void
    {
        $ok = $this->call('OPTIONS', '/api/v1/sync/push', [], [], [], [
            'HTTP_ORIGIN' => 'http://localhost:5173', 'HTTP_ACCESS_CONTROL_REQUEST_METHOD' => 'POST', 'HTTP_ACCESS_CONTROL_REQUEST_HEADERS' => 'authorization,content-type,x-device-id',
        ]);
        $ok->assertStatus(204);
        $this->assertSame('http://localhost:5173', $ok->headers->get('Access-Control-Allow-Origin'));
        $this->assertStringContainsStringIgnoringCase('x-device-id', (string) $ok->headers->get('Access-Control-Allow-Headers'));

        $bad = $this->call('OPTIONS', '/api/v1/sync/push', [], [], [], [
            'HTTP_ORIGIN' => 'https://evil.example', 'HTTP_ACCESS_CONTROL_REQUEST_METHOD' => 'POST',
        ]);
        $this->assertNull($bad->headers->get('Access-Control-Allow-Origin'));
    }

    public function test_product_photo_is_stored_verified_and_replaced(): void
    {
        Storage::fake('public');
        $this->shop(false);
        $body = $this->productBody(['image' => 'data:image/png;base64,'.self::PNG]);
        $p = $this->api('POST', 'products', $body)->assertCreated()->json('product');

        $this->assertNotEmpty($p['image']);
        $path = Product::find($p['id'])->image_path;
        Storage::disk('public')->assertExists($path);
        $this->assertStringEndsWith('.png', $path);

        // sending back the URL it already has changes nothing
        $body['product']['image'] = $p['image'];
        $body['variants'][0]['id'] = $p['variants'][0]['id'];
        $this->api('PUT', "products/{$p['id']}", $body)->assertOk();
        $this->assertSame($path, Product::find($p['id'])->image_path);

        // a new photo replaces (and removes) the old file; null removes the photo
        $body['product']['image'] = 'data:image/png;base64,'.self::PNG;
        $this->api('PUT', "products/{$p['id']}", $body)->assertOk();
        Storage::disk('public')->assertMissing($path);
        $new = Product::find($p['id'])->image_path;
        Storage::disk('public')->assertExists($new);

        $body['product']['image'] = null;
        $this->api('PUT', "products/{$p['id']}", $body)->assertOk()->assertJsonPath('product.image', null);
        Storage::disk('public')->assertMissing($new);
    }

    public function test_fake_images_are_refused(): void
    {
        Storage::fake('public');
        $this->shop(false);
        $html = base64_encode('<script>alert(1)</script>');
        foreach (['data:image/png;base64,'.$html, 'data:image/svg+xml;base64,'.$html, 'data:image/png;base64,!!!not-base64!!!'] as $img) {
            $this->api('POST', 'products', $this->productBody(['image' => $img]))->assertStatus(422)->assertJsonPath('error.code', 'image_invalid');
        }
        $this->assertSame(0, Product::count());
        $this->assertSame([], Storage::disk('public')->allFiles());
    }

    public function test_validation_errors_use_the_standard_shape(): void
    {
        $this->shop(false);
        $res = $this->api('POST', 'products', ['product' => ['name' => ['en' => 'x']]])->assertStatus(422);
        $res->assertJsonPath('error.code', 'validation');
        $this->assertArrayHasKey('product.brand', $res->json('error.fields')); // per-field messages sit next to `params`
        $this->api('GET', 'nope')->assertStatus(404)->assertJsonPath('error.code', 'not_found');
        $this->api('DELETE', 'health')->assertStatus(405);
    }

    public function test_settings_are_deep_merged_validated_and_never_expose_setup_flag_changes(): void
    {
        $this->shop(false);
        $s = $this->api('PUT', 'settings', ['loyalty' => ['pointsPer1000IQD' => 2], 'setupDone' => false, 'receipt' => ['footer' => ['en' => 'Thanks!']]])->assertOk()->json('settings');
        $this->assertSame(2, $s['loyalty']['pointsPer1000IQD']);
        $this->assertTrue($s['loyalty']['enabled']);                  // untouched sibling survives
        $this->assertSame('Thanks!', $s['receipt']['footer']['en']);
        $this->assertSame('شكراً لاختياركم لطافة', $s['receipt']['footer']['ar']); // untouched language survives
        $this->assertTrue($s['setupDone']);                            // the flag can't be switched off through the API
        $this->assertSame(2, $this->api('GET', 'settings')->json('settings.loyalty.pointsPer1000IQD'));
    }

    public function test_receipt_currency_and_sales_settings_are_editable_and_take_effect(): void
    {
        $this->shop();
        $s = $this->api('PUT', 'settings', [
            'store' => ['name' => 'Lattafa Duhok', 'phone' => '0750 730 8005'],
            'receipt' => ['header' => 'Welcome', 'showQr' => false, 'copies' => 2, 'paperMm' => 58],
            'currency' => ['usdEnabled' => false, 'rounding' => 500],
            'sales' => ['giftWrapFeeIQD' => 3000, 'allowNegativeStock' => true, 'requireShift' => false],
            'bogus' => ['injected' => true],
        ])->assertOk()->json('settings');
        $this->assertSame('Lattafa Duhok', $s['store']['name']);
        $this->assertSame('Duhok', $s['store']['city']); // untouched sibling
        $this->assertSame(['Welcome', false, 2, 58], [$s['receipt']['header'], $s['receipt']['showQr'], $s['receipt']['copies'], $s['receipt']['paperMm']]);
        $this->assertFalse($s['currency']['usdEnabled']);
        $this->assertSame(1460, $s['currency']['rate']);
        $this->assertSame([3000, true, false], [$s['sales']['giftWrapFeeIQD'], $s['sales']['allowNegativeStock'], $s['sales']['requireShift']]);
        $this->assertArrayNotHasKey('bogus', $s);

        $this->api('PUT', 'settings', ['currency' => ['rate' => 0]])->assertStatus(422);
        $this->api('PUT', 'settings', ['receipt' => ['paperMm' => 70]])->assertStatus(422);

        // and the till really obeys them: no USD, no shift needed, 500-dinar rounding, may sell into negative stock
        $v = $this->variantOf('Raghba'); // 36,000 · 3 in stock
        $id = $this->makeUser('Till', 'till', 'cashier', '2468');
        $this->asUser($id, '2468');
        $this->checkout($v, 1, [['method' => 'cash_usd', 'tendered' => 30]])->assertStatus(422)->assertJsonPath('error.code', 'usd_disabled');
        $sale = $this->checkout($v, 4, [['method' => 'cash_iqd', 'tendered' => 144000]])->assertCreated()->json('sale'); // no shift, 1 more than in stock
        $this->assertNull($sale['shiftId']);
        $this->assertSame(['negative_stock'], $sale['flags']);
        $this->assertSame(-1, $this->stockOf($v));
    }

    public function test_day_boundaries_follow_the_shops_timezone(): void
    {
        $this->assertSame('Asia/Baghdad', config('app.timezone'));
        $ms = \Illuminate\Support\Carbon::parse('2026-09-29 22:30:00', 'UTC')->getTimestampMs(); // 01:30 on the 30th in Duhok (UTC+3)
        $fmt = fn (int $t) => \Illuminate\Support\Carbon::createFromTimestampMs($t, 'UTC')->format('Y-m-d H:i:s');
        $this->assertSame('2026-09-29 21:00:00', $fmt(\App\Support\Time::startOfDayMs($ms)));
        $this->assertSame('2026-09-30 20:59:59', $fmt(\App\Support\Time::endOfDayMs($ms)));
    }

    public function test_sales_report_buckets_by_local_hour(): void
    {
        $this->shop();
        $v = $this->variantOf('Khamrah');
        $this->cashierWithShift();
        $sale = $this->checkout($v, 1, [['method' => 'cash_iqd', 'tendered' => 45000]])->assertCreated()->json('sale');
        $this->asOwner();
        $hour = (int) \App\Support\Time::at($sale['createdAt'])->format('G');
        $r = $this->api('GET', 'reports/sales')->assertOk()->json('report');
        $this->assertSame([$hour], collect($r['byHour'])->pluck('hour')->all());
        $this->assertSame(\App\Support\Time::at($sale['createdAt'])->format('Y-m-d'), $r['byDay'][0]['day']);
    }

    public function test_health_endpoint_is_public(): void
    {
        $this->getJson('/api/v1/health')->assertOk()->assertJsonPath('ok', true);
    }
}
