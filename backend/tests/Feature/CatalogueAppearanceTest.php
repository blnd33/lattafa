<?php

namespace Tests\Feature;

use App\Models\CatalogueProductImage;
use App\Models\CatalogueProductSetting;
use App\Models\Product;
use App\Services\Catalogue\AppearanceService;
use Illuminate\Support\Facades\Storage;
use Tests\ApiTestCase;

/**
 * How the catalogue looks, and what the shop says about its own perfumes there.
 *
 * Two things are worth being strict about. The first is the line in §8: the catalogue may present a perfume
 * however it likes, but it must not write to `products` or `variants`, which the tills and the delegates rely on.
 * The second is §45's flat refusal to invent Lattafa's branding — the theme that ships is the house theme and says
 * so, and it stays marked provisional until somebody with the real brand kit says otherwise.
 */
class CatalogueAppearanceTest extends ApiTestCase
{
    /** A 1×1 PNG, as a browser would send it. */
    private const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
        $this->shop();
    }

    private function look()
    {
        return $this->getJson('/api/v1/wholesale/open')->assertOk()->json('look');
    }

    // ───────────────────────── the theme ─────────────────────────

    public function test_the_catalogue_ships_with_the_house_theme_and_admits_it_is_provisional(): void
    {
        $brand = $this->look()['brand'];

        $this->assertSame('#D4A548', $brand['gold']);
        $this->assertSame('LATTAFA', $brand['wordmark']);
        $this->assertTrue($brand['provisional'], 'until the real brand kit arrives, the catalogue says so');
    }

    public function test_the_owner_can_set_the_colours_and_say_they_are_no_longer_provisional(): void
    {
        $this->api('PUT', 'catalogue/appearance/brand', ['patch' => ['gold' => '#B8892F', 'tagline' => 'Since 1988', 'provisional' => false]])->assertOk();

        $brand = $this->look()['brand'];
        $this->assertSame('#B8892F', $brand['gold']);
        $this->assertSame('Since 1988', $brand['tagline']);
        $this->assertFalse($brand['provisional']);
    }

    public function test_something_that_is_not_a_colour_is_not_taken_as_one(): void
    {
        $this->api('PUT', 'catalogue/appearance/brand', ['patch' => ['gold' => 'javascript:alert(1)']])->assertOk();

        $this->assertSame('#D4A548', $this->look()['brand']['gold'], 'the old colour stands rather than something that is not one');
    }

    // ───────────────────────── the homepage ─────────────────────────

    public function test_the_homepage_is_the_sections_the_owner_chose_in_the_owners_order(): void
    {
        $this->api('PUT', 'catalogue/appearance/homepage', ['patch' => [
            'headline' => 'The house of oud',
            'sections' => [
                ['key' => 'hero', 'on' => true],
                ['key' => 'collections', 'on' => true],
                ['key' => 'story', 'on' => false],
            ],
        ]])->assertOk();

        $look = $this->look();
        $this->assertSame('The house of oud', $look['headline']);

        $keys = array_column($look['sections'], 'key');
        $this->assertSame(['hero', 'collections'], array_slice($keys, 0, 2), 'in the order the owner put them');
        $this->assertNotContains('story', $keys, 'a section switched off is not sent at all');
        // a section the owner did not mention keeps its place rather than disappearing
        $this->assertContains('featured', $keys);
    }

    public function test_a_section_the_catalogue_cannot_draw_is_ignored(): void
    {
        $this->api('PUT', 'catalogue/appearance/homepage', ['patch' => ['sections' => [
            ['key' => 'hero', 'on' => true],
            ['key' => 'made_up_section', 'on' => true],
        ]]])->assertOk();

        $this->assertNotContains('made_up_section', array_column($this->look()['sections'], 'key'));
    }

    public function test_the_hero_photograph_goes_up_and_comes_down(): void
    {
        $this->api('PUT', 'catalogue/appearance/hero', ['image' => self::PNG])->assertOk();
        $hero = $this->look()['hero'];
        $this->assertNotNull($hero);
        $this->assertStringContainsString('catalogue/hero', $hero);

        $this->api('PUT', 'catalogue/appearance/hero', ['image' => null])->assertOk();
        $this->assertNull($this->look()['hero']);
    }

    public function test_something_that_is_not_an_image_never_reaches_the_public_disk(): void
    {
        // the label says PNG; the bytes are a script. The bytes are what is read.
        $pretend = 'data:image/png;base64,'.base64_encode('<?php echo "hello"; ?>');

        $this->api('PUT', 'catalogue/appearance/hero', ['image' => $pretend])
            ->assertStatus(422)->assertJsonPath('error.code', 'image_invalid');
        $this->assertNull($this->look()['hero']);
    }

    // ───────────────────────── collections ─────────────────────────

    public function test_a_collection_groups_perfumes_without_touching_them(): void
    {
        $perfumes = Product::query()->limit(2)->pluck('id')->all();
        $before = Product::whereIn('id', $perfumes)->get()->map(fn (Product $p) => $p->only(['name', 'category', 'featured']))->toArray();

        $id = $this->api('POST', 'catalogue/collections', [
            'name' => ['en' => 'Oud Collection'], 'description' => ['en' => 'The deep ones.'], 'featured' => true,
        ])->assertCreated()->json('collection.id');

        $this->api('PUT', 'catalogue/collections/'.$id.'/products', ['productIds' => $perfumes])->assertOk()->assertJsonPath('count', 2);

        // the perfumes themselves are exactly as they were
        $after = Product::whereIn('id', $perfumes)->get()->map(fn (Product $p) => $p->only(['name', 'category', 'featured']))->toArray();
        $this->assertSame($before, $after);

        $shown = collect($this->getJson('/api/v1/wholesale/products')->assertOk()->json('collections'))->firstWhere('slug', 'oud-collection');
        $this->assertSame('Oud Collection', $shown['name']);
        $this->assertSame($perfumes, $shown['products']);
    }

    public function test_an_empty_collection_is_not_shown_to_a_visitor(): void
    {
        $this->api('POST', 'catalogue/collections', ['name' => ['en' => 'Coming soon']])->assertCreated();

        $this->assertSame([], $this->getJson('/api/v1/wholesale/products')->assertOk()->json('collections'));
    }

    public function test_hiding_a_perfume_empties_it_out_of_every_collection_at_once(): void
    {
        $perfume = Product::query()->value('id');
        $id = $this->api('POST', 'catalogue/collections', ['name' => ['en' => 'Oud Collection']])->assertCreated()->json('collection.id');
        $this->api('PUT', 'catalogue/collections/'.$id.'/products', ['productIds' => [$perfume]])->assertOk();
        $this->assertCount(1, $this->getJson('/api/v1/wholesale/products')->assertOk()->json('collections'));

        $this->api('PUT', 'catalogue/perfumes/'.$perfume, ['hidden' => true])->assertOk();

        $out = $this->getJson('/api/v1/wholesale/products')->assertOk();
        $this->assertNull(collect($out->json('products'))->firstWhere('id', $perfume), 'hidden from the catalogue');
        $this->assertSame([], $out->json('collections'), 'and so the collection has nothing left to show');
        $this->assertTrue(Product::findOrFail($perfume)->active, 'the perfume is still the shop’s, and still sold at the till');
    }

    public function test_the_listing_says_which_perfumes_are_in_each_collection_and_in_what_order(): void
    {
        $perfumes = Product::query()->limit(3)->pluck('id')->all();
        $wanted = [$perfumes[2], $perfumes[0], $perfumes[1]];

        $id = $this->api('POST', 'catalogue/collections', ['name' => ['en' => 'Oud Collection']])->assertCreated()->json('collection.id');
        $this->api('PUT', 'catalogue/collections/'.$id.'/products', ['productIds' => $wanted])->assertOk();

        // the admin screen replaces the whole list when it saves, so the listing has to hand it back as it stands
        $row = collect($this->api('GET', 'catalogue/collections')->assertOk()->json('collections'))->firstWhere('id', $id);
        $this->assertSame(3, $row['perfumes']);
        $this->assertSame($wanted, $row['productIds'], 'in the order the owner put them in');
    }

    public function test_the_same_collection_cannot_be_made_twice(): void
    {
        $this->api('POST', 'catalogue/collections', ['name' => ['en' => 'Oud Collection']])->assertCreated();
        $this->api('POST', 'catalogue/collections', ['name' => ['en' => 'Oud Collection']])
            ->assertStatus(422)->assertJsonPath('error.code', 'collection_exists');
    }

    // ───────────────────────── one perfume, as the catalogue shows it ─────────────────────────

    public function test_extra_photographs_come_after_the_shops_own(): void
    {
        $product = Product::query()->first();
        $product->update(['image_path' => 'products/original.jpg']);

        $this->api('POST', 'catalogue/perfumes/'.$product->id.'/images', ['image' => self::PNG])->assertCreated();
        $this->api('POST', 'catalogue/perfumes/'.$product->id.'/images', ['image' => self::PNG])->assertCreated();

        $shown = collect($this->getJson('/api/v1/wholesale/products')->assertOk()->json('products'))->firstWhere('id', $product->id);
        $this->assertCount(3, $shown['images']);
        $this->assertStringContainsString('products/original.jpg', $shown['images'][0], 'the shop’s own photograph leads');
        $this->assertStringContainsString('catalogue/products', $shown['images'][1]);
    }

    public function test_the_catalogue_can_feature_a_perfume_the_shop_did_not_and_otherwise_follows_the_shop(): void
    {
        $plain = Product::where('featured', false)->first() ?? Product::query()->first();
        $plain->update(['featured' => false]);

        $before = collect($this->getJson('/api/v1/wholesale/products')->assertOk()->json('products'))->firstWhere('id', $plain->id);
        $this->assertFalse($before['featured'], 'with nothing said, it follows the product itself');

        $this->api('PUT', 'catalogue/perfumes/'.$plain->id, ['featured' => true])->assertOk();
        $after = collect($this->getJson('/api/v1/wholesale/products')->assertOk()->json('products'))->firstWhere('id', $plain->id);
        $this->assertTrue($after['featured']);
        $this->assertFalse(Product::findOrFail($plain->id)->featured, 'and the shop’s own flag is untouched');
    }

    public function test_nothing_here_writes_to_the_perfume_itself(): void
    {
        $product = Product::query()->first();
        $snapshot = $product->fresh()->toArray();

        $this->api('PUT', 'catalogue/perfumes/'.$product->id, ['hidden' => true, 'featured' => true])->assertOk();
        $this->api('POST', 'catalogue/perfumes/'.$product->id.'/images', ['image' => self::PNG])->assertCreated();
        $this->api('PUT', 'catalogue/perfumes/'.$product->id.'/text/ar', ['name' => 'خمرة', 'description' => 'وصف'])->assertOk();

        $this->assertSame($snapshot, $product->fresh()->toArray(), 'the POS owns the perfume; the catalogue owns how it is shown');
        $this->assertTrue(CatalogueProductSetting::whereKey($product->id)->exists());
        $this->assertSame(1, CatalogueProductImage::where('product_id', $product->id)->count());
    }

    public function test_a_photograph_can_be_taken_off_again(): void
    {
        $product = Product::query()->first();
        $this->api('POST', 'catalogue/perfumes/'.$product->id.'/images', ['image' => self::PNG])->assertCreated();
        $imageId = CatalogueProductImage::where('product_id', $product->id)->value('id');

        $this->api('DELETE', 'catalogue/images/'.$imageId)->assertOk();

        $this->assertSame(0, CatalogueProductImage::where('product_id', $product->id)->count());
    }

    // ───────────────────────── who may change the look ─────────────────────────

    public function test_the_catalogue_manager_may_do_all_of_this_and_the_sales_manager_may_not(): void
    {
        $product = Product::query()->value('id');
        $this->makeUser('Kamal', 'kamal', 'catalogue_manager', '4343');
        $this->makeUser('Sara', 'sara', 'sales_manager', '4242');
        $owner = $this->auth;

        $this->auth = $this->passwordSession('kamal');
        $this->api('PUT', 'catalogue/appearance/brand', ['patch' => ['tagline' => 'Duhok']])->assertOk();
        $this->api('POST', 'catalogue/collections', ['name' => ['en' => 'Oud Collection']])->assertCreated();
        $this->api('PUT', 'catalogue/perfumes/'.$product, ['hidden' => true])->assertOk();

        $this->auth = $this->passwordSession('sara');
        $this->api('PUT', 'catalogue/appearance/brand', ['patch' => ['tagline' => 'no']])
            ->assertStatus(403)->assertJsonPath('error.params.permission', 'catalogue.appearance');
        $this->api('POST', 'catalogue/collections', ['name' => ['en' => 'Mine']])
            ->assertStatus(403)->assertJsonPath('error.params.permission', 'catalogue.products');

        $this->auth = $owner;
    }

    public function test_a_visitor_is_shown_the_look_but_cannot_change_it(): void
    {
        $this->app['auth']->forgetGuards();
        $this->assertNotEmpty($this->look()['brand']);

        $this->putJson('/api/v1/catalogue/appearance/brand', ['patch' => ['gold' => '#000000']])->assertStatus(401);
    }

    public function test_the_sections_the_catalogue_knows_are_the_ones_it_offers(): void
    {
        // the list the admin screen shows and the list the catalogue draws are the same list
        $this->assertSame(
            ['hero', 'kinds', 'collections', 'featured', 'new', 'story', 'how'],
            AppearanceService::SECTIONS,
        );
    }

    private function passwordSession(string $username): array
    {
        $res = $this->api('POST', 'auth/login', ['username' => $username, 'password' => 'Passw0rd!x', 'app' => 'admin'], [])->assertOk();

        return ['Authorization' => 'Bearer '.$res->json('token')];
    }
}
