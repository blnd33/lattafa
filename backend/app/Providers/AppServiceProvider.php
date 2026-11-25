<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        // the admin panel's assistant talks to Claude with the key from .env (tests swap in a fake transport)
        $this->app->bind(\Anthropic\Client::class, fn () => new \Anthropic\Client(
            apiKey: (string) config('services.anthropic.key'),
            baseUrl: config('services.anthropic.base_url') ?: null,
            requestOptions: ['timeout' => 120.0, 'maxRetries' => 2],
        ));
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        //
    }
}
