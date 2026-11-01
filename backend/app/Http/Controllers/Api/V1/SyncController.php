<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\SyncPushRequest;
use App\Services\SyncService;
use App\Support\Time;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SyncController extends Controller
{
    public function __construct(private SyncService $sync) {}

    /**
     * A till uploads its offline work. Response has one result per item:
     *   ok | duplicate  → done, remove from the till's outbox
     *   retry           → try again later (e.g. a return whose sale hasn't arrived yet)
     *   rejected        → will never succeed; `code` explains why
     *   error           → server problem, retry
     */
    public function push(SyncPushRequest $r): JsonResponse
    {
        $results = $this->sync->push($r->user(), $r->attributes->get('device'), $r->validated('items'));

        return response()->json(['serverTime' => Time::nowMs(), 'results' => $results]);
    }

    /** Changes since `since` (epoch ms; omit or 0 for everything). Push first, then pull. */
    public function pull(Request $r): JsonResponse
    {
        return response()->json($this->sync->pull($r->user(), max(0, (int) $r->query('since', 0)), $r->attributes->get('device')));
    }
}
