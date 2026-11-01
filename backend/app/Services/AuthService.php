<?php

namespace App\Services;

use App\Exceptions\AppException;
use App\Models\Device;
use App\Models\User;
use App\Support\Time;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * Sign-in for the till: a cashier taps their name and types a PIN (fast, one-handed); admins may use a
 * username + password. Wrong PINs lock the account for a while. Tokens are Sanctum personal access
 * tokens tied to the device so a stolen token can be traced and a device can be revoked.
 *
 * Any till or delegate phone may show the names, and the first good sign-in on it connects it (ST1, DL1…) —
 * nobody has to type an admin password on a new device. A device the admin disconnected stays refused.
 */
class AuthService
{
    public function __construct(private SettingsService $settings, private AuditService $audit) {}

    /** @return array{token: string, user: User, device: ?Device} */
    public function loginWithPassword(string $username, string $password, ?string $deviceId, ?string $deviceName = null, string $app = 'pos'): array
    {
        $user = User::with('role')->where('username', Str::lower(trim($username)))->first();
        $this->checkUsable($user);
        if (! $user->password || ! Hash::check($password, $user->password)) {
            $this->registerFailure($user);
        }
        // the admin panel is used from any computer: it never makes that computer a till
        $device = $app === 'admin' ? null : $this->resolveDevice($user, $deviceId, $deviceName, prefix: $app === 'delegate' ? 'DL' : 'ST');

        return $this->finish($user, $device, $app);
    }

    /** @return array{token: string, user: User, device: ?Device} */
    public function loginWithPin(string $userId, string $pin, string $deviceId, string $app = 'pos', ?string $deviceName = null): array
    {
        $user = User::with('role')->find($userId);
        $this->checkUsable($user);
        if (! Hash::check($pin, $user->pin_hash)) {
            $this->registerFailure($user);
        }
        $device = $this->resolveDevice($user, $deviceId, $deviceName, prefix: $app === 'delegate' ? 'DL' : 'ST', needed: true);

        return $this->finish($user, $device, $app);
    }

    /**
     * Supervisor approval: does this PIN belong to an active user who holds `$permission`?
     * (PINs are unique per user, so the fingerprint finds exactly one person.)
     */
    public function verifyApproval(string $pin, string $permission): ?User
    {
        $user = User::with('role')->where('pin_fingerprint', Credentials::fingerprint($pin))->first();
        if (! $user || ! $user->active || $user->isLocked() || ! Hash::check($pin, $user->pin_hash)) {
            return null;
        }

        return $user->can($permission) ? $user : null;
    }

    /** People shown as tiles on the PIN sign-in screen of `$app` — on any device except one the admin disconnected. */
    public function loginUsers(string $deviceId, string $app = 'pos'): array
    {
        $device = Str::isUuid($deviceId) ? Device::find($deviceId) : null;
        if ($device?->revoked) {
            throw new AppException('device_revoked', [], 403);
        }
        $device?->update(['last_seen_at' => Time::nowMs()]);

        return User::with('role')->where('active', true)->orderBy('name')->get()
            ->filter(fn (User $u) => $app === 'delegate' ? DelegateService::isDelegate($u) : in_array($app, $u->role->apps ?? [], true))
            ->map(fn (User $u) => ['id' => $u->id, 'name' => $u->name, 'color' => $u->color, 'roleName' => $u->role->name, 'locked' => $u->isLocked()])
            ->values()->all();
    }

    /** Re-issue a fresh token (rolling sessions) and drop the old one. */
    public function refresh(User $user, ?string $currentTokenName): array
    {
        $user->currentAccessToken()?->delete();

        return ['token' => $this->newToken($user, $currentTokenName ?? 'api'), 'user' => $user->load('role')];
    }

    private function checkUsable(?User $user): void
    {
        if (! $user) {
            throw new AppException('invalid_credentials', ['left' => 0], 401);
        }
        if (! $user->active) {
            throw new AppException('account_disabled', [], 403);
        }
        if ($user->isLocked()) {
            throw new AppException('account_locked', ['seconds' => (int) ceil(($user->locked_until - Time::nowMs()) / 1000)], 423);
        }
    }

    private function registerFailure(User $user): never
    {
        $sec = $this->settings->get()['security'];
        $failed = $user->failed_attempts + 1;
        $locked = $failed >= $sec['maxFailedAttempts'];
        $user->update([
            'failed_attempts' => $locked ? 0 : $failed,
            'locked_until' => $locked ? Time::nowMs() + $sec['lockoutSeconds'] * 1000 : $user->locked_until,
        ]);
        $this->audit->log($user, 'auth.failed', 'user', $user->id, ['locked' => $locked]);
        if ($locked) {
            throw new AppException('account_locked', ['seconds' => $sec['lockoutSeconds']], 423);
        }
        throw new AppException('invalid_credentials', ['left' => $sec['maxFailedAttempts'] - $failed], 401);
    }

    /**
     * The device signing in. A new one is connected by the first good sign-in on it — with a PIN or a password,
     * by anyone — so it is only added once a real person has signed in, never just for opening the page.
     * `$needed`: a PIN sign-in only happens on a device (a password one may come from plain API use).
     */
    private function resolveDevice(User $user, ?string $deviceId, ?string $deviceName, string $prefix = 'ST', bool $needed = false): ?Device
    {
        if (! $deviceId) {
            if (! $needed) {
                return null; // plain API/admin access without a till
            }
            throw new AppException('device_not_registered', [], 403);
        }
        $device = Str::isUuid($deviceId) ? Device::find($deviceId) : null;
        if ($device?->revoked) {
            throw new AppException('device_revoked', [], 403);
        }
        if ($device) {
            return $device;
        }
        // tills are ST1, ST2…; delegate phones DL1, DL2… (the code prefixes their receipt numbers)
        $n = Device::where('code', 'like', $prefix.'%')->count() + 1;
        $code = $prefix.$n;
        while (Device::where('code', $code)->exists()) {
            $code = $prefix.(++$n);
        }
        $device = Device::create(['id' => $deviceId, 'name' => trim($deviceName ?? '') ?: ($prefix === 'DL' ? 'Phone ' : 'Counter ').$n, 'code' => $code]);
        $this->audit->log($user, 'device.register', 'device', $device->id, ['name' => $device->name, 'code' => $device->code]);

        return $device;
    }

    /** @return array{token: string, user: User, device: ?Device} */
    private function finish(User $user, ?Device $device, string $app = 'pos'): array
    {
        $apps = $user->role->apps ?? [];
        // the POS also lets admin-panel roles in; the delegate app only delegates and the admin panel only admin-panel roles
        // (the Super Admin, who can do anything, gets into all of them)
        $allowed = match ($app) {
            'delegate' => $user->isSuperAdmin() || in_array('delegate', $apps, true),
            'admin' => $user->isSuperAdmin() || in_array('admin', $apps, true),
            default => in_array('pos', $apps, true) || in_array('admin', $apps, true),
        };
        if (! $allowed) {
            throw new AppException('app_not_allowed', [], 403);
        }
        $user->update(['failed_attempts' => 0, 'locked_until' => null, 'last_login_at' => Time::nowMs()]);
        $device?->update(['last_seen_at' => Time::nowMs()]);
        $this->audit->log($user, 'auth.login', 'user', $user->id, [], $device?->id);

        return ['token' => $this->newToken($user, self::tokenName($device)), 'user' => $user, 'device' => $device];
    }

    /** Tokens are named after the device *id* (codes can be renamed) so revoking a device always finds them. */
    public static function tokenName(?Device $device): string
    {
        return $device ? 'device:'.$device->id : 'api';
    }

    private function newToken(User $user, string $name): string
    {
        $user->tokens()->where('name', $name)->delete(); // one live token per user per device

        return $user->createToken($name, ['*'], now()->addDays(30))->plainTextToken;
    }
}
