<?php

namespace Tests\Feature;

use App\Models\CatalogueCountry;
use App\Support\CatalogueStrings;
use Tests\ApiTestCase;

/**
 * Where the catalogue is open and in what words — all of it rows the owner edits, none of it in code.
 *
 * The brief's §44 Scenario 11 is the test that matters here: a country added from the admin panel, pointed at a
 * language and given its smallest order, becomes available to buyers without the application changing.
 */
class CatalogueGeographyTest extends ApiTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $this->shop();
    }

    private function open(?string $language = null)
    {
        return $this->getJson('/api/v1/wholesale/open'.($language ? '?language='.$language : ''));
    }

    /** One word out of the catalogue's dictionary. (Its keys hold dots, which `json('words.cat.explore')` would read as nesting.) */
    private function word(?string $language, string $key): ?string
    {
        return $this->open($language)->assertOk()->json('words')[$key] ?? null;
    }

    // ───────────────────────── countries ─────────────────────────

    public function test_the_catalogue_opens_with_the_shops_own_country_and_the_languages_it_speaks(): void
    {
        $res = $this->open()->assertOk();

        $this->assertSame(['IQ'], array_column($res->json('countries'), 'iso2'));
        $this->assertEqualsCanonicalizing(['en', 'ar', 'ckb'], array_column($res->json('languages'), 'code'));
        $this->assertSame('USD', $res->json('currency'));
        $this->assertNotNull($res->json('defaultCountryId'));
        // Iraq opens in Arabic, so that is the language a visitor is given first
        $this->assertSame('ar', $res->json('language'));
    }

    /** §44 Scenario 11 — a new country becomes available with no application change. */
    public function test_a_country_added_from_the_admin_panel_is_open_to_buyers_at_once(): void
    {
        $this->api('PUT', 'catalogue/languages', ['code' => 'tr', 'enabled' => true])->assertOk();

        $this->api('POST', 'catalogue/countries', [
            'iso2' => 'tr', 'name' => ['en' => 'Türkiye', 'tr' => 'Türkiye'], 'language' => 'tr',
            'enabled' => true, 'sort' => 2, 'minOrderCents' => 50000,
        ])->assertCreated()->assertJsonPath('country.iso2', 'TR');

        $res = $this->open()->assertOk();
        $turkey = collect($res->json('countries'))->firstWhere('iso2', 'TR');

        $this->assertNotNull($turkey);
        $this->assertSame('tr', $turkey['language']);
        $this->assertSame(50000, $turkey['minOrderCents']);     // $500.00, in whole cents
        $this->assertSame('Türkiye', $turkey['name']['en']);
    }

    public function test_a_country_that_is_switched_off_is_not_offered(): void
    {
        $iraq = CatalogueCountry::where('iso2', 'IQ')->firstOrFail();

        $this->api('PUT', 'catalogue/countries/'.$iraq->id, [
            'iso2' => 'IQ', 'name' => $iraq->name, 'language' => 'ar', 'enabled' => false,
        ])->assertOk();

        $this->assertSame([], $this->open()->assertOk()->json('countries'));
    }

    public function test_a_country_whose_language_was_switched_off_is_not_offered_either(): void
    {
        // Germany, opening in German, which nobody has translated yet
        $this->api('POST', 'catalogue/countries', [
            'iso2' => 'DE', 'name' => ['en' => 'Germany'], 'language' => 'de', 'enabled' => true,
        ])->assertCreated();

        // it is on file, but a buyer is never sent to a catalogue with no words
        $this->assertNotNull(CatalogueCountry::where('iso2', 'DE')->first());
        $this->assertSame(['IQ'], array_column($this->open()->assertOk()->json('countries'), 'iso2'));
    }

    public function test_there_is_always_exactly_one_country_offered_first(): void
    {
        $this->api('PUT', 'catalogue/languages', ['code' => 'tr', 'enabled' => true])->assertOk();
        $turkey = $this->api('POST', 'catalogue/countries', [
            'iso2' => 'TR', 'name' => ['en' => 'Türkiye'], 'language' => 'tr', 'enabled' => true, 'isDefault' => true,
        ])->assertCreated()->json('country.id');

        $this->assertSame(1, CatalogueCountry::where('is_default', true)->count());
        $this->assertSame($turkey, $this->open()->assertOk()->json('defaultCountryId'));

        // switching the default off hands the job to the one that is left
        $this->api('PUT', 'catalogue/countries/'.$turkey, [
            'iso2' => 'TR', 'name' => ['en' => 'Türkiye'], 'language' => 'tr', 'enabled' => false,
        ])->assertOk();

        $this->assertSame(1, CatalogueCountry::where('is_default', true)->where('enabled', true)->count());
        $this->assertSame('IQ', CatalogueCountry::where('is_default', true)->value('iso2'));
    }

    public function test_a_country_its_buyers_are_tied_to_cannot_be_removed(): void
    {
        $iraq = CatalogueCountry::where('iso2', 'IQ')->firstOrFail();
        $this->api('POST', 'catalogue/customers', ['businessName' => 'Baghdad Scents', 'countryId' => $iraq->id])->assertCreated();

        $this->api('DELETE', 'catalogue/countries/'.$iraq->id)
            ->assertStatus(422)->assertJsonPath('error.code', 'country_in_use');
        $this->assertNotNull(CatalogueCountry::find($iraq->id));
    }

    public function test_a_country_nobody_buys_from_can_be_removed(): void
    {
        $id = $this->api('POST', 'catalogue/countries', ['iso2' => 'AE', 'name' => ['en' => 'UAE'], 'language' => 'ar'])
            ->assertCreated()->json('country.id');

        $this->api('DELETE', 'catalogue/countries/'.$id)->assertOk();
        $this->assertNull(CatalogueCountry::find($id));
    }

    public function test_the_same_country_cannot_be_added_twice(): void
    {
        $this->api('POST', 'catalogue/countries', ['iso2' => 'IQ', 'name' => ['en' => 'Iraq'], 'language' => 'ar'])
            ->assertStatus(422)->assertJsonPath('error.code', 'country_exists');
    }

    public function test_a_country_must_have_a_name_and_a_language_the_catalogue_knows(): void
    {
        $this->api('POST', 'catalogue/countries', ['iso2' => 'FR', 'name' => ['en' => '  '], 'language' => 'fr'])
            ->assertStatus(422)->assertJsonPath('error.code', 'country_name_required');
        $this->api('POST', 'catalogue/countries', ['iso2' => 'FR', 'name' => ['en' => 'France'], 'language' => 'xx'])
            ->assertStatus(422)->assertJsonPath('error.code', 'language_unknown');
    }

    // ───────────────────────── languages ─────────────────────────

    public function test_the_catalogue_can_never_be_left_without_a_language(): void
    {
        // Arabic is what Iraq opens in, so it cannot be taken away under it
        $this->api('PUT', 'catalogue/languages', ['code' => 'ar', 'enabled' => false])
            ->assertStatus(422)->assertJsonPath('error.code', 'language_in_use');

        // Kurdish opens no country, so switching it off harms nobody
        $this->api('PUT', 'catalogue/languages', ['code' => 'ckb', 'enabled' => false])->assertOk();

        // point Iraq elsewhere and Arabic may go too
        $iraq = CatalogueCountry::where('iso2', 'IQ')->firstOrFail();
        $this->api('PUT', 'catalogue/countries/'.$iraq->id, ['iso2' => 'IQ', 'name' => $iraq->name, 'language' => 'en', 'enabled' => true])->assertOk();
        $this->api('PUT', 'catalogue/languages', ['code' => 'ar', 'enabled' => false])->assertOk();

        // English is the last one standing, and it stays
        $this->api('PUT', 'catalogue/languages', ['code' => 'en', 'enabled' => false])
            ->assertStatus(422)->assertJsonPath('error.code', 'language_last_enabled');
    }

    public function test_a_language_can_be_added_without_touching_the_code(): void
    {
        $this->api('PUT', 'catalogue/languages', [
            'code' => 'es', 'name' => 'Spanish', 'native' => 'Español', 'rtl' => false, 'enabled' => true, 'sort' => 9,
        ])->assertOk()->assertJsonPath('language.native', 'Español');

        $this->assertContains('es', array_column($this->open()->assertOk()->json('languages'), 'code'));
    }

    // ───────────────────────── the words ─────────────────────────

    public function test_a_language_falls_back_to_english_until_it_is_translated(): void
    {
        $res = $this->open('ar')->assertOk();

        $this->assertSame(CatalogueStrings::EN['cat.explore'], $res->json('words')['cat.explore']);
        $this->assertCount(count(CatalogueStrings::keys()), (array) $res->json('words'));
    }

    public function test_what_is_translated_is_used_and_what_is_cleared_falls_back_again(): void
    {
        $this->api('PUT', 'catalogue/translations/ar', ['values' => ['cat.explore' => 'تصفّح المجموعة']])
            ->assertOk()->assertJsonPath('changed', 1);

        $this->assertSame('تصفّح المجموعة', $this->word('ar', 'cat.explore'));
        // English is untouched by it
        $this->assertSame(CatalogueStrings::EN['cat.explore'], $this->word('en', 'cat.explore'));

        $this->api('PUT', 'catalogue/translations/ar', ['values' => ['cat.explore' => '']])->assertOk()->assertJsonPath('changed', 1);
        $this->assertSame(CatalogueStrings::EN['cat.explore'], $this->word('ar', 'cat.explore'));
    }

    public function test_a_key_the_catalogue_does_not_use_is_never_stored(): void
    {
        $this->api('PUT', 'catalogue/translations/ar', ['values' => ['made.up.key' => 'nonsense']])
            ->assertOk()->assertJsonPath('changed', 0);

        $this->assertDatabaseMissing('catalogue_translations', ['key' => 'made.up.key']);
    }

    public function test_the_owner_can_see_how_far_each_language_has_got(): void
    {
        $total = count(CatalogueStrings::keys());
        $this->api('PUT', 'catalogue/translations/ar', ['values' => ['cat.explore' => 'تصفّح', 'cat.cart' => 'طلبك']])->assertOk();

        $progress = collect($this->api('GET', 'catalogue/translations')->assertOk()->json('languages'));

        $this->assertSame($total, $progress->firstWhere('language', 'en')['done'], 'English ships complete');
        $this->assertSame(2, $progress->firstWhere('language', 'ar')['done']);
        $this->assertSame(0, $progress->firstWhere('language', 'tr')['done']);
        $this->assertSame($total, $progress->firstWhere('language', 'tr')['total']);
    }

    public function test_the_translation_sheet_shows_english_beside_every_missing_word(): void
    {
        $sheet = $this->api('GET', 'catalogue/translations/tr')->assertOk();

        $this->assertSame(0, $sheet->json('done'));
        $this->assertSame(count(CatalogueStrings::keys()), $sheet->json('total'));
        $row = collect($sheet->json('rows'))->firstWhere('key', 'cat.explore');
        $this->assertSame(CatalogueStrings::EN['cat.explore'], $row['en']);
        $this->assertSame('', $row['value']);
    }

    public function test_a_visitor_is_told_nothing_about_prices_or_who_buys(): void
    {
        $this->api('POST', 'catalogue/customers', ['businessName' => 'Baghdad Scents', 'notes' => 'pays late'])->assertCreated();

        $res = $this->open()->assertOk();
        $body = $res->getContent();

        $this->assertStringNotContainsString('Baghdad Scents', $body);
        $this->assertStringNotContainsString('pays late', $body);

        // This reply has a fixed shape, and no perfume is in it — so there is nothing a price could hang off.
        $this->assertSame(['countries', 'languages', 'defaultCountryId', 'language', 'words', 'currency', 'whatsapp', 'look'], array_keys($res->json()));
        $this->assertSame(
            ['id', 'iso2', 'name', 'language', 'minOrderCents', 'isDefault'],
            array_keys($res->json('countries.0')),
            'the only money a visitor is given is the smallest order each country publishes',
        );
    }

    public function test_the_words_are_the_only_place_the_catalogue_says_price_at_all(): void
    {
        $words = $this->open()->assertOk()->json('words');

        // the dictionary talks about prices, which is its job…
        $this->assertNotEmpty(array_filter($words, fn (string $w) => str_contains(strtolower($w), 'price')));
        // …and carries not one figure
        foreach ($words as $key => $word) {
            $this->assertDoesNotMatchRegularExpression('/\$\s?\d/', $word, $key);
        }
    }
}
