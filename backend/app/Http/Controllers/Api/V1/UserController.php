<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\SaveUserRequest;
use App\Http\Resources\Present;
use App\Services\UserService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Accounts. All rules (last Super Admin, unique PINs, who may grant what…) live in {@see UserService}. */
class UserController extends Controller
{
    public function __construct(private UserService $users) {}

    public function index(Request $r): JsonResponse
    {
        return response()->json(['users' => $this->users->list($r->user())->map(fn ($u) => Present::user($u))->values()]);
    }

    public function store(SaveUserRequest $r): JsonResponse
    {
        return response()->json(['user' => Present::user($this->users->save($r->user(), $r->validated()))], 201);
    }

    public function update(SaveUserRequest $r, string $id): JsonResponse
    {
        return response()->json(['user' => Present::user($this->users->save($r->user(), ['id' => $id] + $r->validated()))]);
    }

    public function destroy(Request $r, string $id): JsonResponse
    {
        $this->users->delete($r->user(), $id);

        return response()->json(['ok' => true]);
    }

    public function resetCredentials(Request $r, string $id): JsonResponse
    {
        $d = $r->validate(['pin' => ['nullable', 'string', 'max:6'], 'password' => ['nullable', 'string', 'max:200']]);
        $this->users->resetCredentials($r->user(), $id, $d['pin'] ?? null, $d['password'] ?? null);

        return response()->json(['ok' => true]);
    }

    public function unlock(Request $r, string $id): JsonResponse
    {
        $this->users->unlock($r->user(), $id);

        return response()->json(['ok' => true]);
    }
}
