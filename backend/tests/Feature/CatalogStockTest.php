<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\Variant;
use Tests\ApiTestCase;

/** Products, barcodes, prices, cost visibility, stock movements and stock counts. */
class CatalogStockTest extends ApiTestCase
{
    /** @param array<string, mixed> $over */
    private function payload(string $sku = 'NEW-1', array $over = [], array $variant = []): array
    {
        return [
            'product' => $over + [
                'name' => ['en' => 'Test Scent', 'ar' => 'عطر', 'ku' => 'بۆن'], 'brand' => 'Lattafa', 'category' => 'perfume', 'gender' => 'unisex',
                'concentration' => 'EDP', 'scentFamilies' => ['woody'], 'season' => 'all', 'longevity' => 3, 'sillage' => 3, 'showOnMenu' => true, 'active' => true,
            ],
            'variants' => [$variant + ['label' => '100 ml', 'ml' => 100, 'sku' => $sku, 'costIQD' => 10000, 'retailIQD' => 20000, 'wholesaleIQD' => 16000, 'minStock' => 2, 'openingStock' => 7]],
        ];
    }

    public function test_demo_catalogue_lists_with_stock_and_generated_barcodes(): void
    {
        $this->shop();
        $products = $this->api('GET', 'products')->assertOk()->json('products');
        $this->assertCount(13, $products);
        $khamrah = collect($products)->first(fn ($p) => $p['name']['en'] === 'Khamrah');
        $big = collect($khamrah['variants'])->firstWhere('ml', 100);
        $this->assertSame(14, $big['stock']);
        $barcodes = collect($products)->flatMap(fn ($p) => collect($p['variants'])->pluck('barcode'));
        $this->assertSame($barcodes->count(), $barcodes->unique()->count());
        $this->assertTrue($barcodes->every(fn ($b) => preg_match('/^\d{13}$/', $b) === 1));
    }

    public function test_create_product_with_opening_stock_and_update_it(): void
    {
        $this->shop();
        $res = $this->api('POST', 'products', $this->payload())->assertCreated();
        $p = $res->json('product');
        $this->assertSame(7, $p['variants'][0]['stock']);
        $this->assertNotEmpty($p['variants'][0]['barcode']); // generated when omitted

        $upd = $this->payload('NEW-1', ['name' => ['en' => 'Renamed'], 'brand' => 'Lattafa', 'category' => 'perfume', 'gender' => 'men', 'concentration' => 'EDP'], ['id' => $p['variants'][0]['id'], 'retailIQD' => 25000, 'openingStock' => 0]);
        $res = $this->api('PUT', "products/{$p['id']}", $upd)->assertOk();
        $this->assertSame(25000, $res->json('product.variants.0.retailIQD'));
        $this->assertSame(7, $res->json('product.variants.0.stock')); // editing a product never re-applies opening stock
        $this->assertSame('Renamed', $res->json('product.name.en'));
    }

    public function test_duplicate_sku_or_barcode_is_refused(): void
    {
        $this->shop();
        $this->api('POST', 'products', $this->payload('DUP-1', [], ['barcode' => '2000000099999']))->assertCreated();
        $this->api('POST', 'products', $this->payload('DUP-1'))->assertStatus(422)->assertJsonPath('error.code', 'sku_taken');
        $this->api('POST', 'products', $this->payload('DUP-2', [], ['barcode' => '2000000099999']))->assertStatus(422)->assertJsonPath('error.code', 'barcode_taken');
    }

    public function test_barcode_lookup_finds_by_barcode_or_sku_and_404s_otherwise(): void
    {
        $this->shop();
        $v = $this->variantOf('Khamrah');
        $this->api('GET', 'products/lookup?code='.$v->barcode)->assertOk()->assertJsonPath('product.variants.0.id', $v->id);
        $this->api('GET', 'products/lookup?code='.$v->sku)->assertOk()->assertJsonPath('product.variants.0.id', $v->id);
        $this->api('GET', 'products/lookup?code=nothing-here')->assertStatus(404)->assertJsonPath('error.code', 'not_found');
    }

    public function test_cost_prices_are_hidden_from_users_without_price_permission(): void
    {
        $this->shop();
        $this->assertGreaterThan(0, $this->api('GET', 'products')->json('products.0.variants.0.costIQD'));

        $id = $this->makeUser('Ali', 'alii', 'cashier', '3333');
        $this->asUser($id, '3333');
        $cost = collect($this->api('GET', 'products')->assertOk()->json('products'))->flatMap(fn ($p) => collect($p['variants'])->pluck('costIQD'))->unique()->values()->all();
        $this->assertSame([0], $cost);
        // a cashier still sees selling prices
        $this->assertGreaterThan(0, $this->api('GET', 'products')->json('products.0.variants.0.retailIQD'));
    }

    public function test_only_permitted_users_can_change_the_catalogue(): void
    {
        $this->shop();
        $id = $this->makeUser('Ali', 'alii', 'cashier', '3333');
        $product = Product::first();
        $this->asUser($id, '3333');
        $this->api('POST', 'products', $this->payload())->assertStatus(403);
        $this->api('DELETE', "products/{$product->id}")->assertStatus(403);
        $this->api('PATCH', "products/{$product->id}/active", ['active' => false])->assertStatus(403);
        $this->api('POST', 'products/bulk-price', ['mode' => 'pct', 'value' => 10, 'target' => 'retail'])->assertStatus(403);
    }

    public function test_bulk_price_change_rounds_and_reports_count(): void
    {
        $this->shop();
        $v = $this->variantOf('Khamrah');
        $before = $v->retail_iqd;
        $res = $this->api('POST', 'products/bulk-price', ['mode' => 'pct', 'value' => 10, 'target' => 'retail', 'productIds' => [$v->product_id]])->assertOk();
        $this->assertSame(2, $res->json('updated')); // Khamrah has two sizes
        $this->assertSame(49500, $v->fresh()->retail_iqd); // 45,000 + 10% = 49,500, already on the 250 step
        $this->assertSame(0, $v->fresh()->retail_iqd % 250);
        $this->assertNotSame($before, $v->fresh()->retail_iqd);
    }

    public function test_deactivating_hides_a_product_from_sale_and_deleting_needs_no_sales_history(): void
    {
        $this->shop();
        $v = $this->variantOf('Haya');
        $this->api('PATCH', "products/{$v->product_id}/active", ['active' => false])->assertOk();
        $names = collect($this->api('GET', 'products')->json('products'))->pluck('name.en');
        $this->assertNotContains('Haya', $names);
        $this->assertContains('Haya', collect($this->api('GET', 'products?includeInactive=1')->json('products'))->pluck('name.en'));

        // never sold → really deleted, and a tombstone is left for tills to pick up on their next pull
        $res = $this->api('DELETE', "products/{$v->product_id}")->assertOk();
        $this->assertSame('deleted', $res->json('result'));
        $this->assertDatabaseHas('tombstones', ['entity' => 'product', 'entity_id' => $v->product_id]);
    }

    public function test_a_product_that_has_been_sold_is_deactivated_not_deleted(): void
    {
        $this->shop();
        $v = $this->variantOf('Khamrah');
        $this->cashierWithShift();
        $this->checkout($v, 1, [['method' => 'cash_iqd', 'tendered' => 45000]])->assertCreated();
        $this->asOwner();
        $res = $this->api('DELETE', "products/{$v->product_id}")->assertOk();
        $this->assertSame('deactivated', $res->json('result'));
        $this->assertNotNull(Product::find($v->product_id));
        $this->assertFalse((bool) Product::find($v->product_id)->active);
    }

    public function test_csv_style_import_creates_and_updates_by_sku(): void
    {
        $this->shop();
        $res = $this->api('POST', 'products/import', ['rows' => [
            ['sku' => 'IMP-1', 'name_en' => 'Imported One', 'brand' => 'Lattafa', 'retail_iqd' => 15000, 'cost_iqd' => 9000, 'stock' => 5, 'ml' => 50],
            ['sku' => 'IMP-2', 'name_en' => 'Imported Two', 'brand' => 'Lattafa', 'retail_iqd' => 18000, 'cost_iqd' => 9500, 'stock' => 3, 'ml' => 100],
            ['sku' => '', 'name_en' => 'No sku', 'retail_iqd' => 1],
            ['sku' => 'IMP-3'], // nameless new sku can't become a product
            ['sku' => 'LTF-KHAM-100', 'retail_iqd' => 47000, 'cost_iqd' => 27000], // existing sku → price update
        ]])->assertOk();
        $this->assertSame(2, $res->json('created'));
        $this->assertSame(1, $res->json('updated'));
        $this->assertSame(2, $res->json('skipped'));
        $imp = Variant::where('sku', 'IMP-1')->first();
        $this->assertNotNull($imp);
        $this->assertSame(5, $this->stockOf($imp));
        $this->assertSame(47000, Variant::where('sku', 'LTF-KHAM-100')->first()->retail_iqd);
    }

    public function test_the_dollar_price_list_is_imported_in_cents_and_an_empty_cell_keeps_it(): void
    {
        $this->shop();
        $kham = Variant::where('sku', 'LTF-KHAM-100')->first();
        $this->assertSame(0, $kham->wholesale_usd_cents); // nothing set yet: the bill converts from dinars

        $this->api('POST', 'products/import', ['rows' => [['sku' => 'LTF-KHAM-100', 'retail_iqd' => 45000, 'wholesale_usd' => 2370]]])->assertOk();
        $this->assertSame(2370, $kham->fresh()->wholesale_usd_cents);
        // and it reaches the tills and the delegate's phone
        $variants = collect($this->api('GET', 'products')->json('products'))->flatMap(fn ($p) => $p['variants'])->keyBy('sku');
        $this->assertSame(2370, $variants['LTF-KHAM-100']['wholesaleUSDCents']);

        // an empty cell leaves the dollar price alone; a new one replaces it
        $this->api('POST', 'products/import', ['rows' => [['sku' => 'LTF-KHAM-100', 'retail_iqd' => 46000, 'wholesale_usd' => '']]])->assertOk();
        $this->assertSame([2370, 46000], [$kham->fresh()->wholesale_usd_cents, $kham->fresh()->retail_iqd]);
        $this->api('POST', 'products/import', ['rows' => [['sku' => 'LTF-KHAM-100', 'retail_iqd' => 46000, 'wholesale_usd' => 1900]]])->assertOk();
        $this->assertSame(1900, $kham->fresh()->wholesale_usd_cents);
    }

    public function test_a_delivery_import_adds_the_pieces_of_sizes_already_on_file(): void
    {
        $this->shop();
        $kham = Variant::where('sku', 'LTF-KHAM-100')->first();
        $before = $this->stockOf($kham);
        // a file exported and brought back leaves the stock alone…
        $this->api('POST', 'products/import', ['rows' => [['sku' => 'LTF-KHAM-100', 'retail_iqd' => 47000, 'cost_iqd' => 27000, 'stock' => $before]]])->assertOk();
        $this->assertSame($before, $this->stockOf($kham));

        // …a supplier's invoice from the product sheet adds what came in, at the new cost
        $this->api('POST', 'products/import', ['addStock' => true, 'rows' => [
            ['sku' => 'LTF-KHAM-100', 'retail_iqd' => 48000, 'cost_iqd' => 29000, 'wholesale_iqd' => 40000, 'stock' => 12],
            ['sku' => 'INV-ATLAS-55', 'name_ar' => 'اطلس', 'brand' => 'Lattafa', 'retail_iqd' => 30000, 'cost_iqd' => 16000, 'size' => '55', 'unit' => 'ml', 'stock' => 12],
        ]])->assertOk()->assertJsonPath('created', 1)->assertJsonPath('updated', 1);
        $this->assertSame($before + 12, $this->stockOf($kham));
        $this->assertSame([48000, 29000, 40000], [$kham->fresh()->retail_iqd, $kham->fresh()->cost_iqd, $kham->fresh()->wholesale_iqd]);
        $this->assertSame(12, $this->stockOf(Variant::where('sku', 'INV-ATLAS-55')->first()));
        $mv = $this->api('GET', 'stock/movements?variantId='.$kham->id)->assertOk()->json('movements.0');
        $this->assertSame(['purchase', 12, $before + 12], [$mv['type'], $mv['qty'], $mv['balanceAfter']]);
    }

    public function test_receiving_stock_adds_units_and_can_update_cost_for_price_editors(): void
    {
        $this->shop();
        $v = $this->variantOf('Raghba');
        $before = $this->stockOf($v);
        $this->api('POST', 'stock/receive', ['items' => [['variantId' => $v->id, 'qty' => 10, 'costIQD' => 22000]], 'note' => 'Invoice 55'])->assertOk();
        $this->assertSame($before + 10, $this->stockOf($v));
        $this->assertSame(22000, $v->fresh()->cost_iqd);
        $mv = $this->api('GET', 'stock/movements?variantId='.$v->id)->assertOk()->json('movements.0');
        $this->assertSame('purchase', $mv['type']);
        $this->assertSame($before + 10, $mv['balanceAfter']);

        // a stock keeper may receive but must not change cost
        $keeper = $this->makeUser('Keeper', 'keep', 'stock_keeper', '4747');
        $this->asUser($keeper, '4747');
        $this->api('POST', 'stock/receive', ['items' => [['variantId' => $v->id, 'qty' => 1, 'costIQD' => 1]]])->assertOk();
        $this->assertSame(22000, $v->fresh()->cost_iqd);
    }

    public function test_adjustments_testers_and_counts_leave_an_audit_trail_of_movements(): void
    {
        $this->shop();
        $v = $this->variantOf('Khamrah');
        $this->api('POST', 'stock/adjust', ['variantId' => $v->id, 'newQty' => 10, 'reason' => 'damage', 'note' => 'broken cap'])->assertOk();
        $this->assertSame(10, $this->stockOf($v));
        $this->api('POST', 'stock/tester', ['variantId' => $v->id, 'qty' => 1])->assertOk();
        $this->assertSame(9, $this->stockOf($v));
        $res = $this->api('POST', 'stock/count', ['lines' => [['variantId' => $v->id, 'counted' => 12]], 'note' => 'weekly'])->assertOk();
        $this->assertSame(1, $res->json('changed'));
        $this->assertSame(12, $this->stockOf($v));

        $types = collect($this->api('GET', 'stock/movements?variantId='.$v->id)->json('movements'))->pluck('type')->all();
        foreach (['opening', 'damage', 'tester', 'count'] as $t) {
            $this->assertContains($t, $types);
        }
        // balances chain: each row's balanceAfter equals the previous balance plus its qty
        $rows = array_reverse($this->api('GET', 'stock/movements?variantId='.$v->id)->json('movements'));
        $bal = 0;
        foreach ($rows as $r) {
            $bal += $r['qty'];
            $this->assertSame($bal, $r['balanceAfter']);
        }
    }

    public function test_invalid_stock_changes_are_rejected(): void
    {
        $this->shop();
        $v = $this->variantOf('Khamrah');
        $this->api('POST', 'stock/adjust', ['variantId' => $v->id, 'newQty' => -3, 'reason' => 'damage'])->assertStatus(422);
        $this->api('POST', 'stock/tester', ['variantId' => $v->id, 'qty' => 500])->assertStatus(422)->assertJsonPath('error.code', 'insufficient_stock');
        $this->assertSame(14, $this->stockOf($v));
    }

    public function test_low_stock_report_lists_items_at_or_under_their_minimum(): void
    {
        $this->shop();
        $items = collect($this->api('GET', 'stock/low')->assertOk()->json('items'));
        $raghba = $items->first(fn ($i) => $i['productName'] === 'Raghba');
        $this->assertNotNull($raghba);
        $this->assertSame(3, $raghba['qty']);
        $this->assertSame($items->pluck('qty')->sort()->values()->all(), $items->pluck('qty')->all()); // lowest first
    }

    public function test_cashier_cannot_touch_inventory(): void
    {
        $this->shop();
        $v = $this->variantOf('Khamrah');
        $id = $this->makeUser('Ali', 'alii', 'cashier', '3333');
        $this->asUser($id, '3333');
        $this->api('POST', 'stock/adjust', ['variantId' => $v->id, 'newQty' => 0, 'reason' => 'damage'])->assertStatus(403);
        $this->api('POST', 'stock/receive', ['items' => [['variantId' => $v->id, 'qty' => 5]]])->assertStatus(403);
        $this->api('POST', 'stock/count', ['lines' => [['variantId' => $v->id, 'counted' => 0]]])->assertStatus(403);
        $this->api('GET', 'stock/movements')->assertStatus(403);
        $this->assertSame(14, $this->stockOf($v));
    }

    /* ─────────── sizes in ml or oz ─────────── */

    public function test_sizes_can_be_entered_in_ml_or_oz_and_ml_is_always_derived(): void
    {
        $this->shop();
        $body = $this->payload('OZ-1');
        $body['variants'] = [
            ['label' => '', 'size' => 3.4, 'unit' => 'oz', 'ml' => 999, 'sku' => 'OZ-1', 'retailIQD' => 50000],      // a client can't fake `ml`
            ['label' => '', 'size' => 50, 'unit' => 'ml', 'sku' => 'ML-1', 'retailIQD' => 30000],
            ['label' => 'Travel spray', 'size' => 1, 'unit' => 'oz', 'sku' => 'OZ-2', 'retailIQD' => 15000],
        ];
        $p = $this->api('POST', 'products', $body)->assertCreated()->json('product');
        $bySku = collect($p['variants'])->keyBy('sku');
        $this->assertEquals(['size' => 3.4, 'unit' => 'oz', 'ml' => 101, 'label' => '3.4 oz'], collect($bySku['OZ-1'])->only(['size', 'unit', 'ml', 'label'])->all());
        $this->assertEquals(['size' => 50.0, 'unit' => 'ml', 'ml' => 50, 'label' => '50 ml'], collect($bySku['ML-1'])->only(['size', 'unit', 'ml', 'label'])->all());
        $this->assertEquals(['size' => 1.0, 'unit' => 'oz', 'ml' => 30, 'label' => 'Travel spray'], collect($bySku['OZ-2'])->only(['size', 'unit', 'ml', 'label'])->all());

        // switching a size from ml to oz recomputes ml
        $edit = $body;
        $edit['variants'] = [['id' => $bySku['ML-1']['id'], 'label' => '', 'size' => 1.7, 'unit' => 'oz', 'sku' => 'ML-1', 'retailIQD' => 30000]];
        $res = $this->api('PUT', "products/{$p['id']}", $edit)->assertOk()->json('product.variants');
        $ml1 = collect($res)->firstWhere('sku', 'ML-1');
        $this->assertEquals([1.7, 'oz', 50, '1.7 oz'], [$ml1['size'], $ml1['unit'], $ml1['ml'], $ml1['label']]);

        $bad = $body;
        $bad['variants'] = [['size' => 5, 'unit' => 'cl', 'sku' => 'CL-1', 'retailIQD' => 1]];
        $this->api('POST', 'products', $bad)->assertStatus(422)->assertJsonPath('error.code', 'validation');
    }

    public function test_older_clients_sending_only_ml_still_work_and_demo_data_is_in_ml(): void
    {
        $this->shop();
        $p = $this->api('POST', 'products', $this->payload('LEGACY-1'))->assertCreated()->json('product.variants.0'); // payload() sends ml => 100 only
        $this->assertEquals([100.0, 'ml', 100, '100 ml'], [$p['size'], $p['unit'], $p['ml'], $p['label']]);

        $v = $this->variantOf('Khamrah');
        $this->assertEquals([100.0, 'ml', 100], [$v->size, $v->unit, $v->ml]);
        $gift = Variant::where('label', '3 pcs')->first(); // a gift set has no size at all
        $this->assertEquals([0.0, 0], [$gift->size, $gift->ml]);
    }

    public function test_csv_import_reads_size_and_unit_or_a_legacy_ml_column(): void
    {
        $this->shop();
        $res = $this->api('POST', 'products/import', ['rows' => [
            ['sku' => 'CSV-OZ', 'name_en' => 'Csv Oz', 'brand' => 'Lattafa', 'retail_iqd' => 30000, 'size' => '3.4', 'unit' => 'OZ'],
            ['sku' => 'CSV-ML', 'name_en' => 'Csv Ml', 'brand' => 'Lattafa', 'retail_iqd' => 30000, 'size' => '50', 'unit' => 'ml'],
            ['sku' => 'CSV-OLD', 'name_en' => 'Csv Old', 'brand' => 'Lattafa', 'retail_iqd' => 30000, 'ml' => '75'],
        ]])->assertOk();
        $this->assertSame(3, $res->json('created'));
        $get = fn (string $sku) => Variant::where('sku', $sku)->first();
        $this->assertEquals([3.4, 'oz', 101, '3.4 oz'], [$get('CSV-OZ')->size, $get('CSV-OZ')->unit, $get('CSV-OZ')->ml, $get('CSV-OZ')->label]);
        $this->assertEquals([50.0, 'ml', 50, '50 ml'], [$get('CSV-ML')->size, $get('CSV-ML')->unit, $get('CSV-ML')->ml, $get('CSV-ML')->label]);
        $this->assertEquals([75.0, 'ml', 75, '75 ml'], [$get('CSV-OLD')->size, $get('CSV-OLD')->unit, $get('CSV-OLD')->ml, $get('CSV-OLD')->label]);
    }

    public function test_import_groups_sizes_by_any_name_and_guards_barcodes(): void
    {
        $this->shop();
        $res = $this->api('POST', 'products/import', ['rows' => [
            ['sku' => 'AR-100', 'name_ar' => 'عطر الورد', 'brand' => '', 'retail_iqd' => 20000, 'size' => '100', 'unit' => 'ml'],
            ['sku' => 'AR-50', 'name_ar' => 'عطر الورد', 'brand' => 'Lattafa', 'retail_iqd' => 12000, 'size' => '50', 'unit' => 'ml', 'min_stock' => ''],
            ['sku' => 'KU-100', 'name_ku' => 'بۆنی گوڵ', 'retail_iqd' => 21000, 'size' => '100', 'unit' => 'ml', 'min_stock' => '2'],
        ]])->assertOk();
        $this->assertSame(3, $res->json('created'));
        // an Arabic-only name is still a name, and an empty brand is the default brand: one product, two sizes
        $this->assertSame(Variant::where('sku', 'AR-100')->value('product_id'), Variant::where('sku', 'AR-50')->value('product_id'));
        $this->assertNotSame(Variant::where('sku', 'AR-100')->value('product_id'), Variant::where('sku', 'KU-100')->value('product_id'));
        $this->assertSame([5, 2], [Variant::where('sku', 'AR-50')->value('min_stock'), Variant::where('sku', 'KU-100')->value('min_stock')]); // empty = the default

        // a barcode can belong to one size only — the whole import is refused, nothing half-saved
        $taken = Variant::where('sku', 'AR-100')->value('barcode');
        $this->api('POST', 'products/import', ['rows' => [
            ['sku' => 'OK-1', 'name_en' => 'Fine', 'retail_iqd' => 1000],
            ['sku' => 'BAD-1', 'name_en' => 'Clash', 'retail_iqd' => 1000, 'barcode' => $taken],
        ]])->assertStatus(422)->assertJsonPath('error.code', 'barcode_taken')->assertJsonPath('error.params.sku', 'BAD-1');
        $this->assertNull(Variant::where('sku', 'OK-1')->first());
        // …but re-sending a size with its own barcode is fine
        $this->api('POST', 'products/import', ['rows' => [['sku' => 'AR-100', 'retail_iqd' => 22000, 'barcode' => $taken]]])->assertOk()->assertJsonPath('updated', 1);
    }

    public function test_sync_pull_carries_size_and_unit_to_the_tills(): void
    {
        $this->shop();
        $body = $this->payload('PULL-OZ');
        $body['variants'] = [['size' => 1.7, 'unit' => 'oz', 'sku' => 'PULL-OZ', 'retailIQD' => 30000]];
        $this->api('POST', 'products', $body)->assertCreated();
        $v = collect($this->api('GET', 'sync/pull')->json('products'))->flatMap(fn ($p) => $p['variants'])->firstWhere('sku', 'PULL-OZ');
        $this->assertEquals([1.7, 'oz', 50, '1.7 oz'], [$v['size'], $v['unit'], $v['ml'], $v['label']]);
    }
}
