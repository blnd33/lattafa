<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\Present;
use App\Services\PurchasingService;
use App\Support\Money;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Suppliers, purchase orders, receiving and supplier payments (admin panel → Purchasing). */
class PurchasingController extends Controller
{
    public function __construct(private PurchasingService $buy) {}

    public function suppliers(Request $r): JsonResponse
    {
        return response()->json(['suppliers' => $this->buy->suppliers($r->user())]);
    }

    public function saveSupplier(Request $r, ?string $id = null): JsonResponse
    {
        $d = $r->validate([
            'name' => ['required', 'string', 'max:120'], 'phone' => ['nullable', 'string', 'max:40'], 'contact' => ['nullable', 'string', 'max:120'],
            'city' => ['nullable', 'string', 'max:80'], 'currency' => ['required', 'in:'.implode(',', Money::CURRENCIES)], 'notes' => ['nullable', 'string', 'max:2000'],
            'active' => ['nullable', 'boolean'],
        ]);
        $s = $this->buy->saveSupplier($r->user(), ['id' => $id] + $d);
        $balance = $this->buy->balances()[$s->id] ?? 0;

        return response()->json(['supplier' => Present::supplier($s, $balance)], $id ? 200 : 201);
    }

    public function statement(Request $r, string $id): JsonResponse
    {
        return response()->json($this->buy->statement($r->user(), $id));
    }

    public function pay(Request $r, string $id): JsonResponse
    {
        $d = $r->validate([
            'amount' => ['required', 'numeric', 'gt:0', 'max:999999999999'], 'method' => ['required', 'in:'.implode(',', PurchasingService::METHODS)],
            'note' => ['nullable', 'string', 'max:500'], 'paidAt' => ['nullable', 'integer', 'min:0'], 'rate' => ['nullable', 'integer', 'min:1', 'max:100000'],
            'purchaseOrderId' => ['nullable', 'uuid'],
        ]);

        return response()->json(['payment' => Present::supplierPayment($this->buy->pay($r->user(), $id, $d))], 201);
    }

    public function deletePayment(Request $r, string $id): JsonResponse
    {
        $this->buy->deletePayment($r->user(), $id);

        return response()->json(['ok' => true]);
    }

    public function orders(Request $r): JsonResponse
    {
        $r->validate(['status' => ['nullable', 'in:waiting,received,cancelled,all'], 'supplierId' => ['nullable', 'uuid']]);

        return response()->json(['orders' => $this->buy->orders($r->user(), ['status' => $r->query('status'), 'supplierId' => $r->query('supplierId')])]);
    }

    public function order(Request $r, string $id): JsonResponse
    {
        return response()->json(['order' => $this->buy->order($r->user(), $id)]);
    }

    public function createOrder(Request $r): JsonResponse
    {
        $o = $this->buy->createOrder($r->user(), $r->validate(self::orderRules() + ['supplierId' => ['required', 'uuid'], 'receiveNow' => ['nullable', 'boolean']]));

        return response()->json(['order' => $this->buy->order($r->user(), $o->id)], 201);
    }

    public function updateOrder(Request $r, string $id): JsonResponse
    {
        $o = $this->buy->updateOrder($r->user(), $id, $r->validate(self::orderRules()));

        return response()->json(['order' => $this->buy->order($r->user(), $o->id)]);
    }

    public function receive(Request $r, string $id): JsonResponse
    {
        $d = $r->validate([
            'lines' => ['required', 'array', 'min:1', 'max:500'], 'lines.*.itemId' => ['required', 'integer'], 'lines.*.qty' => ['required', 'integer', 'min:0', 'max:1000000'],
            'lines.*.unitCost' => ['nullable', 'numeric', 'min:0', 'max:999999999'], 'rate' => ['nullable', 'integer', 'min:1', 'max:100000'], 'note' => ['nullable', 'string', 'max:500'],
        ]);
        $o = $this->buy->receive($r->user(), $id, $d);

        return response()->json(['order' => $this->buy->order($r->user(), $o->id)]);
    }

    public function cancel(Request $r, string $id): JsonResponse
    {
        $o = $this->buy->cancel($r->user(), $id);

        return response()->json(['order' => $this->buy->order($r->user(), $o->id)]);
    }

    /** @return array<string, array<int, string>> */
    private static function orderRules(): array
    {
        return [
            'lines' => ['required', 'array', 'min:1', 'max:500'], 'lines.*.variantId' => ['required', 'uuid'], 'lines.*.qty' => ['required', 'integer', 'min:1', 'max:1000000'],
            'lines.*.unitCost' => ['required', 'numeric', 'min:0', 'max:999999999'], 'rate' => ['nullable', 'integer', 'min:1', 'max:100000'],
            'note' => ['nullable', 'string', 'max:500'], 'expectedAt' => ['nullable', 'integer', 'min:0'],
        ];
    }
}
