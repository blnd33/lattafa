<?php

use App\Exceptions\AppException;
use App\Http\Middleware\EnsurePermission;
use App\Http\Middleware\ResolveDevice;
use App\Http\Middleware\SecurityHeaders;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        apiPrefix: 'api/v1',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->alias(['perm' => EnsurePermission::class, 'device' => ResolveDevice::class]);
        $middleware->append(SecurityHeaders::class);
        // An API has no login page to redirect to; without this a request missing `Accept: application/json` and a valid
        // token would fail with "Route [login] not defined" (a 500) instead of a clean 401.
        $middleware->redirectGuestsTo(fn () => null);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(fn (Request $request) => $request->is('api/*') || $request->expectsJson());

        // Every API error has the same shape: {"error": {"code": "...", "params": {...}}}
        // `code` is stable and maps to the POS's translated `err.<code>` messages.
        $exceptions->render(fn (AppException $e) => response()->json(['error' => ['code' => $e->errorCode, 'params' => (object) $e->params]], $e->status));
        $exceptions->render(fn (AuthenticationException $e, Request $r) => $r->is('api/*') ? response()->json(['error' => ['code' => 'not_signed_in', 'params' => (object) []]], 401) : null);
        $exceptions->render(fn (ValidationException $e, Request $r) => $r->is('api/*') ? response()->json(['error' => ['code' => 'validation', 'params' => (object) [], 'fields' => $e->errors()]], 422) : null);
        $exceptions->render(fn (ModelNotFoundException|NotFoundHttpException $e, Request $r) => $r->is('api/*') ? response()->json(['error' => ['code' => 'not_found', 'params' => (object) []]], 404) : null);
        $exceptions->render(function (HttpExceptionInterface $e, Request $r) {
            if (! $r->is('api/*') || $e->getStatusCode() < 400) {
                return null;
            }
            $code = match ($e->getStatusCode()) { 429 => 'too_many_requests', 403 => 'forbidden', 405 => 'method_not_allowed', default => 'http_error' };

            return response()->json(['error' => ['code' => $code, 'params' => (object) []]], $e->getStatusCode(), $e->getHeaders()); // keeps Retry-After on 429
        });
    })->create();
