<?php

use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\Route;

/*
| One domain for everything:
|   /            → the store POS (or the app named in APP_HOME — one address per app)
|   /menu/       public menu        (built from ../menu)
|   /pos/        store point of sale (built from ../pos)
|   /delegate/   delegate web app   (built from ../delegate)
|   /admin/      admin panel        (built from ../admin)
|   /api/v1/...  this API
|
| The web apps are static files in public/<app>/ (copied there by `npm run build:backend` in the project root). A web
| server normally serves them directly; these routes are the fallback when a request reaches Laravel anyway.
*/

// Static app shells: no session, cookies or CSRF (the apps sign in with API tokens), so they work whatever
// SESSION_DRIVER is set to — even before a sessions table exists.
Route::withoutMiddleware('web')->group(function () {
    // keep the final slash (Laravel's redirect() drops it): the POS/delegate offline mode covers /pos/… and /delegate/…
    Route::get('/', fn () => new RedirectResponse('/'.config('app.home').'/'));

    Route::get('/{app}', function (string $app) {
        $file = public_path($app.'/index.html');
        abort_unless(is_file($file), 404, 'The web apps are not built yet — run `npm run build:backend` in the project root.');

        // always revalidate the page itself; its hashed /assets/* files are what get cached
        return response()->file($file, ['Content-Type' => 'text/html; charset=UTF-8', 'Cache-Control' => 'no-cache']);
    })->whereIn('app', ['pos', 'delegate', 'menu', 'admin']);
});
