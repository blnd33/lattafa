<?php

namespace Tests\Feature;

use App\Models\CatalogueProductTranslation;
use App\Models\Product;
use App\Models\Variant;
use Tests\ApiTestCase;

/**
 * The collection as a visitor meets it — §44 Scenario 1.
 *
 * The rule the whole catalogue rests on is tested here from the outside: anyone may browse every perfume, and
 * **no price is in the reply at all**. Not nulled, not filtered — never built, because the endpoint that carries
 * prices is a different one behind a session.
 */
class WholesaleCollectionTest extends ApiTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $this->shop();
    }

    private function collection(?string $language = null)
    {
        return $this->getJson('/api/v1/wholesale/products'.($language ? '?language='.$language : ''));
    }

    public function test_a_visitor_sees_the_whole_collection_without_signing_in(): void
    {
        $res = $this->collection()->assertOk();

        $this->assertGreaterThan(10, count($res->json('products')));
        $this->assertNotEmpty($res->json('categories'));
        $this->assertContains('Lattafa', $res->json('brands'));
    }

    /** §44 Scenario 1 — browsing is open, prices are not. */
    public function test_not_one_price_is_anywhere_in_the_reply(): void
    {
        $khamrah = $this->variantOf('Khamrah');
        $khamrah->update(['wholesale_usd_cents' => 2400, 'retail_iqd' => 45000, 'cost_iqd' => 18000]);

        $body = $this->collection()->assertOk()->getContent();

        foreach (['price', 'Price', 'cents', 'Cents', 'retail', 'wholesale', 'cost'] as $word) {
            $this->assertStringNotContainsString($word, $body, "the collection should carry no \"$word\" field");
        }
        $this->assertStringNotContainsString('2400', $body);
        $this->assertStringNotContainsString('45000', $body);
    }

    public function test_a_buyer_learns_whether_a_size_is_in_stock_and_never_how_many(): void
    {
        $khamrah = $this->variantOf('Khamrah');
        $have = $this->stockOf($khamrah);
        $this->assertGreaterThan(0, $have);

        $size = $this->sizeOf($this->collection()->assertOk()->json('products'), $khamrah->id);
        $this->assertTrue($size['inStock']);
        $this->assertArrayNotHasKey('stock', $size);
        $this->assertArrayNotHasKey('qty', $size);

        // sold out: still listed, still readable, just not orderable
        $this->api('POST', 'stock/adjust', ['variantId' => $khamrah->id, 'newQty' => 0, 'reason' => 'adjustment'])->assertOk();
        $this->assertFalse($this->sizeOf($this->collection()->assertOk()->json('products'), $khamrah->id)['inStock']);
    }

    public function test_each_size_carries_the_rules_it_is_held_to(): void
    {
        $this->api('PUT', 'catalogue/rules', ['scope' => 'global', 'minQty' => 6, 'qtyIncrement' => 6, 'enabled' => true])->assertOk();
        $this->api('PUT', 'catalogue/rules', ['scope' => 'category', 'scopeId' => 'oud', 'minQty' => 2, 'qtyIncrement' => 2, 'enabled' => true])->assertOk();

        $products = $this->collection()->assertOk()->json('products');
        $perfume = collect($products)->firstWhere('category', 'perfume');
        $this->assertSame([6, 6], [$perfume['sizes'][0]['minQty'], $perfume['sizes'][0]['step']]);

        if ($oud = collect($products)->firstWhere('category', 'oud')) {
            $this->assertSame([2, 2], [$oud['sizes'][0]['minQty'], $oud['sizes'][0]['step']], 'oud follows its own, gentler rule');
        }
    }

    public function test_a_perfume_reads_in_the_language_asked_for_and_falls_back_where_it_has_none(): void
    {
        $product = Product::all()->first(fn (Product $p) => ($p->name['en'] ?? '') === 'Khamrah');
        CatalogueProductTranslation::create([
            'product_id' => $product->id, 'language_code' => 'ar',
            'display_name' => 'خمرة', 'description' => 'وصف عربي',
        ]);

        $arabic = collect($this->collection('ar')->assertOk()->json('products'))->firstWhere('id', $product->id);
        $this->assertSame('خمرة', $arabic['name']);
        $this->assertSame('وصف عربي', $arabic['description']);

        // English is untouched, and a perfume with no Arabic of its own keeps the shop's own words
        $english = collect($this->collection('en')->assertOk()->json('products'))->firstWhere('id', $product->id);
        $this->assertSame('Khamrah', $english['name']);
        $untranslated = collect($this->collection('ar')->assertOk()->json('products'))->first(fn ($p) => $p['id'] !== $product->id);
        $this->assertNotSame('', $untranslated['name'], 'an untranslated perfume shows its own name, never a blank');
    }

    public function test_an_unknown_language_falls_back_rather_than_failing(): void
    {
        $this->assertSame('en', $this->collection('zz')->assertOk()->json('language'));
    }

    public function test_testers_switched_off_sizes_and_empty_perfumes_are_left_out(): void
    {
        $khamrah = $this->variantOf('Khamrah');
        $khamrah->update(['is_tester' => true]);
        $other = Variant::where('product_id', $khamrah->product_id)->whereKeyNot($khamrah->id)->get();
        $other->each(fn (Variant $v) => $v->update(['active' => false]));

        $products = $this->collection()->assertOk()->json('products');

        $this->assertNull(collect($products)->firstWhere('id', $khamrah->product_id), 'a perfume with nothing to sell is not in the catalogue');
        foreach ($products as $p) {
            $this->assertNotEmpty($p['sizes']);
        }
    }

    public function test_featured_perfumes_come_first(): void
    {
        $products = $this->collection()->assertOk()->json('products');
        $featured = array_column($products, 'featured');
        $lastFeatured = array_search(false, $featured, true);

        if ($lastFeatured !== false) {
            $this->assertNotContains(true, array_slice($featured, $lastFeatured), 'a featured perfume should not sit below an ordinary one');
        }
    }

    /** @param array<int, array<string, mixed>> $products */
    private function sizeOf(array $products, string $variantId): array
    {
        foreach ($products as $p) {
            foreach ($p['sizes'] as $s) {
                if ($s['variantId'] === $variantId) {
                    return $s;
                }
            }
        }
        $this->fail("size $variantId is not in the collection");
    }
}
