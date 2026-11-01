<?php

namespace App\Http\Controllers\Api\V1;

use App\Exceptions\AppException;
use App\Http\Controllers\Controller;
use App\Http\Requests\LoginRequest;
use App\Http\Requests\PinLoginRequest;
use App\Http\Resources\Present;
use App\Services\AuditService;
use App\Services\AuthService;
use App\Services\UserService;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;

class AuthController extends Controller
{
    public function __construct(private AuthService $auth, private UserService $users, private AuditService $audit) {}

    /** Username + password (admins; also how a new device is registered by the Super Admin). */
    public function login(LoginRequest $r): JsonResponse
    {
        $out = $this->guarded($r, fn () => $this->auth->loginWithPassword($r->validated('username'), $r->validated('password'), $this->deviceId($r), $r->validated('deviceName'), $r->validated('app') ?? 'pos'));

        return response()->json(['token' => $out['token'], 'user' => Present::actor($out['user']), 'device' => isset($out['device']) ? Present::device($out['device']) : null]);
    }

    /** Cashier PIN sign-in; the first one on a new till or phone connects it. */
    public function pinLogin(PinLoginRequest $r): JsonResponse
    {
        $out = $this->guarded($r, fn () => $this->auth->loginWithPin($r->validated('userId'), $r->validated('pin'), $this->deviceId($r) ?? '', $r->validated('app') ?? 'pos', $r->validated('deviceName')));

        return response()->json(['token' => $out['token'], 'user' => Present::actor($out['user']), 'device' => isset($out['device']) ? Present::device($out['device']) : null]);
    }

    /**
     * The names and PIN pad are open to any device, so guessing is slowed per place as well as per person: after
     * 15 wrong sign-ins from one address in an hour, that address waits (people mistyping now and then never get near).
     */
    private function guarded(Request $r, Closure $signIn): array
    {
        $key = 'signin-fail:'.$r->ip();
        if (RateLimiter::tooManyAttempts($key, 15)) {
            throw new AppException('too_many_requests', ['seconds' => RateLimiter::availableIn($key)], 429);
        }
        try {
            return $signIn();
        } catch (AppException $e) {
            if (in_array($e->errorCode, ['invalid_credentials', 'account_locked'], true)) {
                RateLimiter::hit($key, 3600);
            }
            throw $e;
        }
    }

    /** Tiles for the PIN screen — any device except one the admin disconnected. */
    public function loginUsers(Request $r): JsonResponse
    {
        return response()->json(['users' => $this->auth->loginUsers($this->deviceId($r) ?? '', $r->query('app') === 'delegate' ? 'delegate' : 'pos')]);
    }

    public function me(Request $r): JsonResponse
    {
        return response()->json(['user' => Present::actor($r->user())]);
    }

    public function refresh(Request $r): JsonResponse
    {
        $name = $r->user()->currentAccessToken()->name ?? 'api';
        $out = $this->auth->refresh($r->user(), $name);

        return response()->json(['token' => $out['token'], 'user' => Present::actor($out['user']), 'device' => isset($out['device']) ? Present::device($out['device']) : null]);
    }

    public function logout(Request $r): JsonResponse
    {
        $r->user()->currentAccessToken()?->delete();
        $this->audit->log($r->user(), 'auth.logout', 'user', $r->user()->id);

        return response()->json(['ok' => true]);
    }

    /** Supervisor approval: does this PIN belong to someone holding `permission`? */
    public function approve(Request $r): JsonResponse
    {
        $data = $r->validate(['pin' => ['required', 'string', 'max:6'], 'permission' => ['required', 'string', 'max:64']]);
        // This endpoint answers "whose PIN is this?", so it must not be usable to guess supervisors' PINs:
        // a signed-in person gets a handful of wrong tries, then has to wait.
        $key = 'approve:'.$r->user()->id;
        if (RateLimiter::tooManyAttempts($key, 5)) {
            throw new AppException('too_many_requests', ['seconds' => RateLimiter::availableIn($key)], 429);
        }
        $who = $this->auth->verifyApproval($data['pin'], $data['permission']);
        if (! $who) {
            RateLimiter::hit($key, 300);
            $this->audit->log($r->user(), 'auth.approval_failed', 'user', $r->user()->id, ['permission' => $data['permission']]);
            throw new AppException('approval_invalid', [], 403);
        }
        $this->audit->log($r->user(), 'auth.approval', 'user', $who->id, ['permission' => $data['permission'], 'approver' => $who->name]);
        RateLimiter::clear($key);

        return response()->json(['approver' => ['id' => $who->id, 'name' => $who->name]]);
    }

    public function changeCredentials(Request $r): JsonResponse
    {
        $d = $r->validate(['currentPin' => ['required', 'string', 'max:6'], 'newPin' => ['nullable', 'string', 'max:6'], 'newPassword' => ['nullable', 'string', 'max:200']]);
        $this->users->changeOwnCredentials($r->user(), $d['currentPin'], $d['newPin'] ?? null, $d['newPassword'] ?? null);

        return response()->json(['ok' => true]);
    }

    private function deviceId(Request $r): ?string
    {
        $id = $r->header('X-Device-Id') ?: $r->input('deviceId');

        return is_string($id) && Str::isUuid($id) ? $id : null;
    }
}
