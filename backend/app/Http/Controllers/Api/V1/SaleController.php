<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\CheckoutRequest;
use App\Http\Requests\CreateReturnRequest;
use App\Http\Resources\Present;
use App\Services\ReturnService;
use App\Services\SaleService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SaleController extends Controller
{
    public function __construct(private SaleService $sales, private ReturnService $returns) {}

    private function cost(Request $r): bool
    {
        return $r->user()->can('reports.financial');
    }

    /** Online checkout: prices and totals are computed by the server. */
    public function store(CheckoutRequest $r): JsonResponse
    {
        $sale = $this->sales->checkout($r->user(), $r->validated(), $r->attributes->get('device'));

        return response()->json(['sale' => Present::sale($sale, $this->cost($r))], 201);
    }

    public function index(Request $r): JsonResponse
    {
        $rows = $this->sales->list($r->user(), [
            'from' => $r->query('from') !== null ? (int) $r->query('from') : null, 'to' => $r->query('to') !== null ? (int) $r->query('to') : null,
            'userId' => $this->uuidQuery($r, 'userId'), 'status' => $r->query('status'), 'q' => $r->query('q'), 'limit' => (int) $r->query('limit', 500),
        ]);

        return response()->json(['sales' => $rows->map(fn ($s) => Present::sale($s, $this->cost($r)))->values()]);
    }

    /** By id or receipt number (so a scanned receipt barcode works). */
    public function show(Request $r, string $id): JsonResponse
    {
        return response()->json(['sale' => Present::sale($this->sales->find($r->user(), $id), $this->cost($r))]);
    }

    public function void(Request $r, string $id): JsonResponse
    {
        $d = $r->validate(['reason' => ['required', 'string', 'max:255'], 'approvedBy' => ['nullable', 'array'], 'approvedBy.id' => ['required_with:approvedBy', 'uuid']]);
        $sale = $this->sales->void($r->user(), $id, $d['reason'], $d['approvedBy']['id'] ?? null);

        return response()->json(['sale' => Present::sale($sale, $this->cost($r))]);
    }

    /** Correct a cashier's slip — Super Admin only. The bill is cancelled and written again with the right figures. */
    public function correct(Request $r, string $id): JsonResponse
    {
        $d = $r->validate([
            'reason' => ['required', 'string', 'max:255'],
            'lines' => ['required', 'array', 'min:1', 'max:200'],
            'lines.*.index' => ['required', 'integer', 'min:0'],
            'lines.*.qty' => ['required', 'integer', 'min:0', 'max:100000'],
            'lines.*.unitPriceIQD' => ['sometimes', 'integer', 'min:0', 'max:1000000000'],
        ]);
        $sale = $this->sales->correct($r->user(), $id, $d['lines'], $d['reason'], $r->attributes->get('device'));

        return response()->json(['sale' => Present::sale($sale, $this->cost($r))]);
    }

    /** Mark a flagged sale as checked (it leaves the review list; the flags stay on it). */
    public function reviewed(Request $r, string $id): JsonResponse
    {
        $d = $r->validate(['note' => ['nullable', 'string', 'max:255']]);

        return response()->json(['sale' => Present::sale($this->sales->markReviewed($r->user(), $id, $d['note'] ?? ''), $this->cost($r))]);
    }

    /** Sales flagged during sync (negative stock, price/total mismatch, credit limit…) for an admin to review. */
    public function review(Request $r): JsonResponse
    {
        return response()->json(['sales' => $this->sales->needingReview($r->user())->map(fn ($s) => Present::sale($s, $this->cost($r)))->values()]);
    }

    public function createReturn(CreateReturnRequest $r): JsonResponse
    {
        $d = $r->validated();
        $ret = $this->returns->create($r->user(), $d['saleId'], $d['lines'], $d['refundMethod'], $d['note'] ?? '', $d['approvedBy']['id'] ?? null, $r->attributes->get('device'));

        return response()->json(['return' => Present::saleReturn($ret)], 201);
    }

    public function returns(Request $r): JsonResponse
    {
        return response()->json(['returns' => $this->returns->list($r->user())->map(fn ($x) => Present::saleReturn($x))->values()]);
    }
}
