<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\User;
use App\Support\Time;
use Tests\ApiTestCase;

/** Running the live server: browser safety headers, proxies, and getting back in when the owner is locked out. */
class ServerOpsTest extends ApiTestCase
{
    public function test_every_response_carries_the_browser_safety_headers(): void
    {
        $res = $this->getJson('/api/v1/menu')->assertOk();
        $res->assertHeader('X-Content-Type-Options', 'nosniff')->assertHeader('X-Frame-Options', 'SAMEORIGIN')
            ->assertHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        // the scanner camera, the delegate's GPS and keep-screen-on stay allowed for the site itself
        $this->assertStringContainsString('camera=(self)', $res->headers->get('Permissions-Policy'));
        $this->assertStringContainsString('geolocation=(self)', $res->headers->get('Permissions-Policy'));
        $res->assertHeaderMissing('Strict-Transport-Security'); // plain http: HSTS would be ignored anyway

        $this->get('https://localhost/api/v1/menu')->assertHeader('Strict-Transport-Security', 'max-age=31536000');
        // errors get them too
        $this->getJson('/api/v1/nope')->assertNotFound()->assertHeader('X-Frame-Options', 'SAMEORIGIN');
    }

    public function test_https_behind_a_proxy_is_only_believed_when_the_proxy_is_trusted(): void
    {
        $viaProxy = ['HTTP_X_FORWARDED_PROTO' => 'https', 'REMOTE_ADDR' => '10.0.0.5'];
        $this->withServerVariables($viaProxy)->getJson('/api/v1/menu')->assertHeaderMissing('Strict-Transport-Security');

        config(['trustedproxy.proxies' => '10.0.0.5']);
        $this->withServerVariables($viaProxy)->getJson('/api/v1/menu')->assertHeader('Strict-Transport-Security', 'max-age=31536000');
    }

    public function test_a_locked_out_owner_gets_back_in_from_the_server(): void
    {
        $this->shop(false);
        $old = $this->auth;
        $owner = User::where('username', 'owner')->firstOrFail();
        $owner->update(['failed_attempts' => 3, 'locked_until' => Time::nowMs() + 600_000]);

        $this->artisan('lattafa:reset-admin')                       // only one Super Admin: no need to name them
            ->expectsOutputToContain('Resetting Owner (owner)')
            ->expectsQuestion('New password (press Enter to keep the current one)', 'abc')        // too short → asked again
            ->expectsOutputToContain('Too short')
            ->expectsQuestion('New password (press Enter to keep the current one)', 'كلمة سر جديدة')
            ->expectsQuestion('Type the new password again', 'كلمة سر جديدة')
            ->expectsQuestion('New PIN, 4 to 6 digits (press Enter to keep the current one)', '12a4')
            ->expectsOutputToContain('4 to 6 digits')
            ->expectsQuestion('New PIN, 4 to 6 digits (press Enter to keep the current one)', '8642')
            ->expectsQuestion('Type the new PIN again', '8642')
            ->expectsOutputToContain('signed out everywhere')
            ->assertSuccessful();

        $this->api('GET', 'auth/me', [], $old)->assertUnauthorized();   // the old sign-in is gone
        $this->api('POST', 'auth/login', ['username' => 'owner', 'password' => 'Owner1234'], [])->assertUnauthorized();
        $this->api('POST', 'auth/login', ['username' => 'owner', 'password' => 'كلمة سر جديدة'], [])->assertOk(); // lockout lifted
        $this->api('POST', 'auth/pin-login', ['userId' => $owner->id, 'pin' => '8642'], [])->assertOk();          // the till is still registered

        $log = AuditLog::where('action', 'user.reset_credentials')->sole();
        $this->assertSame('System', $log->user_name);
        $this->assertSame(['pin' => true, 'password' => true, 'via' => 'server'], $log->meta);
    }

    public function test_reset_refuses_people_who_are_not_super_admins_and_pins_already_in_use(): void
    {
        $this->shop(false);
        $this->makeUser('Sara', 'sara', 'cashier', '2468');

        $this->artisan('lattafa:reset-admin', ['username' => 'sara'])->expectsOutputToContain('No Super Admin has the username')->assertFailed();

        $this->artisan('lattafa:reset-admin', ['username' => 'OWNER'])
            ->expectsQuestion('New password (press Enter to keep the current one)', '')
            ->expectsQuestion('New PIN, 4 to 6 digits (press Enter to keep the current one)', '2468')    // Sara's
            ->expectsOutputToContain('Someone else already uses this PIN')
            ->expectsQuestion('New PIN, 4 to 6 digits (press Enter to keep the current one)', '')
            ->expectsOutputToContain('Nothing was changed')
            ->assertSuccessful();
        $this->api('POST', 'auth/login', ['username' => 'owner', 'password' => 'Owner1234'], [])->assertOk();
    }

    public function test_the_nightly_backup_is_scheduled(): void
    {
        $this->artisan('schedule:list')->expectsOutputToContain('lattafa:backup')->assertSuccessful();
    }
}
