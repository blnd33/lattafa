<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\Present;
use App\Services\ExpenseService;
use App\Support\Money;
use App\Support\Time;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Shop expenses (admin panel → Expenses). */
class ExpenseController extends Controller
{
    public function __construct(private ExpenseService $expenses) {}

    /** `?from=&to=` (ms; default this month, shop time) `&category=` */
    public function index(Request $r): JsonResponse
    {
        $r->validate(['from' => ['nullable', 'integer'], 'to' => ['nullable', 'integer'], 'category' => ['nullable', 'in:'.implode(',', ExpenseService::CATEGORIES)]]);
        $from = (int) $r->query('from', (int) Time::at(Time::nowMs())->startOfMonth()->getTimestampMs());
        $to = (int) $r->query('to', Time::endOfDayMs());

        return response()->json($this->expenses->list($r->user(), $from, $to, $r->query('category')));
    }

    public function store(Request $r, ?string $id = null): JsonResponse
    {
        $d = $r->validate([
            'category' => ['required', 'in:'.implode(',', ExpenseService::CATEGORIES)], 'amount' => ['required', 'numeric', 'gt:0', 'max:999999999999'],
            'currency' => ['required', 'in:'.implode(',', Money::CURRENCIES)], 'rate' => ['nullable', 'integer', 'min:1', 'max:100000'],
            'method' => ['nullable', 'in:'.implode(',', ExpenseService::METHODS)], 'note' => ['nullable', 'string', 'max:500'], 'spentAt' => ['nullable', 'integer', 'min:0'],
        ]);
        $e = $this->expenses->save($r->user(), ['id' => $id] + $d);

        return response()->json(['expense' => Present::expense($e)], $id ? 200 : 201);
    }

    public function destroy(Request $r, string $id): JsonResponse
    {
        $this->expenses->delete($r->user(), $id);

        return response()->json(['ok' => true]);
    }
}
