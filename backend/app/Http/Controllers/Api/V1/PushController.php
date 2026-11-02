<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Services\PushService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Phones asking to be told about new orders while the app is closed. */
class PushController extends Controller
{
    public function __construct(private PushService $push) {}

    /** What the browser needs to subscribe. `enabled: false` = the shop has not set the keys up; the app then stays quiet. */
    public function key(): JsonResponse
    {
        return response()->json(['enabled' => $this->push->enabled(), 'publicKey' => $this->push->publicKey()]);
    }

    public function subscribe(Request $r): JsonResponse
    {
        $d = $r->validate([
            'endpoint' => ['required', 'string', 'max:500', 'url'],
            'p256dh' => ['required', 'string', 'max:255'],
            'auth' => ['required', 'string', 'max:255'],
            'app' => ['nullable', 'in:delegate,admin,pos'],
        ]);
        $this->push->subscribe($r->user(), $d, $d['app'] ?? 'delegate');

        return response()->json(['ok' => true]);
    }

    public function unsubscribe(Request $r): JsonResponse
    {
        $d = $r->validate(['endpoint' => ['required', 'string', 'max:500']]);
        $this->push->unsubscribe($d['endpoint']);

        return response()->json(['ok' => true]);
    }
}
