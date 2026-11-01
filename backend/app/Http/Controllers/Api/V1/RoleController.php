<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\SaveRoleRequest;
use App\Http\Resources\Present;
use App\Services\RoleService;
use App\Support\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class RoleController extends Controller
{
    public function __construct(private RoleService $roles) {}

    public function index(Request $r): JsonResponse
    {
        return response()->json(['roles' => $this->roles->list($r->user())->map(fn ($x) => Present::role($x))->values()]);
    }

    /** The permission catalogue (groups → permission keys) used to build the role/permission editors. */
    public function catalogue(): JsonResponse
    {
        return response()->json(['groups' => Permissions::GROUPS, 'superAdminOnly' => Permissions::SUPER_ADMIN_ONLY, 'approvable' => Permissions::APPROVABLE]);
    }

    public function store(SaveRoleRequest $r): JsonResponse
    {
        return response()->json(['role' => Present::role($this->roles->save($r->user(), $r->validated()))], 201);
    }

    public function update(SaveRoleRequest $r, string $id): JsonResponse
    {
        return response()->json(['role' => Present::role($this->roles->save($r->user(), ['id' => $id] + $r->validated()))]);
    }

    public function destroy(Request $r, string $id): JsonResponse
    {
        $this->roles->delete($r->user(), $id);

        return response()->json(['ok' => true]);
    }
}
