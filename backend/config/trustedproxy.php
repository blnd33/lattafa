<?php

/*
| Only needed when another server sits in front of this one (Cloudflare, a load balancer, a hosting panel's proxy).
| Without it every visitor looks like that proxy: all of them would share one sign-in rate limit, and the app could not
| tell that the visitor is on https. Leave empty when Nginx/Apache run on this same server.
|
|   TRUSTED_PROXIES=*                         trust whoever connects (only when nobody can reach the server directly)
|   TRUSTED_PROXIES=10.0.0.5,10.0.0.6         trust these addresses / ranges
*/

return [
    'proxies' => env('TRUSTED_PROXIES') ?: null,
];
