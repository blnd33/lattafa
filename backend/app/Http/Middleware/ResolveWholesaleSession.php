<?php

namespace App\Http\Middleware;

use App\Exceptions\AppException;
use App\Models\WholesaleSession;
use App\Services\Catalogue\AccessCodeService;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Route guard for the wholesale catalogue: `->middleware('wholesale')` means "this needs an unlocked buyer".
 *
 * A buyer's session is not a Sanctum token and this is not the `auth` middleware, which is the point — the two
 * never meet. A staff token presented here is not a session, and a buyer's token presented to a staff endpoint is
 * not a token. Neither can be mistaken for the other.
 */
class ResolveWholesaleSession
{
    public function __construct(private AccessCodeService $codes) {}

    public function handle(Request $request, Closure $next): Response
    {
        $session = $this->codes->session($request->bearerToken());
        if (! $session) {
            throw new AppException('not_unlocked', [], 401);
        }

        $request->attributes->set('wholesaleSession', $session);

        return $next($request);
    }

    /** The session on the current request, for a controller that asked for this middleware. */
    public static function of(Request $request): WholesaleSession
    {
        return $request->attributes->get('wholesaleSession');
    }
}
