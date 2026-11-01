<?php

namespace App\Services;

use App\Exceptions\AppException;
use App\Models\Role;
use App\Models\User;
use App\Services\Concerns\RequiresPermission;
use App\Support\Permissions;
use Illuminate\Support\Str;

/** Roles = named bundles of permissions. Only the Super Admin manages them. */
class RoleService
{
    use RequiresPermission;

    public function __construct(private AuditService $audit) {}

    /** @return \Illuminate\Support\Collection<int, Role> */
    public function list(User $actor)
    {
        $this->need($actor, 'users.view');

        return Role::withCount('users')->orderByDesc('is_system')->orderBy('name')->get();
    }

    /** Creates the built-in roles that are missing (idempotent). */
    public function ensureSystemRoles(): void
    {
        foreach (Permissions::systemRoles() as $r) {
            Role::firstOrCreate(['key' => $r['key']], [
                'name' => $r['name'], 'description' => $r['description'], 'permissions' => $r['permissions'], 'apps' => $r['apps'], 'is_system' => true,
            ]);
        }
    }

    /** @param array{id?: string|null, name: string, description?: string, permissions: string[], apps: string[]} $in */
    public function save(User $actor, array $in): Role
    {
        $this->need($actor, 'roles.manage');
        $name = trim($in['name']);
        if ($name === '') {
            throw new AppException('required_fields');
        }
        $attrs = [
            'name' => $name,
            'description' => trim($in['description'] ?? ''),
            'permissions' => Permissions::clean($in['permissions'] ?? []),
            'apps' => array_values(array_intersect($in['apps'] ?? [], ['pos', 'admin', 'delegate'])),
        ];

        if (! empty($in['id'])) {
            $role = Role::find($in['id']) ?? throw AppException::notFound();
            if ($role->key === 'super_admin') {
                throw new AppException('role_locked');
            }
            $role->update($attrs);
            $this->audit->log($actor, 'role.update', 'role', $role->id, ['name' => $name, 'permissions' => count($attrs['permissions'])]);

            return $role;
        }

        $slug = trim(preg_replace('/[^a-z0-9]+/', '_', Str::lower($name)), '_') ?: 'role';
        $role = Role::create($attrs + ['key' => 'custom_'.$slug.'_'.Str::lower(Str::random(4)), 'is_system' => false]);
        $this->audit->log($actor, 'role.create', 'role', $role->id, ['name' => $name]);

        return $role;
    }

    public function delete(User $actor, string $id): void
    {
        $this->need($actor, 'roles.manage');
        $role = Role::find($id) ?? throw AppException::notFound();
        if ($role->is_system) {
            throw new AppException('role_locked');
        }
        $inUse = User::where('role_id', $id)->count();
        if ($inUse > 0) {
            throw new AppException('role_in_use', ['count' => $inUse]);
        }
        $role->delete();
        \Illuminate\Support\Facades\DB::table('tombstones')->insert(['entity' => 'role', 'entity_id' => $id, 'deleted_at' => \App\Support\Time::nowMs()]);
        $this->audit->log($actor, 'role.delete', 'role', $id, ['name' => $role->name]);
    }
}
