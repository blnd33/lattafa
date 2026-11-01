<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Services\MenuMedia;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Tests\ApiTestCase;

/** The public menu: open to anyone, shows only what a customer may see. */
class MenuTest extends ApiTestCase
{
    public function test_the_menu_is_public_and_lists_only_products_marked_for_the_menu(): void
    {
        $this->shop();
        $hidden = Product::all()->first(fn ($p) => $p->name['en'] === 'Haya');
        $hidden->update(['show_on_menu' => false]);
        $inactive = Product::all()->first(fn ($p) => $p->name['en'] === 'Asad');
        $inactive->update(['active' => false]);

        $res = $this->getJson('/api/v1/menu')->assertOk(); // no token at all
        $names = collect($res->json('products'))->pluck('name.en');
        $this->assertCount(11, $names);
        $this->assertNotContains('Haya', $names);
        $this->assertNotContains('Asad', $names);
        $this->assertSame('Lattafa Test', $res->json('store.name'));
        $this->assertStringContainsString('public', (string) $res->headers->get('Cache-Control'));
    }

    public function test_the_menu_never_shows_cost_wholesale_or_stock_counts(): void
    {
        $this->shop();
        $raw = $this->getJson('/api/v1/menu')->assertOk()->getContent();
        foreach (['costIQD', 'cost_iqd', 'wholesale', 'retailIQD', '"stock"', 'minStock', 'sku', 'barcode', 'balance'] as $secret) {
            $this->assertStringNotContainsString($secret, $raw, "menu exposes $secret");
        }
        $khamrah = collect(json_decode($raw, true)['products'])->firstWhere('name.en', 'Khamrah');
        $this->assertSame([['label' => '100 ml', 'priceIQD' => 45000, 'available' => true], ['label' => '50 ml', 'priceIQD' => 30000, 'available' => true]],
            collect($khamrah['sizes'])->map(fn ($s) => collect($s)->only(['label', 'priceIQD', 'available'])->all())->all());
    }

    public function test_sold_out_sizes_are_marked_unavailable_and_featured_come_first(): void
    {
        $this->shop();
        $v = $this->variantOf('Raghba');
        $this->api('POST', 'stock/adjust', ['variantId' => $v->id, 'newQty' => 0, 'reason' => 'adjustment'])->assertOk();
        $products = collect($this->getJson('/api/v1/menu')->json('products'));
        $this->assertFalse($products->firstWhere('name.en', 'Raghba')['sizes'][0]['available']);
        $featured = $products->takeWhile(fn ($p) => $p['featured'])->count();
        $this->assertGreaterThan(0, $featured);
        $this->assertTrue($products->slice($featured)->every(fn ($p) => ! $p['featured']));
    }

    public function test_the_menu_before_setup_is_simply_empty(): void
    {
        $this->getJson('/api/v1/menu')->assertOk()->assertJsonPath('products', [])->assertJsonPath('menu.showPrices', true);
    }

    public function test_the_admin_arranges_the_menu_and_guests_see_it_that_way(): void
    {
        $this->shop();
        Product::all()->first(fn ($p) => $p->name['en'] === 'Haya')->update(['show_on_menu' => false]);
        $m = $this->api('GET', 'menu/manage')->assertOk()->assertJsonPath('canEditSettings', true)
            ->assertJsonPath('menu', ['showPrices' => true, 'hideSoldOut' => false, 'whatsapp' => '', 'heroDim' => 45, 'hero' => []]);
        $all = collect($m->json('products'));
        $this->assertCount(13, $all); // hidden perfumes are listed too, so they can be switched back on
        $this->assertFalse($all->firstWhere('name.en', 'Haya')['showOnMenu']);
        $this->assertNull($all[0]['order']);

        // reverse the order, put Haya back, take Khamrah off, mark Asad featured + new
        $flags = $all->map(fn ($p) => ['id' => $p['id'], 'showOnMenu' => $p['name']['en'] !== 'Khamrah', 'featured' => $p['name']['en'] === 'Asad' || $p['featured'], 'isNew' => $p['name']['en'] === 'Asad' || $p['isNew']])->all();
        $order = $all->pluck('id')->reverse()->values()->all();
        $this->api('PUT', 'menu/manage', ['products' => $flags, 'order' => $order])->assertOk()
            ->assertJsonPath('products.0.id', $order[0])->assertJsonPath('products.0.order', 1);

        $public = collect($this->getJson('/api/v1/menu')->json('products'));
        $expected = $all->reverse()->reject(fn ($p) => $p['name']['en'] === 'Khamrah')->pluck('name.en')->values()->all();
        $this->assertSame($expected, $public->pluck('name.en')->all());
        $this->assertTrue($public->firstWhere('name.en', 'Asad')['featured']);
        $this->assertTrue($public->firstWhere('name.en', 'Asad')['isNew']);
        $this->assertArrayNotHasKey('showOnMenu', $public[0]); // the switches and places are the admin's business
        $this->assertArrayNotHasKey('order', $public[0]);

        // a perfume without a place (added later) comes after the arranged ones, not in front of them
        $late = Product::all()->first(fn ($p) => $p->name['en'] === $expected[0]);
        $late->update(['menu_order' => null]);
        $this->assertSame($expected[0], collect($this->getJson('/api/v1/menu')->json('products'))->last()['name']['en']);

        // back to the automatic order: featured first, then A–Z
        $this->api('PUT', 'menu/manage', ['products' => [], 'autoOrder' => true])->assertOk();
        $this->assertSame(0, Product::whereNotNull('menu_order')->count());
        $auto = collect($this->getJson('/api/v1/menu')->json('products'));
        $featured = $auto->takeWhile(fn ($p) => $p['featured']);
        $this->assertContains('Asad', $featured->pluck('name.en'));
        foreach ([$featured, $auto->slice($featured->count())] as $part) {
            $names = $part->map(fn ($p) => mb_strtolower($p['name']['en']))->values()->all();
            $sorted = $names;
            sort($sorted);
            $this->assertSame($sorted, $names);
        }
        $this->assertDatabaseHas('audit_logs', ['action' => 'menu.update']);
    }

    public function test_menu_settings_hide_prices_and_sold_out_perfumes_and_set_the_whatsapp_number(): void
    {
        $this->shop();
        $raghba = Product::all()->first(fn ($p) => $p->name['en'] === 'Raghba');
        foreach ($raghba->variants as $v) {
            $this->api('POST', 'stock/adjust', ['variantId' => $v->id, 'newQty' => 0, 'reason' => 'adjustment'])->assertOk();
        }
        $this->api('PUT', 'menu/manage', ['products' => [], 'settings' => ['showPrices' => false, 'hideSoldOut' => true, 'whatsapp' => '0750 111 2222']])->assertOk()
            ->assertJsonPath('menu', ['showPrices' => false, 'hideSoldOut' => true, 'whatsapp' => '0750 111 2222', 'heroDim' => 45, 'hero' => []]);

        $res = $this->getJson('/api/v1/menu')->assertOk()->assertJsonPath('menu.whatsapp', '0750 111 2222')->assertJsonPath('menu.showPrices', false);
        $products = collect($res->json('products'));
        $this->assertNotContains('Raghba', $products->pluck('name.en'));
        $this->assertTrue($products->flatMap(fn ($p) => $p['sizes'])->every(fn ($s) => $s['priceIQD'] === null)); // prices never leave the server
        // the admin still sees the prices and the sold-out perfume (to arrange it and for the preview)
        $manage = collect($this->api('GET', 'menu/manage')->json('products'));
        $this->assertContains('Raghba', $manage->pluck('name.en'));
        $this->assertSame(45000, $manage->firstWhere('name.en', 'Khamrah')['sizes'][0]['priceIQD']);

        // emptying the WhatsApp box goes back to the shop's phone
        $this->api('PUT', 'menu/manage', ['products' => [], 'settings' => ['whatsapp' => '']])->assertOk()->assertJsonPath('menu.whatsapp', '')->assertJsonPath('menu.hideSoldOut', true);
        $this->api('PUT', 'menu/manage', ['products' => [], 'settings' => ['whatsapp' => 'call me']])->assertStatus(422);
    }

    public function test_arranging_the_menu_needs_product_editing_and_its_settings_need_settings_editing(): void
    {
        $this->shop();
        $ids = Product::pluck('id')->all();
        $stock = $this->makeUser('Dara', 'dara', 'stock_keeper', '3131');
        $cashier = $this->makeUser('Lana', 'lana', 'cashier', '4242');
        $this->api('PUT', 'menu/manage', ['products' => [], 'order' => [$ids[0], fake()->uuid()]])->assertNotFound();

        $this->asUser($stock, '3131');
        $this->api('GET', 'menu/manage')->assertOk()->assertJsonPath('canEditSettings', false);
        $this->api('PUT', 'menu/manage', ['products' => [], 'order' => $ids])->assertOk();
        $this->api('PUT', 'menu/manage', ['products' => [], 'settings' => ['showPrices' => false]])->assertForbidden();
        $this->assertTrue($this->getJson('/api/v1/menu')->json('menu.showPrices'));

        $this->asUser($cashier, '4242');
        $this->api('PUT', 'menu/manage', ['products' => [['id' => $ids[0], 'showOnMenu' => false, 'featured' => false, 'isNew' => false]]])->assertForbidden();
        $this->assertTrue((bool) Product::find($ids[0])->show_on_menu);
    }

    /* ── photos/videos behind the top of the menu ── */

    private const JPEG = "\xFF\xD8\xFF\xE0\x00\x10JFIF\x00";

    /** A file that starts like an MP4 video (the server only looks at the first bytes). */
    private static function mp4(int $bytes): string
    {
        return str_pad("\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00", $bytes, "\x00");
    }

    /** One piece, sent as the raw request body like the admin panel does. */
    private function part(string $id, int $at, string $bytes): TestResponse
    {
        $this->app['auth']->forgetGuards();

        return $this->call('PUT', "/api/v1/menu/media/$id/part?at=$at", [], [], [], [
            'HTTP_AUTHORIZATION' => $this->auth['Authorization'], 'HTTP_X_DEVICE_ID' => $this->deviceId,
            'HTTP_ACCEPT' => 'application/json', 'CONTENT_TYPE' => 'application/octet-stream',
        ], $bytes);
    }

    /** Uploads a whole file in pieces and returns the finish response. */
    private function upload(string $mime, string $bytes, ?string $poster = null): TestResponse
    {
        $id = $this->api('POST', 'menu/media', ['mime' => $mime, 'size' => strlen($bytes)])->assertCreated()->json('uploadId');
        foreach (str_split($bytes, MenuMedia::CHUNK) as $i => $piece) {
            $this->part($id, $i * MenuMedia::CHUNK, $piece)->assertOk();
        }

        return $this->api('POST', "menu/media/$id/finish", ['poster' => $poster]);
    }

    public function test_photos_and_videos_go_behind_the_top_of_the_menu(): void
    {
        Storage::fake('public');
        Storage::fake('local');
        $this->shop();

        // a 5 MB video arrives in three pieces; a piece sent to the wrong place is refused with where to carry on
        $video = self::mp4(5 * 1024 * 1024 + 123);
        $id = $this->api('POST', 'menu/media', ['mime' => 'video/mp4', 'size' => strlen($video)])->assertCreated()
            ->assertJsonPath('chunkBytes', MenuMedia::CHUNK)->json('uploadId');
        $this->part($id, 0, substr($video, 0, MenuMedia::CHUNK))->assertOk()->assertJsonPath('received', MenuMedia::CHUNK);
        $this->part($id, 0, substr($video, 0, MenuMedia::CHUNK))->assertStatus(409)->assertJsonPath('error.params.at', MenuMedia::CHUNK);
        $this->api('POST', "menu/media/$id/finish")->assertStatus(422)->assertJsonPath('error.code', 'media_broken'); // not all there yet
        $this->part($id, MenuMedia::CHUNK, substr($video, MenuMedia::CHUNK, MenuMedia::CHUNK))->assertOk();
        $this->part($id, 2 * MenuMedia::CHUNK, substr($video, 2 * MenuMedia::CHUNK))->assertOk();
        $poster = 'data:image/jpeg;base64,'.base64_encode(self::JPEG.str_repeat('x', 200));
        $m = $this->api('POST', "menu/media/$id/finish", ['poster' => $poster])->assertOk();
        $this->assertSame([['id' => $id, 'type' => 'video', 'src' => "/storage/menu/hero/$id.mp4", 'poster' => "/storage/menu/hero/$id-poster.jpg"]], $m->json('menu.hero'));
        Storage::disk('public')->assertExists(["menu/hero/$id.mp4", "menu/hero/$id-poster.jpg"]);
        $this->assertSame(strlen($video), Storage::disk('public')->size("menu/hero/$id.mp4"));
        $this->assertSame([], Storage::disk('local')->files('menu-uploads')); // nothing left half-done

        // a photo after it; guests get both, in that order, with how much they are darkened
        $photo = $this->upload('image/jpeg', self::JPEG.str_repeat('p', 5000))->assertOk()->json('menu.hero.1.id');
        $this->api('PUT', 'menu/manage', ['products' => [], 'settings' => ['heroDim' => 60]])->assertOk();
        $this->getJson('/api/v1/menu')->assertOk()->assertJsonPath('menu.heroDim', 60)
            ->assertJsonPath('menu.hero.0.type', 'video')->assertJsonPath('menu.hero.1.src', "/storage/menu/hero/$photo.jpg");

        // the photo first, then the video gone (its file and its first frame too)
        $this->api('PUT', 'menu/media/order', ['ids' => [$photo, $id]])->assertOk()->assertJsonPath('menu.hero.0.id', $photo);
        $this->api('DELETE', "menu/media/$id")->assertOk()->assertJsonCount(1, 'menu.hero');
        Storage::disk('public')->assertMissing(["menu/hero/$id.mp4", "menu/hero/$id-poster.jpg"]);
        $this->api('DELETE', "menu/media/$id")->assertNotFound();
        $this->assertDatabaseHas('audit_logs', ['action' => 'menu.media_add']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'menu.media_delete']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'menu.media_order']);
    }

    public function test_only_real_photos_and_videos_within_the_limits_are_taken(): void
    {
        Storage::fake('public');
        Storage::fake('local');
        $this->shop();
        $this->api('POST', 'menu/media', ['mime' => 'image/gif', 'size' => 10])->assertStatus(422)->assertJsonPath('error.code', 'media_type');
        $this->api('POST', 'menu/media', ['mime' => 'video/quicktime', 'size' => 10])->assertStatus(422)->assertJsonPath('error.code', 'media_type');
        $this->api('POST', 'menu/media', ['mime' => 'video/mp4', 'size' => MenuMedia::LIMIT['video'] + 1])->assertStatus(422)->assertJsonPath('error.code', 'media_too_big');
        // a "photo" that is really something else (here: a script) is refused once its bytes are seen
        $this->upload('image/png', '<?php echo "hi"; ?>'.str_repeat(' ', 100))->assertStatus(422)->assertJsonPath('error.code', 'media_type');
        $this->upload('image/png', self::mp4(500))->assertStatus(422)->assertJsonPath('error.code', 'media_type'); // a video posing as a photo
        // a piece bigger than allowed, or more than was announced, ends the upload
        $id = $this->api('POST', 'menu/media', ['mime' => 'image/jpeg', 'size' => 100])->json('uploadId');
        $this->part($id, 0, self::JPEG.str_repeat('x', 200))->assertStatus(422)->assertJsonPath('error.code', 'media_broken');
        $this->part($id, 0, self::JPEG)->assertNotFound();

        for ($i = 0; $i < MenuMedia::MAX_ITEMS; $i++) {
            $this->upload('image/jpeg', self::JPEG.$i)->assertOk();
        }
        $this->api('POST', 'menu/media', ['mime' => 'image/jpeg', 'size' => 10])->assertStatus(422)->assertJsonPath('error.code', 'media_full');
        $this->assertCount(MenuMedia::MAX_ITEMS, $this->getJson('/api/v1/menu')->json('menu.hero'));
    }

    public function test_only_someone_who_may_change_settings_can_change_the_photos_and_videos(): void
    {
        Storage::fake('public');
        Storage::fake('local');
        $this->shop();
        $photo = $this->upload('image/webp', 'RIFF'."\x10\x00\x00\x00".'WEBPVP8 '.str_repeat('w', 40))->assertOk()->json('menu.hero.0.id');
        $owner = $this->auth;
        $pending = $this->api('POST', 'menu/media', ['mime' => 'image/jpeg', 'size' => 20])->json('uploadId');

        $this->asUser($this->makeUser('Dara', 'dara', 'stock_keeper', '3131'), '3131');
        $this->api('GET', 'menu/manage')->assertOk()->assertJsonCount(1, 'menu.hero');
        $this->api('POST', 'menu/media', ['mime' => 'image/jpeg', 'size' => 20])->assertForbidden();
        $this->part($pending, 0, self::JPEG)->assertForbidden(); // someone else's upload
        $this->api('DELETE', "menu/media/$photo")->assertForbidden();
        $this->api('PUT', 'menu/media/order', ['ids' => [$photo]])->assertForbidden();
        $this->auth = $owner;
        $this->assertCount(1, $this->getJson('/api/v1/menu')->json('menu.hero'));
    }
}
