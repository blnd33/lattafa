<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\Present;
use App\Models\User;
use App\Services\OrderService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Orders shops send from the customer menu, and the delegates who take them. */
class OrderController extends Controller
{
    public function __construct(private OrderService $orders) {}

    /** Open to anyone with the menu — rate-limited in the routes, and everything in it is checked by the service. */
    public function store(Request $r): JsonResponse
    {
        $d = $r->validate([
            'shopName' => ['required', 'string', 'min:2', 'max:120'],
            'phone' => ['required', 'string', 'min:6', 'max:40'],
            'note' => ['nullable', 'string', 'max:500'],
            'items' => ['required', 'array', 'min:1', 'max:'.OrderService::MAX_LINES],
            'items.*.variantId' => ['required', 'uuid'],
            'items.*.qty' => ['required', 'integer', 'min:1', 'max:'.OrderService::MAX_QTY],
        ]);
        $order = $this->orders->place($d);
        $this->orders->announce($order); // the order is saved; waking the phones can safely fail

        // the shop only needs to know it arrived, and its number to quote on the phone
        return response()->json(['order' => ['number' => $order->number, 'placedAt' => $order->placed_at]], 201);
    }

    public function index(Request $r): JsonResponse
    {
        $status = in_array($r->query('status'), ['new', 'accepted', 'refused'], true) ? $r->query('status') : null;
        $orders = $this->orders->list($r->user(), $status, (int) $r->query('limit', 100));
        $names = User::whereIn('id', array_filter(array_map(fn ($o) => $o->handled_by, $orders)))->pluck('name', 'id');

        return response()->json([
            'orders' => array_map(fn ($o) => Present::order($o, $names[$o->handled_by] ?? ''), $orders),
            'waiting' => $this->orders->waiting($r->user()),
        ]);
    }

    /** Just the number on the bell — small and often asked for. */
    public function waiting(Request $r): JsonResponse
    {
        return response()->json(['waiting' => $this->orders->waiting($r->user())]);
    }

    public function accept(Request $r, string $id): JsonResponse
    {
        return response()->json(['order' => Present::order($this->orders->accept($r->user(), $id), $r->user()->name)]);
    }

    public function refuse(Request $r, string $id): JsonResponse
    {
        $d = $r->validate(['reason' => ['nullable', 'string', 'max:200']]);

        return response()->json(['order' => Present::order($this->orders->refuse($r->user(), $id, $d['reason'] ?? ''), $r->user()->name)]);
    }
}
