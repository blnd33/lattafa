<?php

namespace App\Models;

use App\Support\Permissions;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Laravel\Sanctum\HasApiTokens;

/**
 * A person who can sign in (owner, manager, cashier…).
 * Effective permissions = role ∪ grants − denies; the Super Admin always keeps '*'.
 */
class User extends Authenticatable
{
    use HasApiTokens, HasUuids;

    protected $guarded = [];

    protected $hidden = ['pin_hash', 'pin_fingerprint', 'password'];

    protected function casts(): array
    {
        return [
            'active' => 'boolean',
            'grants' => 'array',
            'denies' => 'array',
            'max_discount_pct' => 'integer',
            'max_refund_iqd' => 'integer',
            'failed_attempts' => 'integer',
            'locked_until' => 'integer',
            'last_login_at' => 'integer',
        ];
    }

    public function role(): BelongsTo
    {
        return $this->belongsTo(Role::class);
    }

    /** @return string[] */
    public function permissions(): array
    {
        return Permissions::effective($this->role, $this->grants ?? [], $this->denies ?? []);
    }

    /** `$user->can('sales.void')` — wildcard-aware permission check. */
    public function can($abilities, $arguments = []): bool
    {
        if (is_string($abilities)) {
            return Permissions::has($this->permissions(), $abilities);
        }

        return parent::can($abilities, $arguments);
    }

    public function isSuperAdmin(): bool
    {
        return $this->role?->key === 'super_admin';
    }

    public function isLocked(): bool
    {
        return $this->locked_until !== null && $this->locked_until > now()->getTimestampMs();
    }
}
