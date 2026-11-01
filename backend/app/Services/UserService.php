<?php

namespace App\Services;

use App\Exceptions\AppException;
use App\Models\Role;
use App\Models\User;
use App\Services\Concerns\RequiresPermission;
use App\Support\Permissions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * Accounts — the Super Admin's toolbox. Rules enforced here (not only in the UI):
 *  - only a Super Admin can create/edit Super Admins or hand out per-person grants / denies
 *  - the last active Super Admin can't be disabled, demoted or deleted
 *  - you can't delete or disable yourself
 *  - PINs are unique (so a supervisor PIN identifies exactly one person)
 *  - accounts with a sales/shift history are kept (disabled) so reports stay truthful
 */
class UserService
{
    use RequiresPermission;

    public const COLORS = ['#D4A548', '#B8892F', '#8B4A2B', '#3E8E5E', '#27365C', '#7A4FA0', '#B5442F', '#5E8C8A'];

    public function __construct(private AuditService $audit) {}

    /** @return \Illuminate\Support\Collection<int, User> */
    public function list(User $actor)
    {
        $this->need($actor, 'users.view');

        return User::with('role')->orderBy('name')->get();
    }

    /**
     * @param array{
     *   id?: string|null, name: string, username: string, roleId: string, active: bool, color?: string|null,
     *   pin?: string|null, password?: string|null, grants?: string[], denies?: string[],
     *   limits: array{maxDiscountPct: int, maxRefundIQD: int}
     * } $in
     */
    public function save(User $actor, array $in): User
    {
        $isNew = empty($in['id']);
        $this->need($actor, $isNew ? 'users.create' : 'users.edit');

        $name = trim($in['name']);
        $username = Str::lower(trim($in['username']));
        if ($name === '' || $username === '') {
            throw new AppException('required_fields');
        }
        if (! preg_match('/^[a-z0-9._-]{3,32}$/', $username)) {
            throw new AppException('username_invalid');
        }
        $role = Role::find($in['roleId']) ?? throw new AppException('role_missing');
        $grants = Permissions::clean($in['grants'] ?? []);
        $denies = Permissions::clean($in['denies'] ?? []);

        // Only a Super Admin may hand out the Super Admin role — or change anything about a person's permissions.
        if ($role->key === 'super_admin' && ! $actor->isSuperAdmin()) {
            throw AppException::forbidden('roles.manage');
        }
        if (($grants || $denies) && ! $actor->isSuperAdmin()) {
            throw AppException::forbidden('roles.manage');
        }
        $pin = $in['pin'] ?? null;
        $password = $in['password'] ?? null;
        if ($password) {
            Credentials::assertPassword($password);
        }
        if ($pin) {
            Credentials::assertPin($pin);
            $this->assertPinFree($pin, $in['id'] ?? null);
        }
        $dup = User::where('username', $username)->first();
        if ($dup && $dup->id !== ($in['id'] ?? null)) {
            throw new AppException('username_taken');
        }

        $limits = [
            'max_discount_pct' => (int) min(100, max(0, round($in['limits']['maxDiscountPct'] ?? 0))),
            'max_refund_iqd' => (int) max(0, round($in['limits']['maxRefundIQD'] ?? 0)),
        ];
        $attrs = ['name' => $name, 'username' => $username, 'role_id' => $role->id, 'active' => (bool) $in['active'], 'grants' => $grants, 'denies' => $denies] + $limits;

        return DB::transaction(function () use ($actor, $in, $isNew, $attrs, $role, $pin, $password, $name, $username, $grants, $denies) {
            if ($isNew) {
                if (! $pin) {
                    throw new AppException('pin_invalid');
                }
                $user = User::create($attrs + Credentials::pinColumns($pin) + [
                    'password' => $password ? Hash::make($password) : null,
                    'color' => $in['color'] ?? self::COLORS[User::count() % count(self::COLORS)],
                    'created_by' => $actor->id,
                ]);
                $this->audit->log($actor, 'user.create', 'user', $user->id, ['name' => $name, 'username' => $username, 'role' => $role->name]);

                return $user->load('role');
            }

            $user = User::with('role')->find($in['id']) ?? throw AppException::notFound();
            if ($user->isSuperAdmin() && ! $actor->isSuperAdmin()) {
                throw AppException::forbidden('roles.manage');
            }
            $demoting = $user->isSuperAdmin() && $role->key !== 'super_admin';
            $disabling = $user->active && ! $attrs['active'];
            if (($demoting || $disabling) && $this->otherActiveSuperAdmins($user->id) === 0) {
                throw new AppException('last_super_admin');
            }
            if ($user->id === $actor->id && (! $attrs['active'] || $demoting)) {
                throw new AppException('cannot_modify_self');
            }
            $extra = ['color' => $in['color'] ?? $user->color];
            if ($pin) {
                $extra += Credentials::pinColumns($pin) + ['failed_attempts' => 0, 'locked_until' => null];
            }
            if ($password) {
                $extra['password'] = Hash::make($password);
            }
            $user->update($attrs + $extra);
            // permissions changed → force the person's tokens to be re-checked next request (they are read live), nothing to revoke
            $this->audit->log($actor, 'user.update', 'user', $user->id, [
                'name' => $name, 'role' => $role->name, 'active' => $attrs['active'], 'grants' => count($grants), 'denies' => count($denies),
                'pinChanged' => (bool) $pin, 'passwordChanged' => (bool) $password,
            ]);
            if (! $attrs['active']) {
                $user->tokens()->delete(); // a disabled account is signed out everywhere immediately
            }

            return $user->fresh('role');
        });
    }

    public function resetCredentials(User $actor, string $userId, ?string $pin, ?string $password): void
    {
        $this->need($actor, 'users.reset_credentials');
        $user = User::with('role')->find($userId) ?? throw AppException::notFound();
        if ($user->isSuperAdmin() && ! $actor->isSuperAdmin()) {
            throw AppException::forbidden('roles.manage');
        }
        $patch = ['failed_attempts' => 0, 'locked_until' => null];
        if ($pin) {
            Credentials::assertPin($pin);
            $this->assertPinFree($pin, $userId);
            $patch += Credentials::pinColumns($pin);
        }
        if ($password) {
            Credentials::assertPassword($password);
            $patch['password'] = Hash::make($password);
        }
        $user->update($patch);
        $user->tokens()->delete();
        $this->audit->log($actor, 'user.reset_credentials', 'user', $userId, ['pin' => (bool) $pin, 'password' => (bool) $password]);
    }

    public function unlock(User $actor, string $userId): void
    {
        $this->need($actor, 'users.edit');
        (User::find($userId) ?? throw AppException::notFound())->update(['failed_attempts' => 0, 'locked_until' => null]);
        $this->audit->log($actor, 'user.unlock', 'user', $userId);
    }

    public function delete(User $actor, string $id): void
    {
        $this->need($actor, 'users.delete');
        if ($id === $actor->id) {
            throw new AppException('cannot_modify_self');
        }
        $user = User::with('role')->find($id) ?? throw AppException::notFound();
        if ($user->isSuperAdmin() && $this->otherActiveSuperAdmins($id) === 0) {
            throw new AppException('last_super_admin');
        }
        $hasHistory = DB::table('sales')->where('user_id', $id)->exists() || DB::table('shifts')->where('user_id', $id)->exists();
        if ($hasHistory) {
            throw new AppException('user_has_history');
        }
        $user->tokens()->delete();
        $user->delete();
        DB::table('tombstones')->insert(['entity' => 'user', 'entity_id' => $id, 'deleted_at' => \App\Support\Time::nowMs()]);
        $this->audit->log($actor, 'user.delete', 'user', $id, ['name' => $user->name]);
    }

    /** Change your own PIN / password (needs the current PIN). */
    public function changeOwnCredentials(User $actor, string $currentPin, ?string $newPin, ?string $newPassword): void
    {
        if (! Hash::check($currentPin, $actor->pin_hash)) {
            throw new AppException('invalid_credentials', ['left' => 0], 401);
        }
        $patch = [];
        if ($newPin) {
            Credentials::assertPin($newPin);
            $this->assertPinFree($newPin, $actor->id);
            $patch += Credentials::pinColumns($newPin);
        }
        if ($newPassword) {
            Credentials::assertPassword($newPassword);
            $patch['password'] = Hash::make($newPassword);
        }
        if ($patch) {
            $actor->update($patch);
            $this->audit->log($actor, 'user.change_own_credentials', 'user', $actor->id);
        }
    }

    private function assertPinFree(string $pin, ?string $exceptUserId): void
    {
        $taken = User::where('pin_fingerprint', Credentials::fingerprint($pin))->when($exceptUserId, fn ($q) => $q->where('id', '!=', $exceptUserId))->exists();
        if ($taken) {
            throw new AppException('pin_taken');
        }
    }

    private function otherActiveSuperAdmins(string $exceptId): int
    {
        return User::where('active', true)->where('id', '!=', $exceptId)
            ->whereHas('role', fn ($q) => $q->where('key', 'super_admin'))->count();
    }
}
