<?php

namespace App\Services;

use App\Exceptions\AppException;
use App\Models\Customer;
use App\Models\Order;
use App\Models\User;
use App\Models\Variant;
use App\Services\Concerns\RequiresPermission;
use App\Support\Time;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Orders shops send from the customer menu.
 *
 * Anyone who opens the menu may send one — it is a request, not a sale: items, how many, and who is asking. Every
 * delegate sees the new ones and the first to accept takes it; the money is settled in the delegate app when the
 * goods are handed over. Nothing here touches stock, prices or balances.
 */
class OrderService
{
    use RequiresPermission;

    /** The most lines one order may hold, and the most bottles of any one line. */
    public const MAX_LINES = 60;
    public const MAX_QTY = 500;

    public function __construct(private AuditService $audit, private PushService $push) {}

    /**
     * A shop's order from the menu. Public: the sender is whoever opened the menu, so everything is checked here —
     * the sizes must exist and be on sale, the quantities must be sane, and the text is kept short.
     *
     * @param array{shopName: string, phone: string, note?: string, items: array<int, array{variantId: string, qty: int}>} $in
     */
    public function place(array $in): Order
    {
        $lines = [];
        foreach (array_slice($in['items'], 0, self::MAX_LINES) as $it) {
            $qty = (int) ($it['qty'] ?? 0);
            if ($qty < 1) {
                continue;
            }
            $v = Variant::with('product')->find($it['variantId'] ?? '');
            if (! $v || ! $v->active || ! $v->product || ! $v->product->active) {
                throw new AppException('product_unavailable', ['variantId' => (string) ($it['variantId'] ?? '')]);
            }
            $lines[] = [
                'variantId' => $v->id, 'productId' => $v->product_id, 'name' => $v->product->name,
                'brand' => $v->product->brand, 'label' => $v->label, 'sku' => $v->sku, 'qty' => min($qty, self::MAX_QTY),
            ];
        }
        if (! $lines) {
            throw new AppException('nothing_to_order');
        }
        $phone = trim($in['phone']);

        return DB::transaction(function () use ($in, $phone, $lines) {
            $order = Order::create([
                'id' => (string) Str::uuid7(),
                'number' => (int) (Order::max('number') ?? 0) + 1,
                'shop_name' => trim($in['shopName']),
                'phone' => $phone,
                'note' => mb_substr(trim($in['note'] ?? ''), 0, 500),
                // a shop already on file is recognised by its phone, so the delegate sees who it is
                'customer_id' => $phone === '' ? null : Customer::where('phone', $phone)->value('id'),
                'items' => $lines,
                'units' => array_sum(array_column($lines, 'qty')),
                'placed_at' => Time::nowMs(),
            ]);
            $this->audit->log(null, 'order.placed', 'order', $order->id, ['number' => $order->number, 'shop' => $order->shop_name, 'units' => $order->units]);

            return $order;
        });
    }

    /**
     * Wakes the phones of everyone who asked to be told. Called after the order is safely saved, never inside the
     * transaction — a push service being slow or down must not lose the shop's order.
     */
    public function announce(Order $order): void
    {
        $this->push->notify([
            'title' => $order->shop_name,
            'body' => $order->units === 1 ? '1 bottle ordered' : "{$order->units} bottles ordered",
            'url' => '/delegate/#/orders',
            'tag' => 'order-'.$order->id,
        ]);
    }

    /** New orders first, then the handled ones. Delegates and managers see the same list. */
    public function list(User $actor, ?string $status = null, int $limit = 100): array
    {
        $this->needOrders($actor);

        return Order::when($status, fn ($q) => $q->where('status', $status))
            ->orderByRaw("CASE WHEN status = 'new' THEN 0 ELSE 1 END")
            ->orderByDesc('placed_at')->limit(min($limit, 300))->get()->all();
    }

    /** How many are still waiting — the number on the bell. */
    public function waiting(User $actor): int
    {
        $this->needOrders($actor);

        return Order::where('status', 'new')->count();
    }

    /** Taking an order: the first delegate to accept gets it, the others are told it is gone. */
    public function accept(User $actor, string $id): Order
    {
        return $this->handle($actor, $id, 'accepted', '');
    }

    public function refuse(User $actor, string $id, string $reason = ''): Order
    {
        return $this->handle($actor, $id, 'refused', mb_substr(trim($reason), 0, 200));
    }

    private function handle(User $actor, string $id, string $status, string $reason): Order
    {
        $this->needOrders($actor);

        return DB::transaction(function () use ($actor, $id, $status, $reason) {
            $order = Order::whereKey($id)->lockForUpdate()->first();
            if (! $order) {
                throw AppException::notFound();
            }
            if ($order->status !== 'new') {
                // someone got there first: say who, so the phone can show it instead of failing silently
                throw new AppException('order_taken', ['by' => User::whereKey($order->handled_by)->value('name') ?? '', 'status' => $order->status], 409);
            }
            $order->update(['status' => $status, 'handled_by' => $actor->id, 'handled_at' => Time::nowMs(), 'refuse_reason' => $reason]);
            $this->audit->log($actor, "order.{$status}", 'order', $order->id, ['number' => $order->number, 'shop' => $order->shop_name] + ($reason ? ['reason' => $reason] : []));

            return $order;
        });
    }

    /** Delegates work the orders; managers watch them. */
    private function needOrders(User $actor): void
    {
        if (! $actor->can('delegate.sell') && ! $actor->can('delegates.manage')) {
            throw AppException::forbidden('delegate.sell');
        }
    }
}
