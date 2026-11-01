<?php

namespace App\Http\Middleware;

use App\Exceptions\AppException;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Route guard: `->middleware('perm:reports.view')` (or several — any one is enough: `perm:sales.view_own,sales.view_all`).
 * Fine-grained rules live in the services; this gives a fast 403 and documents the route.
 */
class EnsurePermission
{
    public function handle(Request $request, Closure $next, string ...$permissions): Response
    {
        $user = $request->user();
        if (! $user) {
            throw new AppException('not_signed_in', [], 401);
        }
        foreach ($permissions as $p) {
            if ($user->can($p)) {
                return $next($request);
            }
        }

        throw AppException::forbidden($permissions[0] ?? '');
    }
}
