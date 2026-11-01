<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Browser safety headers on every response Laravel sends (the API and the app pages). Files the web server sends by
 * itself (/pos/, /assets/…) need the same lines in its config — see the deployment guide.
 */
class SecurityHeaders
{
    /** The apps use the camera (barcode scanner), GPS (delegate) and keep-screen-on — for this site only. */
    public const PERMISSIONS = 'camera=(self), geolocation=(self), screen-wake-lock=(self), microphone=(), payment=()';

    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);
        $headers = [
            'X-Content-Type-Options' => 'nosniff',           // a file is only ever treated as what it says it is
            'X-Frame-Options' => 'SAMEORIGIN',                // no other site can show the POS inside a frame (click-jacking)
            'Referrer-Policy' => 'strict-origin-when-cross-origin',
            'Permissions-Policy' => self::PERMISSIONS,
        ];
        if ($request->isSecure()) {
            $headers['Strict-Transport-Security'] = 'max-age=31536000'; // browsers then refuse plain http for a year
        }
        foreach ($headers as $name => $value) {
            if (! $response->headers->has($name)) {
                $response->headers->set($name, $value);
            }
        }

        return $response;
    }
}
