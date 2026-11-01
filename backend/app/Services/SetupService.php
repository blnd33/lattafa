<?php

namespace App\Services;

use App\Exceptions\AppException;
use App\Models\Device;
use App\Models\Role;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * First-run setup. There is deliberately no built-in "admin/admin" account: the owner creates the Super Admin
 * here, exactly once, and that account creates everyone else.
 */
class SetupService
{
    public function __construct(
        private SettingsService $settings,
        private RoleService $roles,
        private AuditService $audit,
        private CatalogSeeder $demo,
    ) {}

    /**
     * @param array{
     *   store: array{name?: string, phone?: string, address?: string, city?: string}, rate: int|float,
     *   admin: array{name: string, username: string, password: string, pin: string},
     *   demoData?: bool, deviceId?: string|null, deviceName?: string|null
     * } $in
     * @return array{user: User, device: ?Device}
     */
    public function run(array $in): array
    {
        if ($this->settings->isSetupDone() || User::count() > 0) {
            throw new AppException('setup_already_done', [], 409);
        }
        Credentials::assertPassword($in['admin']['password']);
        Credentials::assertPin($in['admin']['pin']);
        if (trim($in['admin']['name']) === '' || trim($in['admin']['username']) === '') {
            throw new AppException('required_fields');
        }
        if (! preg_match('/^[a-z0-9._-]{3,32}$/', Str::lower(trim($in['admin']['username'])))) {
            throw new AppException('username_invalid');
        }
        if (! ($in['rate'] > 0)) {
            throw new AppException('invalid_rate');
        }

        return DB::transaction(function () use ($in) {
            $this->roles->ensureSystemRoles();
            $superRole = Role::where('key', 'super_admin')->firstOrFail();
            $admin = User::create([
                'name' => trim($in['admin']['name']),
                'username' => Str::lower(trim($in['admin']['username'])),
                'role_id' => $superRole->id,
                'active' => true,
                'color' => UserService::COLORS[0],
                'password' => Hash::make($in['admin']['password']),
                'grants' => [], 'denies' => [],
                'max_discount_pct' => 100, 'max_refund_iqd' => PHP_INT_MAX >> 1,
            ] + Credentials::pinColumns($in['admin']['pin']));

            $s = SettingsService::merge(SettingsService::defaults(), [
                'setupDone' => true,
                'store' => array_filter(['name' => $in['store']['name'] ?? null, 'phone' => $in['store']['phone'] ?? null, 'address' => $in['store']['address'] ?? null, 'city' => $in['store']['city'] ?? null], fn ($v) => $v !== null && $v !== ''),
                'currency' => ['rate' => (int) round($in['rate'])],
            ]);
            $this->settings->save($s);

            $device = null;
            if (! empty($in['deviceId'])) {
                $device = Device::create(['id' => $in['deviceId'], 'name' => trim($in['deviceName'] ?? '') ?: 'Counter 1', 'code' => 'ST1']);
            }
            if (! empty($in['demoData'])) {
                $this->demo->seed($admin);
            }
            $this->audit->log($admin, 'setup.complete', 'settings', 'app', ['demoData' => (bool) ($in['demoData'] ?? false)]);

            return ['user' => $admin->load('role'), 'device' => $device];
        });
    }
}
