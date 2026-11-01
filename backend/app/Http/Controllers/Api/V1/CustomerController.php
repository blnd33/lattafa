<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\CustomerRequest;
use App\Http\Resources\Present;
use App\Services\CustomerService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class CustomerController extends Controller
{
    public function __construct(private CustomerService $customers) {}

    public function index(Request $r): JsonResponse
    {
        return response()->json(['customers' => $this->customers->list($r->user())->map(fn ($c) => Present::customer($c))->values()]);
    }

    public function show(Request $r, string $id): JsonResponse
    {
        return response()->json(['customer' => Present::customer($this->customers->find($r->user(), $id))]);
    }

    public function store(CustomerRequest $r): JsonResponse
    {
        return response()->json(['customer' => Present::customer($this->customers->save($r->user(), $r->validated()))], 201);
    }

    public function update(CustomerRequest $r, string $id): JsonResponse
    {
        return response()->json(['customer' => Present::customer($this->customers->save($r->user(), ['id' => $id] + $r->validated()))]);
    }

    public function destroy(Request $r, string $id): JsonResponse
    {
        $this->customers->delete($r->user(), $id);

        return response()->json(['ok' => true]);
    }

    public function collect(Request $r, string $id): JsonResponse
    {
        $d = $r->validate([
            'amountIQD' => ['required', 'integer', 'min:1'], 'method' => ['required', 'in:cash_iqd,cash_usd,card,fib,zain'], 'note' => ['nullable', 'string', 'max:255'], 'id' => ['nullable', 'uuid'],
            'tenderedUSD' => ['required_if:method,cash_usd', 'nullable', 'numeric', 'min:0.01', 'max:10000000'], 'rate' => ['nullable', 'integer', 'min:1'],
        ]);
        $c = $this->customers->collect($r->user(), $id, $d['amountIQD'], $d['method'], $d['note'] ?? '', $d['id'] ?? null, tenderedUSD: isset($d['tenderedUSD']) ? (float) $d['tenderedUSD'] : null, rate: $d['rate'] ?? null);

        return response()->json(['collection' => Present::collection($c), 'customer' => Present::customer($this->customers->find($r->user(), $id))], 201);
    }

    public function statement(Request $r, string $id): JsonResponse
    {
        $s = $this->customers->statement($r->user(), $id);

        return response()->json(['rows' => $s['rows'], 'sales' => $s['sales']->map(fn ($x) => Present::sale($x, false))->values()]);
    }
}
