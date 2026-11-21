<?php

namespace Tests\Feature;

use App\Models\CatalogueCountry;
use App\Models\WholesaleAccessCode;
use App\Models\WholesaleCustomer;
use App\Models\WholesaleSession;
use App\Support\Time;
use Illuminate\Support\Facades\RateLimiter;
use Tests\ApiTestCase;

/**
 * The wholesale access code — the one thing between a visitor and a buyer's own prices.
 *
 * Everything the brief asks of it (§12, §40): a good code works, a bad one says nothing useful, an expired or
 * withdrawn one is refused, a business on hold cannot buy, a code tied to a country stays there, guessing is
 * slowed, and a code is a key to one business's catalogue and nothing else — no staff screens, no other buyer.
 */
class WholesaleAccessTest extends ApiTestCase
{
    private string $customerId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->shop();
        $this->customerId = $this->api('POST', 'catalogue/customers', [
            'businessName' => 'Istanbul Perfumes', 'contactPerson' => 'Mert', 'phone' => '+90 555 000 0000',
        ])->assertCreated()->json('customer.id');
    }

    /** Generates a code for the business and returns it in plain text, as the admin panel would see it once. */
    private function issue(array $opts = [], ?string $customerId = null): string
    {
        $res = $this->api('POST', 'catalogue/customers/'.($customerId ?? $this->customerId).'/codes', $opts)->assertCreated();
        $this->assertSame(0, $res->json('code.uses'), 'a brand-new code reads as unused, the same as it does in the list');

        return $res->json('plain');
    }

    private function unlock(string $code, ?string $country = null)
    {
        return $this->postJson('/api/v1/wholesale/unlock', array_filter(['code' => $code, 'country' => $country]));
    }

    /**
     * A request carrying only a buyer's token.
     *
     * The guard is dropped first: one test makes several requests through the same application instance, so a staff
     * account resolved by an earlier call would still be sitting in the auth manager and answer this one (the same
     * reason `ApiTestCase::api()` does it). Without this the test would pass while proving nothing.
     */
    private function buyer(string $token): self
    {
        $this->app['auth']->forgetGuards();

        return $this->withHeaders(['Authorization' => 'Bearer '.$token, 'Accept' => 'application/json']);
    }

    // ───────────────────────── the code itself ─────────────────────────

    public function test_a_good_code_unlocks_and_says_whose_catalogue_it_is(): void
    {
        $code = $this->issue();
        $this->assertMatchesRegularExpression('/^LAT-[0-9A-Z]{8}$/', $code);

        $res = $this->unlock($code)->assertOk();
        $this->assertNotEmpty($res->json('token'));
        $this->assertSame('Istanbul Perfumes', $res->json('session.business'));

        // and the token works afterwards
        $this->buyer($res->json('token'))
            ->getJson('/api/v1/wholesale/me')->assertOk()->assertJsonPath('session.business', 'Istanbul Perfumes');
    }

    public function test_a_code_is_shown_once_and_never_again(): void
    {
        $code = $this->issue();

        // the row that remembers it keeps neither the code nor anything a code could be rebuilt from
        $row = WholesaleAccessCode::firstOrFail();
        $this->assertStringNotContainsString(substr($code, 4, 4), $row->display);
        $this->assertSame('LAT-••••'.substr($code, -4), $row->display);

        $listed = $this->api('GET', 'catalogue/customers/'.$this->customerId.'/codes')->assertOk()->json('codes.0');
        $this->assertSame($row->display, $listed['display']);
        $this->assertArrayNotHasKey('plain', $listed);
        $this->assertArrayNotHasKey('fingerprint', $listed);
        $this->assertArrayNotHasKey('hash', $listed);

        // nor does the activity log — read as text, because PostgreSQL has no `json = text` operator to compare with
        $entry = \DB::table('audit_logs')->where('action', 'catalogue.code_issued')->value('meta');
        $this->assertStringNotContainsString($code, (string) $entry);
        // decoded, not matched as text: the bullets in the masked display are written as • in the column
        $this->assertSame($row->display, json_decode((string) $entry, true)['code'] ?? null, 'the masked display is what is kept');
    }

    public function test_an_unknown_code_is_simply_not_recognised(): void
    {
        $this->unlock('LAT-ZZZZZZZZ')->assertStatus(422)->assertJsonPath('error.code', 'code_invalid');
        $this->unlock('nonsense')->assertStatus(422)->assertJsonPath('error.code', 'code_invalid');
        $this->assertSame(0, WholesaleSession::count());
    }

    public function test_spaces_lower_case_and_a_missing_prefix_are_the_same_code(): void
    {
        $code = $this->issue();
        $body = substr($code, 4);

        $this->unlock(strtolower($code))->assertOk();
        $this->unlock($body)->assertOk();
        $this->unlock(' '.substr($code, 0, 6).' '.substr($code, 6).' ')->assertOk();
    }

    public function test_an_expired_code_says_so(): void
    {
        $code = $this->issue();
        WholesaleAccessCode::firstOrFail()->update(['expires_at' => Time::nowMs() - 1000]);

        $this->unlock($code)->assertStatus(422)->assertJsonPath('error.code', 'code_expired');
    }

    public function test_an_expiry_in_the_past_is_refused_when_the_code_is_made(): void
    {
        $this->api('POST', 'catalogue/customers/'.$this->customerId.'/codes', ['expiresAt' => Time::nowMs() - 5000])
            ->assertStatus(422)->assertJsonPath('error.code', 'expiry_in_the_past');
    }

    public function test_a_withdrawn_code_can_never_be_used_again(): void
    {
        $code = $this->issue();
        $id = WholesaleAccessCode::firstOrFail()->id;

        $this->api('POST', 'catalogue/codes/'.$id.'/revoke')->assertOk()->assertJsonPath('code.revoked', true);
        $this->unlock($code)->assertStatus(422)->assertJsonPath('error.code', 'code_revoked');

        // and it cannot be quietly switched back on
        $this->api('PATCH', 'catalogue/codes/'.$id.'/active', ['active' => true])
            ->assertStatus(422)->assertJsonPath('error.code', 'code_revoked');
    }

    public function test_a_code_switched_off_stops_working_and_can_be_switched_back_on(): void
    {
        $code = $this->issue();
        $id = WholesaleAccessCode::firstOrFail()->id;

        $this->api('PATCH', 'catalogue/codes/'.$id.'/active', ['active' => false])->assertOk();
        $this->unlock($code)->assertStatus(422)->assertJsonPath('error.code', 'code_revoked');

        $this->api('PATCH', 'catalogue/codes/'.$id.'/active', ['active' => true])->assertOk();
        $this->unlock($code)->assertOk();
    }

    public function test_a_business_on_hold_cannot_unlock_anything(): void
    {
        $code = $this->issue();
        $this->api('PATCH', 'catalogue/customers/'.$this->customerId.'/status', ['status' => 'suspended'])->assertOk();

        $this->unlock($code)->assertStatus(422)->assertJsonPath('error.code', 'customer_inactive');
    }

    // ───────────────────────── countries ─────────────────────────

    public function test_a_code_tied_to_a_country_stays_in_that_country(): void
    {
        $iraq = CatalogueCountry::where('iso2', 'IQ')->firstOrFail();
        $turkey = $this->api('POST', 'catalogue/countries', [
            'iso2' => 'TR', 'name' => ['en' => 'Türkiye'], 'language' => 'en', 'enabled' => true,
        ])->assertCreated()->json('country.id');

        $code = $this->issue(['countryId' => $turkey]);

        $this->unlock($code, 'TR')->assertOk()->assertJsonPath('session.country.iso2', 'TR');
        $this->unlock($code, $iraq->iso2)->assertStatus(422)->assertJsonPath('error.code', 'code_country');
        // with no country asked for, the code's own is used
        $this->unlock($code)->assertOk()->assertJsonPath('session.country.iso2', 'TR');
    }

    /**
     * The catalogue sends the ISO code, never the id — `unlock(code, country?.iso2)`.
     *
     * This passed on SQLite while failing on PostgreSQL for the whole of the catalogue's first day live: the id
     * column is a real `uuid` there, and comparing it with "IQ" is error 22P02, which the buyer met as "something
     * went wrong". Both spellings are asserted here, and the suite is run on PostgreSQL before a deploy.
     */
    public function test_a_country_can_be_named_by_its_iso_code_or_its_id(): void
    {
        $iraq = CatalogueCountry::where('iso2', 'IQ')->firstOrFail();

        $this->unlock($this->issue(), 'IQ')->assertOk()->assertJsonPath('session.country.iso2', 'IQ');
        $this->unlock($this->issue(), 'iq')->assertOk()->assertJsonPath('session.country.iso2', 'IQ');
        $this->unlock($this->issue(), $iraq->id)->assertOk()->assertJsonPath('session.country.iso2', 'IQ');

        // a country nobody has opened is simply not found — never a 500
        $this->unlock($this->issue(), 'ZZ')->assertOk()->assertJsonPath('session.country', null);
        $this->unlock($this->issue(), 'not-a-uuid-or-an-iso')->assertOk()->assertJsonPath('session.country', null);
    }

    public function test_a_code_with_no_country_follows_the_business(): void
    {
        $iraq = CatalogueCountry::where('iso2', 'IQ')->firstOrFail();
        $this->api('PUT', 'catalogue/customers/'.$this->customerId, [
            'businessName' => 'Istanbul Perfumes', 'countryId' => $iraq->id,
        ])->assertOk();

        $this->unlock($this->issue())->assertOk()->assertJsonPath('session.country.iso2', 'IQ');
    }

    // ───────────────────────── guessing ─────────────────────────

    public function test_guessing_is_slowed_after_ten_refusals_from_one_address(): void
    {
        for ($i = 0; $i < 10; $i++) {
            $this->unlock('LAT-'.str_pad((string) $i, 8, 'A'))->assertStatus(422);
        }
        $this->unlock('LAT-ZZZZZZZZ')->assertStatus(429)->assertJsonPath('error.code', 'too_many_requests');

        // even the right code waits its turn — the address is what is being held, not the code
        $this->unlock($this->issue())->assertStatus(429);
    }

    public function test_picking_the_wrong_country_is_not_counted_as_a_guess(): void
    {
        $turkey = $this->api('POST', 'catalogue/countries', [
            'iso2' => 'TR', 'name' => ['en' => 'Türkiye'], 'language' => 'en', 'enabled' => true,
        ])->assertCreated()->json('country.id');
        $code = $this->issue(['countryId' => $turkey]);

        for ($i = 0; $i < 12; $i++) {
            $this->unlock($code, 'IQ')->assertStatus(422)->assertJsonPath('error.code', 'code_country');
        }
        $this->unlock($code, 'TR')->assertOk();
    }

    protected function tearDown(): void
    {
        RateLimiter::clear('wholesale-unlock:127.0.0.1');
        parent::tearDown();
    }

    // ───────────────────────── what a code is NOT ─────────────────────────

    public function test_a_buyers_token_opens_no_staff_screen_at_all(): void
    {
        $token = $this->unlock($this->issue())->assertOk()->json('token');

        foreach (['products', 'customers', 'sales', 'dashboard', 'users', 'settings', 'catalogue/customers', 'audit'] as $path) {
            $status = $this->buyer($token)->getJson('/api/v1/'.$path)->getStatusCode();
            $this->assertSame(401, $status, "a buyer's token reached /$path");
        }
        // it cannot give itself a code either
        $this->buyer($token)->postJson('/api/v1/catalogue/customers/'.$this->customerId.'/codes')->assertStatus(401);
    }

    public function test_a_buyer_never_sees_another_buyer(): void
    {
        $other = $this->api('POST', 'catalogue/customers', ['businessName' => 'Dubai Scents'])->assertCreated()->json('customer.id');
        $this->issue([], $other);

        $token = $this->unlock($this->issue())->assertOk()->json('token');
        $me = $this->buyer($token)->getJson('/api/v1/wholesale/me')->assertOk();

        $this->assertSame('Istanbul Perfumes', $me->json('session.business'));
        $this->assertStringNotContainsString('Dubai Scents', $me->getContent());
        $this->assertStringNotContainsString('notes', $me->getContent());
    }

    public function test_withdrawing_a_code_shuts_the_door_on_whoever_is_already_inside(): void
    {
        $token = $this->unlock($this->issue())->assertOk()->json('token');
        $this->buyer($token)->getJson('/api/v1/wholesale/me')->assertOk();

        $this->api('POST', 'catalogue/codes/'.WholesaleAccessCode::firstOrFail()->id.'/revoke')->assertOk();

        $this->buyer($token)->getJson('/api/v1/wholesale/me')
            ->assertStatus(401)->assertJsonPath('error.code', 'not_unlocked');
    }

    public function test_putting_a_business_on_hold_shuts_the_door_too(): void
    {
        $token = $this->unlock($this->issue())->assertOk()->json('token');

        $this->api('PATCH', 'catalogue/customers/'.$this->customerId.'/status', ['status' => 'suspended'])->assertOk();

        $this->buyer($token)->getJson('/api/v1/wholesale/me')->assertStatus(401);
    }

    public function test_a_buyer_can_sign_themselves_out(): void
    {
        $token = $this->unlock($this->issue())->assertOk()->json('token');

        $this->buyer($token)->postJson('/api/v1/wholesale/lock')->assertOk();
        $this->buyer($token)->getJson('/api/v1/wholesale/me')->assertStatus(401);
    }

    public function test_unlocking_is_counted_and_dated(): void
    {
        $code = $this->issue();
        $this->unlock($code)->assertOk();
        $this->unlock($code)->assertOk();

        $row = WholesaleAccessCode::firstOrFail();
        $this->assertSame(2, $row->uses);
        $this->assertGreaterThan(0, $row->last_used_at);
        $this->assertSame(2, WholesaleCustomer::find($this->customerId)->sessions()->count());
    }

    // ───────────────────────── who may do what ─────────────────────────

    public function test_the_two_catalogue_roles_mind_their_own_half_over_the_wire(): void
    {
        $sales = $this->makeUser('Sara', 'sara', 'sales_manager', '4242');
        $cataloguer = $this->makeUser('Kamal', 'kamal', 'catalogue_manager', '4343');
        $owner = $this->auth;

        // the Sales Manager looks after who buys and on what terms
        $this->auth = $this->passwordSession('sara');
        $this->api('POST', 'catalogue/customers/'.$this->customerId.'/codes')->assertCreated();
        $this->api('POST', 'catalogue/countries', ['iso2' => 'DE', 'name' => ['en' => 'Germany'], 'language' => 'en'])
            ->assertStatus(403)->assertJsonPath('error.params.permission', 'catalogue.countries');

        // the Catalogue Manager looks after the perfumes and the words
        $this->auth = $this->passwordSession('kamal');
        $this->api('POST', 'catalogue/countries', ['iso2' => 'DE', 'name' => ['en' => 'Germany'], 'language' => 'en'])->assertCreated();
        $this->api('POST', 'catalogue/customers/'.$this->customerId.'/codes')
            ->assertStatus(403)->assertJsonPath('error.params.permission', 'catalogue.codes');

        $this->auth = $owner;
        $this->assertSame($cataloguer !== $sales, true);
    }

    /** Signs in with username + password as the admin panel does (these roles never stand at a till). */
    private function passwordSession(string $username): array
    {
        $res = $this->api('POST', 'auth/login', ['username' => $username, 'password' => 'Passw0rd!x', 'app' => 'admin'], [])->assertOk();

        return ['Authorization' => 'Bearer '.$res->json('token')];
    }
}
