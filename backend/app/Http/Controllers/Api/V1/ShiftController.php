<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\Present;
use App\Services\ShiftService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ShiftController extends Controller
{
    public function __construct(private ShiftService $shifts) {}

    /** The signed-in cashier's open shift (null when none). */
    public function current(Request $r): JsonResponse
    {
        $s = $this->shifts->openFor($r->user()->id);

        return response()->json(['shift' => $s ? Present::shift($s) : null, 'totals' => $s ? $this->shifts->totals($s) : null]);
    }

    public function index(Request $r): JsonResponse
    {
        return response()->json(['shifts' => $this->shifts->list($r->user())->map(fn ($s) => Present::shift($s))->values()]);
    }

    public function show(Request $r, string $id): JsonResponse
    {
        $s = $this->shifts->find($r->user(), $id);

        return response()->json(['shift' => Present::shift($s), 'totals' => $s->totals ?? $this->shifts->totals($s)]);
    }

    public function open(Request $r): JsonResponse
    {
        $d = $r->validate(['openingIQD' => ['required', 'integer', 'min:0'], 'openingUSD' => ['nullable', 'numeric', 'min:0'], 'id' => ['nullable', 'uuid']]);
        $s = $this->shifts->open($r->user(), $d['openingIQD'], (float) ($d['openingUSD'] ?? 0), $r->attributes->get('device'), $d['id'] ?? null);

        return response()->json(['shift' => Present::shift($s)], 201);
    }

    public function cashMovement(Request $r): JsonResponse
    {
        $d = $r->validate(['type' => ['required', 'in:in,out'], 'amountIQD' => ['required', 'integer', 'min:1'], 'reason' => ['required', 'string', 'max:255']]);

        return response()->json(['shift' => Present::shift($this->shifts->addCashMovement($r->user(), $d['type'], $d['amountIQD'], $d['reason']))]);
    }

    public function close(Request $r): JsonResponse
    {
        $d = $r->validate(['countedIQD' => ['required', 'integer', 'min:0'], 'countedUSD' => ['nullable', 'numeric', 'min:0'], 'note' => ['nullable', 'string', 'max:500']]);
        $s = $this->shifts->close($r->user(), $d['countedIQD'], (float) ($d['countedUSD'] ?? 0), $d['note'] ?? '');

        return response()->json(['shift' => Present::shift($s)]);
    }
}
