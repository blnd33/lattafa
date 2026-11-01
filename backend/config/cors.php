<?php

/*
|--------------------------------------------------------------------------
| Cross-Origin Resource Sharing
|--------------------------------------------------------------------------
| The POS, Menu and Admin apps are separate web apps on their own origins and call this API from the
| browser. Only the origins listed in CORS_ALLOWED_ORIGINS may do so. Authentication is a Bearer token
| (never cookies), so credentials are not shared cross-origin.
*/

$list = fn (?string $v): array => array_values(array_filter(array_map('trim', explode(',', (string) $v))));

return [
    'paths' => ['api/*'],

    'allowed_methods' => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],

    'allowed_origins' => $list(env('CORS_ALLOWED_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173')),

    'allowed_origins_patterns' => $list(env('CORS_ALLOWED_ORIGIN_PATTERNS')),

    'allowed_headers' => ['Authorization', 'Content-Type', 'Accept', 'X-Requested-With', 'X-Device-Id'],

    'exposed_headers' => ['Retry-After'],

    'max_age' => 600,

    'supports_credentials' => false,
];
