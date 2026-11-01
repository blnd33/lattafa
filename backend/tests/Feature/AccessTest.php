<?php

namespace Tests\Feature;

use App\Models\Device;
use App\Models\Role;
use App\Models\User;
use App\Services\Credentials;
use Illuminate\Support\Str;
use Tests\ApiTestCase;

/** First-run setup, sign-in, and the Super Admin's control over accounts, roles and permissions. */
class AccessTest extends ApiTestCase
{
    public function test_setup_creates_super_admin_roles_and_demo_data_exactly_once(): void
    {
        $this->getJson('/api/v1/setup/status')->assertOk()->assertJson(['setupDone' => false]);
        $this->shop();
        $this->getJson('/api/v1/setup/status')->assertJson(['setupDone' => true]);

        $this->assertEqualsCanonicalizing(['cashier', 'delegate', 'manager', 'stock_keeper', 'super_admin'], Role::pluck('key')->all());
        $this->assertSame(1, User::count());
        $this->assertGreaterThan(10, \App\Models\Product::count());
        $me = $this->api('GET', 'auth/me')->assertOk()->json('user');
        $this->assertTrue($me['isSuperAdmin']);
        $this->assertContains('*', $me['permissions']);

        $this->postJson('/api/v1/setup', ['store' => [], 'rate' => 1460, 'admin' => ['name' => 'X', 'username' => 'xxx', 'password' => 'Abcdef12', 'pin' => '1234']])
            ->assertStatus(409)->assertJsonPath('error.code', 'setup_already_done');
    }

    public function test_setup_rejects_weak_credentials(): void
    {
        $base = ['store' => [], 'rate' => 1460, 'admin' => ['name' => 'A', 'username' => 'aaa', 'password' => 'Abcdef12', 'pin' => '1234']];
        $this->postJson('/api/v1/setup', array_replace_recursive($base, ['admin' => ['password' => 'abc']]))->assertStatus(422)->assertJsonPath('error.code', 'password_short');
        $this->postJson('/api/v1/setup', array_replace_recursive($base, ['admin' => ['password' => str_repeat('a', 73)]]))->assertStatus(422)->assertJsonPath('error.code', 'password_long');
        // 37 Kurdish letters = 74 bytes: past what bcrypt reads
        $this->postJson('/api/v1/setup', array_replace_recursive($base, ['admin' => ['password' => str_repeat('ک', 37)]]))->assertStatus(422)->assertJsonPath('error.code', 'password_long');
        $this->postJson('/api/v1/setup', array_replace_recursive($base, ['admin' => ['pin' => '12']]))->assertStatus(422)->assertJsonPath('error.code', 'pin_invalid');
        $this->assertSame(0, User::count()); // nothing half-created
    }

    public function test_passwords_are_free_form(): void
    {
        // any characters at all — Kurdish letters, a space, a symbol — no letters-and-numbers rule
        $password = 'دهۆک لطافة!';
        $this->postJson('/api/v1/setup', ['store' => [], 'rate' => 1460, 'admin' => ['name' => 'A', 'username' => 'aaa', 'password' => $password, 'pin' => '1234'], 'deviceId' => (string) Str::uuid()])->assertCreated();
        $this->postJson('/api/v1/auth/login', ['username' => 'aaa', 'password' => $password])->assertOk();
        $this->postJson('/api/v1/auth/login', ['username' => 'aaa', 'password' => 'دهۆک'])->assertStatus(401);
        // the shortest and the longest allowed
        Credentials::assertPassword('abcd');
        Credentials::assertPassword(str_repeat('a', 72));
        $this->addToAssertionCount(2); // neither throws
    }

    public function test_password_login_and_device_registration(): void
    {
        $this->shop();
        $newDevice = (string) Str::uuid();
        $res = $this->withHeaders(['X-Device-Id' => $newDevice])->postJson('/api/v1/auth/login', ['username' => 'owner', 'password' => 'Owner1234', 'deviceName' => 'Tablet']);
        $res->assertOk();
        $this->assertNotNull(Device::find($newDevice)); // the Super Admin registers a new till by signing in on it
        $this->postJson('/api/v1/auth/login', ['username' => 'owner', 'password' => 'wrong-password'])->assertStatus(401)->assertJsonPath('error.code', 'invalid_credentials');
    }

    public function test_pin_login_only_lists_pos_users(): void
    {
        $this->shop();
        $cashier = $this->makeUser('Ali', 'alii', 'cashier', '3333');
        $rep = $this->makeUser('Rep', 'rep1', 'delegate', '4444');

        $this->api('GET', 'auth/login-users', [], [])->assertOk();
        $names = collect($this->api('GET', 'auth/login-users', [], [])->json('users'))->pluck('name')->all();
        $this->assertContains('Ali', $names);
        $this->assertNotContains('Rep', $names);

        $this->asUser($cashier, '3333');
        $this->api('GET', 'auth/me')->assertJsonPath('user.roleKey', 'cashier');
        $this->api('POST', 'auth/pin-login', ['userId' => $rep, 'pin' => '4444'], [])->assertStatus(403)->assertJsonPath('error.code', 'app_not_allowed');
    }

    public function test_a_new_till_or_phone_connects_with_the_first_good_pin_and_no_admin_password(): void
    {
        $this->shop();
        $cashier = $this->makeUser('Ali', 'alii', 'cashier', '3333');
        $rep = $this->makeUser('Rep', 'rep1', 'delegate', '4444');
        $till = (string) Str::uuid();
        $phone = (string) Str::uuid();

        // a till nobody has signed in on yet shows the names, and is not added just for opening the page
        $this->withHeaders(['X-Device-Id' => $till])->getJson('/api/v1/auth/login-users')->assertOk()->assertJsonFragment(['name' => 'Ali']);
        $this->assertNull(Device::find($till));
        // a wrong PIN connects nothing
        $this->withHeaders(['X-Device-Id' => $till])->postJson('/api/v1/auth/pin-login', ['userId' => $cashier, 'pin' => '9999'])->assertStatus(401);
        $this->assertNull(Device::find($till));
        // the cashier's own PIN connects it: the next till code, named as the till calls itself
        $this->withHeaders(['X-Device-Id' => $till])->postJson('/api/v1/auth/pin-login', ['userId' => $cashier, 'pin' => '3333', 'deviceName' => 'Front desk'])
            ->assertOk()->assertJsonPath('device.code', 'ST2')->assertJsonPath('device.name', 'Front desk');
        $this->withHeaders(['X-Device-Id' => $phone])->postJson('/api/v1/auth/pin-login', ['userId' => $rep, 'pin' => '4444', 'app' => 'delegate'])
            ->assertOk()->assertJsonPath('device.code', 'DL1')->assertJsonPath('device.name', 'Phone 1');

        // a device the admin disconnected stays out, names and all
        $this->api('POST', "devices/{$till}/revoke")->assertOk();
        $this->withHeaders(['X-Device-Id' => $till])->getJson('/api/v1/auth/login-users')->assertStatus(403)->assertJsonPath('error.code', 'device_revoked');
        $this->withHeaders(['X-Device-Id' => $till])->postJson('/api/v1/auth/pin-login', ['userId' => $cashier, 'pin' => '3333'])->assertStatus(403)->assertJsonPath('error.code', 'device_revoked');
    }

    public function test_many_wrong_sign_ins_from_one_place_make_that_place_wait(): void
    {
        $this->shop();
        $a = $this->makeUser('Ali', 'alii', 'cashier', '3333');
        $b = $this->makeUser('Bana', 'bana', 'cashier', '5555');
        // 15 wrong tries in an hour from one address (spread over people, so no single account lock explains it)…
        foreach ([$a, $b] as $who) {
            for ($i = 0; $i < 4; $i++) {
                $this->api('POST', 'auth/pin-login', ['userId' => $who, 'pin' => '9999'], [])->assertStatus(401);
            }
        }
        for ($i = 0; $i < 7; $i++) {
            $this->api('POST', 'auth/login', ['username' => 'owner', 'password' => 'not-it-'.$i], [])->assertStatus($i < 4 ? 401 : 423);
        }
        // …and the next sign-in from there waits, even with the right PIN
        $this->api('POST', 'auth/pin-login', ['userId' => $a, 'pin' => '3333'], [])->assertStatus(429)->assertJsonPath('error.code', 'too_many_requests');
        // the shop's other connection is not affected
        $this->withServerVariables(['REMOTE_ADDR' => '10.0.0.2']);
        $this->api('POST', 'auth/pin-login', ['userId' => $b, 'pin' => '5555'], [])->assertOk();
    }

    public function test_wrong_pins_count_down_then_lock_the_account(): void
    {
        $this->shop();
        $id = $this->makeUser('Ali', 'alii', 'cashier', '3333');
        for ($i = 4; $i >= 1; $i--) {
            $this->api('POST', 'auth/pin-login', ['userId' => $id, 'pin' => '9999'], [])->assertStatus(401)->assertJsonPath('error.params.left', $i);
        }
        $this->api('POST', 'auth/pin-login', ['userId' => $id, 'pin' => '9999'], [])->assertStatus(423)->assertJsonPath('error.code', 'account_locked');
        $this->api('POST', 'auth/pin-login', ['userId' => $id, 'pin' => '3333'], [])->assertStatus(423); // even the right PIN is refused while locked

        $this->api('POST', "users/$id/unlock")->assertOk();
        $this->api('POST', 'auth/pin-login', ['userId' => $id, 'pin' => '3333'], [])->assertOk();
    }

    public function test_a_cashier_cannot_manage_users_or_roles(): void
    {
        $this->shop();
        $roleId = Role::where('key', 'cashier')->value('id');
        $cashier = $this->makeUser('Ali', 'alii', 'cashier', '3333');
        $this->asUser($cashier, '3333');

        $this->api('GET', 'users')->assertStatus(403)->assertJsonPath('error.code', 'forbidden');
        $this->api('POST', 'users', ['name' => 'X', 'username' => 'xxx', 'roleId' => $roleId, 'active' => true, 'pin' => '5555', 'limits' => ['maxDiscountPct' => 10, 'maxRefundIQD' => 0]])->assertStatus(403);
        $this->api('POST', 'roles', ['name' => 'Evil', 'permissions' => ['*'], 'apps' => ['pos']])->assertStatus(403);
        $this->api('GET', 'settings')->assertStatus(403);
        $this->api('GET', 'audit')->assertStatus(403);
    }

    public function test_a_manager_can_create_cashiers_but_never_super_admins_or_custom_grants(): void
    {
        $this->shop();
        $mgr = $this->makeUser('Boss', 'boss', 'manager', '6666');
        $this->asUser($mgr, '6666');
        $roles = Role::pluck('id', 'key');

        $this->api('POST', 'users', ['name' => 'New', 'username' => 'newc', 'roleId' => $roles['cashier'], 'active' => true, 'pin' => '7777', 'limits' => ['maxDiscountPct' => 10, 'maxRefundIQD' => 0]])->assertCreated();
        $this->api('POST', 'users', ['name' => 'Sneaky', 'username' => 'sneaky', 'roleId' => $roles['super_admin'], 'active' => true, 'pin' => '8888', 'limits' => ['maxDiscountPct' => 10, 'maxRefundIQD' => 0]])->assertStatus(403);
        $this->api('POST', 'users', ['name' => 'Gr', 'username' => 'gr11', 'roleId' => $roles['cashier'], 'active' => true, 'pin' => '8899', 'grants' => ['reports.view'], 'limits' => ['maxDiscountPct' => 10, 'maxRefundIQD' => 0]])->assertStatus(403);
        $this->api('POST', 'roles', ['name' => 'Nope', 'permissions' => ['pos.sell'], 'apps' => ['pos']])->assertStatus(403);
    }

    public function test_super_admin_builds_a_custom_role_and_per_person_overrides(): void
    {
        $this->shop();
        $role = $this->api('POST', 'roles', ['name' => 'Perfume Consultant', 'description' => 'sells + sees reports', 'permissions' => ['pos.sell', 'products.view', 'reports.view'], 'apps' => ['pos']])
            ->assertCreated()->json('role');
        $userId = $this->api('POST', 'users', [
            'name' => 'Nora', 'username' => 'nora', 'roleId' => $role['id'], 'active' => true, 'pin' => '1212',
            'grants' => ['customers.view'], 'denies' => ['reports.view'], 'limits' => ['maxDiscountPct' => 5, 'maxRefundIQD' => 0],
        ])->assertCreated()->json('user.id');

        $this->asUser($userId, '1212');
        $perms = $this->api('GET', 'auth/me')->json('user.permissions');
        $this->assertContains('pos.sell', $perms);
        $this->assertContains('customers.view', $perms);   // grant
        $this->assertNotContains('reports.view', $perms);  // deny beats the role
        $this->api('GET', 'reports/sales')->assertStatus(403);
        $this->api('GET', 'customers')->assertOk();
    }

    public function test_pins_and_usernames_are_unique(): void
    {
        $this->shop();
        $this->makeUser('Aaa', 'aaa', 'cashier', '3131');
        $cashier = Role::where('key', 'cashier')->value('id');
        $base = ['roleId' => $cashier, 'active' => true, 'limits' => ['maxDiscountPct' => 10, 'maxRefundIQD' => 0]];
        $this->api('POST', 'users', $base + ['name' => 'B', 'username' => 'bbb', 'pin' => '3131'])->assertStatus(422)->assertJsonPath('error.code', 'pin_taken');
        $this->api('POST', 'users', $base + ['name' => 'C', 'username' => 'aaa', 'pin' => '3232'])->assertStatus(422)->assertJsonPath('error.code', 'username_taken');
        $this->api('POST', 'users', $base + ['name' => 'D', 'username' => 'ddd', 'pin' => '12'])->assertStatus(422)->assertJsonPath('error.code', 'pin_invalid');
    }

    public function test_last_super_admin_and_yourself_are_protected(): void
    {
        $this->shop();
        $owner = User::where('username', 'owner')->first();
        $cashierRole = Role::where('key', 'cashier')->value('id');
        $put = fn (array $over) => $this->api('PUT', "users/{$owner->id}", $over + ['name' => 'Owner', 'username' => 'owner', 'roleId' => $owner->role_id, 'active' => true, 'limits' => ['maxDiscountPct' => 100, 'maxRefundIQD' => 1000]]);

        $this->api('DELETE', "users/{$owner->id}")->assertStatus(422)->assertJsonPath('error.code', 'cannot_modify_self');
        $put(['roleId' => $cashierRole])->assertStatus(422)->assertJsonPath('error.code', 'last_super_admin');
        $put(['active' => false])->assertStatus(422)->assertJsonPath('error.code', 'last_super_admin');
    }

    public function test_system_roles_cannot_be_edited_or_deleted_when_locked_or_in_use(): void
    {
        $this->shop();
        $sa = Role::where('key', 'super_admin')->value('id');
        $this->api('PUT', "roles/$sa", ['name' => 'x', 'permissions' => [], 'apps' => []])->assertStatus(422)->assertJsonPath('error.code', 'role_locked');
        $cashier = Role::where('key', 'cashier')->value('id');
        $this->api('DELETE', "roles/$cashier")->assertStatus(422)->assertJsonPath('error.code', 'role_locked'); // built-in

        $custom = $this->api('POST', 'roles', ['name' => 'Temp', 'permissions' => ['pos.sell'], 'apps' => ['pos']])->json('role.id');
        $this->api('POST', 'users', ['name' => 'T', 'username' => 'ttt', 'roleId' => $custom, 'active' => true, 'pin' => '1010', 'limits' => ['maxDiscountPct' => 1, 'maxRefundIQD' => 0]])->assertCreated();
        $this->api('DELETE', "roles/$custom")->assertStatus(422)->assertJsonPath('error.code', 'role_in_use');
    }

    public function test_reset_credentials_disabling_and_token_revocation(): void
    {
        $this->shop();
        $id = $this->makeUser('Sara', 'sara', 'cashier', '4545');
        $this->asUser($id, '4545');
        $sara = $this->auth;
        $this->api('GET', 'auth/me', [], $sara)->assertOk();

        $this->asOwner();
        $this->api('POST', "users/$id/reset-credentials", ['pin' => '5656'])->assertOk();
        $this->api('GET', 'auth/me', [], $sara)->assertStatus(401); // old sessions die when credentials are reset
        $this->api('POST', 'auth/pin-login', ['userId' => $id, 'pin' => '4545'], [])->assertStatus(401);
        $this->api('POST', 'auth/pin-login', ['userId' => $id, 'pin' => '5656'], [])->assertOk();

        // disabling signs the person out everywhere immediately
        $this->asUser($id, '5656');
        $live = $this->auth;
        $this->asOwner();
        $u = $this->api('GET', 'users')->json('users');
        $row = collect($u)->firstWhere('id', $id);
        $this->api('PUT', "users/$id", ['name' => 'Sara', 'username' => 'sara', 'roleId' => $row['roleId'], 'active' => false, 'limits' => $row['limits']])->assertOk();
        $this->api('GET', 'auth/me', [], $live)->assertStatus(401);
        $this->api('POST', 'auth/pin-login', ['userId' => $id, 'pin' => '5656'], [])->assertStatus(403)->assertJsonPath('error.code', 'account_disabled');
    }

    public function test_supervisor_approval_only_works_for_someone_holding_the_permission(): void
    {
        $this->shop();
        $cashier = $this->makeUser('Ali', 'alii', 'cashier', '3333');
        $this->asUser($cashier, '3333');
        $this->api('POST', 'auth/approve', ['pin' => '1111', 'permission' => 'sales.void'])->assertOk()->assertJsonPath('approver.name', 'Owner');
        $this->api('POST', 'auth/approve', ['pin' => '3333', 'permission' => 'sales.void'])->assertStatus(403)->assertJsonPath('error.code', 'approval_invalid');
        $this->api('POST', 'auth/approve', ['pin' => '0000', 'permission' => 'sales.void'])->assertStatus(403);
    }

    public function test_supervisor_approval_cannot_be_used_to_guess_pins(): void
    {
        $this->shop();
        $cashier = $this->makeUser('Ali', 'alii', 'cashier', '3333');
        $this->asUser($cashier, '3333');
        for ($i = 0; $i < 5; $i++) {
            $this->api('POST', 'auth/approve', ['pin' => '000'.$i, 'permission' => 'sales.void'])->assertStatus(403);
        }
        // the sixth try is refused even with the right PIN, until the wait is over
        $this->api('POST', 'auth/approve', ['pin' => '1111', 'permission' => 'sales.void'])->assertStatus(429)->assertJsonPath('error.code', 'too_many_requests');
    }

    public function test_malformed_ids_are_a_clean_404_or_ignored_never_a_server_error(): void
    {
        $this->shop();
        $this->api('PUT', 'users/not-a-uuid', [])->assertStatus(404);
        $this->api('DELETE', 'products/123')->assertStatus(404);
        $this->api('GET', 'sales/NOPE-000001')->assertStatus(404)->assertJsonPath('error.code', 'not_found');
        $this->api('GET', 'stock/movements?variantId=garbage')->assertOk();
        $this->api('GET', 'audit?userId=garbage')->assertOk();
        $this->api('GET', 'reports/sales?userId=garbage')->assertOk();
        $this->withHeaders(['X-Device-Id' => 'garbage'])->getJson('/api/v1/auth/login-users')->assertOk();
        $id = $this->makeUser('Ali', 'alii', 'cashier', '3333');
        $this->withHeaders(['X-Device-Id' => 'garbage'])->postJson('/api/v1/auth/pin-login', ['userId' => $id, 'pin' => '3333'])->assertStatus(403)->assertJsonPath('error.code', 'device_not_registered');
    }

    public function test_device_management_and_revocation(): void
    {
        $this->shop();
        $devices = $this->api('GET', 'devices')->assertOk()->json('devices');
        $this->assertCount(1, $devices);
        $this->api('PUT', "devices/{$devices[0]['id']}", ['name' => 'Front till', 'code' => 'ft1'])->assertOk()->assertJsonPath('device.code', 'FT1');
        $this->api('PUT', "devices/{$devices[0]['id']}", ['name' => 'x', 'code' => '!!'])->assertStatus(422)->assertJsonPath('error.code', 'device_code_invalid');

        $cashier = $this->makeUser('Ali', 'alii', 'cashier', '3333');
        $this->api('POST', "devices/{$devices[0]['id']}/revoke")->assertOk();
        $this->api('POST', 'auth/pin-login', ['userId' => $cashier, 'pin' => '3333'], [])->assertStatus(403)->assertJsonPath('error.code', 'device_revoked');
    }

    public function test_settings_need_the_right_permission_and_audit_records_who_did_what(): void
    {
        $this->shop();
        $this->api('PUT', 'settings', ['currency' => ['rate' => 1500]])->assertOk()->assertJsonPath('settings.currency.rate', 1500);
        $this->assertSame(250, $this->api('GET', 'settings')->json('settings.currency.rounding')); // siblings survive the deep merge

        $mgr = $this->makeUser('Boss', 'boss', 'manager', '6666');
        $this->asUser($mgr, '6666');
        $this->api('PUT', 'settings', ['currency' => ['rate' => 1]])->assertStatus(403);
        $this->api('GET', 'settings')->assertOk();

        $this->asOwner();
        $actions = collect($this->api('GET', 'audit')->json('entries'))->pluck('action');
        $this->assertTrue($actions->contains('setup.complete'));
        $this->assertTrue($actions->contains('settings.update'));
        $this->assertTrue($actions->contains('user.create'));
    }

    public function test_unauthenticated_requests_get_a_401_in_the_standard_error_shape(): void
    {
        // a client that forgets `Accept: application/json` must still get JSON, never a redirect or a 500
        $this->get('/api/v1/products')->assertStatus(401)->assertJsonPath('error.code', 'not_signed_in');
        $this->get('/api/v1/auth/me', ['Authorization' => 'Bearer not-a-real-token'])->assertStatus(401)->assertJsonPath('error.code', 'not_signed_in');
        $this->getJson('/api/v1/products')->assertStatus(401)->assertJsonPath('error.code', 'not_signed_in');
        $this->getJson('/api/v1/health')->assertOk();
    }
}
