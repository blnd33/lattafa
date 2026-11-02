<?php

/*
| Web Push (notifications that reach a phone with the app closed). Both keys come from
| `php artisan lattafa:push-keys`, which prints the two lines to paste into .env.
| Leave them empty and push is simply off — the bell inside the apps still works.
*/

return [
    'public' => env('VAPID_PUBLIC_KEY', ''),
    'private' => env('VAPID_PRIVATE_KEY', ''),
];
