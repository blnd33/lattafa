<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\Present;
use App\Services\StockService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Stock levels are part of the product list; these endpoints change or explain them. */
class StockController extends Controller
{
    public function __construct(private StockService $stock) {}

    public function adjust(Request $r): JsonResponse
    {
        $d = $r->validate(['variantId' => ['required', 'uuid'], 'newQty' => ['required', 'integer', 'min:0'], 'reason' => ['required', 'in:adjustment,damage'], 'note' => ['nullable', 'string', 'max:255']]);
        $this->stock->adjust($r->user(), $d['variantId'], $d['newQty'], $d['reason'], $d['note'] ?? '');

        return response()->json(['ok' => true]);
    }

    public function receive(Request $r): JsonResponse
    {
        $d = $r->validate(['items' => ['required', 'array', 'min:1'], 'items.*.variantId' => ['required', 'uuid'], 'items.*.qty' => ['required', 'integer', 'min:1'], 'items.*.costIQD' => ['nullable', 'integer', 'min:0'], 'note' => ['nullable', 'string', 'max:255']]);
        $this->stock->receive($r->user(), $d['items'], $d['note'] ?? '');

        return response()->json(['ok' => true]);
    }

    public function tester(Request $r): JsonResponse
    {
        $d = $r->validate(['variantId' => ['required', 'uuid'], 'qty' => ['required', 'integer', 'min:1'], 'note' => ['nullable', 'string', 'max:255']]);
        $this->stock->tester($r->user(), $d['variantId'], $d['qty'], $d['note'] ?? '');

        return response()->json(['ok' => true]);
    }

    public function count(Request $r): JsonResponse
    {
        $d = $r->validate(['lines' => ['required', 'array', 'min:1'], 'lines.*.variantId' => ['required', 'uuid'], 'lines.*.counted' => ['required', 'integer', 'min:0'], 'note' => ['nullable', 'string', 'max:255']]);

        return response()->json($this->stock->applyCount($r->user(), $d['lines'], $d['note'] ?? ''));
    }

    public function movements(Request $r): JsonResponse
    {
        $rows = $this->stock->movements($r->user(), $this->uuidQuery($r, 'variantId'), (int) $r->query('limit', 200));

        return response()->json(['movements' => $rows->map(fn ($m) => Present::movement($m))->values()]);
    }

    public function low(Request $r): JsonResponse
    {
        return response()->json(['items' => $this->stock->lowStock($r->user())]);
    }
}
