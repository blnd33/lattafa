<?php

namespace App\Services\Catalogue;

use App\Exceptions\AppException;
use App\Models\CatalogueCountry;
use App\Models\User;
use App\Models\Variant;
use App\Models\WholesaleCustomer;
use App\Models\WholesaleOrder;
use App\Models\WholesaleOrderItem;
use App\Models\WholesaleOrderStatus;
use App\Models\WholesaleReservation;
use App\Models\WholesaleReservationItem;
use App\Models\WholesaleSession;
use App\Services\AuditService;
use App\Services\Concerns\RequiresPermission;
use App\Services\Counters;
use App\Services\StockService;
use App\Support\CataloguePricing;
use App\Support\Time;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Throwable;

/**
 * Wholesale orders: placing one, holding the stock for it, and the shop's decision on it.
 *
 * ## The two moments that matter
 *
 * **Placing an order.** The basket is priced and checked again on the server — never trusted from the browser —
 * and then the order, its lines and its reservation are written in **one transaction** with the stock rows locked.
 * Two buyers racing for the last bottle cannot both win: the second one waits for the first to commit, re-reads
 * what is left, and is refused. An idempotency key makes a checkout sent twice return the same order rather than
 * creating a second.
 *
 * **Approving one.** The stock comes off the shelf through `StockService::applyMovement`, which is the only thing
 * in the whole system that writes stock, and the reservation is marked consumed — in the same transaction. A
 * repeated approval is a no-op, because the order is no longer pending by the time the second one looks.
 *
 * ## What this service will not do
 *
 * It will not expire a reservation. Nothing here releases stock because of time passing; a person does that by
 * deciding on the order. It will not treat opening WhatsApp as an order being sent, which is why that is recorded
 * as its own fact. And it will not mark an order approved if taking the stock failed — that lands in
 * `integration_error`, where it can be seen and tried again.
 */
class OrderService
{
    use RequiresPermission;

    public function __construct(
        private RulesService $rules,
        private StockService $stock,
        private AuditService $audit,
        private Counters $counters,
    ) {}

    // ───────────────────────── the buyer places an order ─────────────────────────

    /**
     * Prices and checks the basket, then writes the order and takes the stock off the shelf for it.
     *
     * @param  array<int, array{variantId: string, qty: int}>  $lines
     * @param  array{businessName?: string, contactPerson?: string, phone?: string, whatsapp?: string, email?: string, address?: string, note?: string}  $who
     */
    public function place(WholesaleSession $session, array $lines, array $who, string $method = 'direct', ?string $idempotencyKey = null): WholesaleOrder
    {
        $customer = $session->customer;
        if (! $customer || ! $customer->isActive()) {
            throw new AppException('customer_inactive');
        }
        if (! in_array($method, ['direct', 'whatsapp'], true)) {
            throw new AppException('order_method_invalid');
        }

        // the same checkout sent twice is the same order
        if ($idempotencyKey) {
            $seen = DB::table('wholesale_order_idempotency')->where('key', $idempotencyKey)->first();
            if ($seen) {
                if ($seen->customer_id !== $customer->id) {
                    throw new AppException('order_key_taken');
                }

                return WholesaleOrder::with('items')->findOrFail($seen->order_id);
            }
        }

        $country = $session->country_id ? CatalogueCountry::find($session->country_id) : null;

        return DB::transaction(function () use ($session, $customer, $country, $lines, $who, $method, $idempotencyKey) {
            // Lock the stock rows for every size in the basket before anything is worked out. Whoever gets here
            // second waits, then re-reads — which is what stops two orders taking the same last bottle.
            $wanted = array_values(array_unique(array_map(fn ($l) => (string) $l['variantId'], $lines)));
            DB::table('stock')->whereIn('variant_id', $wanted)->lockForUpdate()->get();

            // priced and checked again here, inside the lock: what the browser was shown is never trusted
            $checked = $this->rules->check($customer, $country, $lines);
            if (! $checked['ok']) {
                $first = $checked['problems'][0] ?? ['code' => 'cart_empty', 'params' => []];
                throw new AppException($first['code'], $first['params']);
            }

            $now = Time::nowMs();
            $number = 10000 + $this->counters->next('wholesale_order');
            $variants = Variant::with('product')->whereIn('id', $wanted)->get()->keyBy('id');

            $order = WholesaleOrder::create([
                'number' => $number,
                'reference' => strtoupper(Str::random(10)),
                'customer_id' => $customer->id,
                'country_id' => $country?->id,
                'status' => WholesaleOrder::PENDING,
                'method' => $method,
                'business_name' => trim($who['businessName'] ?? '') ?: $customer->business_name,
                'contact_person' => trim($who['contactPerson'] ?? '') ?: $customer->contact_person,
                'phone' => trim($who['phone'] ?? '') ?: $customer->phone,
                'whatsapp' => trim($who['whatsapp'] ?? '') ?: $customer->whatsapp,
                'email' => trim($who['email'] ?? '') ?: $customer->email,
                'address' => trim($who['address'] ?? '') ?: $customer->address,
                'note' => trim($who['note'] ?? ''),
                'subtotal_cents' => $checked['subtotalCents'],
                'units' => $checked['units'],
                'min_order_cents' => $checked['minOrderCents'],
                'placed_at' => $now,
            ]);

            $reservation = WholesaleReservation::create([
                'order_id' => $order->id,
                'status' => WholesaleReservation::ACTIVE,
                'held_at' => $now,
            ]);

            foreach ($checked['lines'] as $line) {
                $variant = $variants->get($line['variantId']);
                WholesaleOrderItem::create([
                    'order_id' => $order->id,
                    'variant_id' => $line['variantId'],
                    'product_id' => $variant?->product_id,
                    // frozen on purpose: renaming a perfume or changing a price must not rewrite this order
                    'sku' => $line['sku'],
                    'name' => PricingService::productName($variant?->product),
                    'label' => $variant?->label ?? '',
                    'qty' => $line['qty'],
                    'unit_cents' => (int) $line['unitCents'],
                    'line_cents' => (int) $line['lineCents'],
                    'price_source' => (string) ($line['source'] ?? ''),
                ]);
                WholesaleReservationItem::create([
                    'reservation_id' => $reservation->id,
                    'variant_id' => $line['variantId'],
                    'qty' => $line['qty'],
                ]);
            }

            $this->remember($order, '', WholesaleOrder::PENDING, null, '');

            if ($idempotencyKey) {
                DB::table('wholesale_order_idempotency')->insert([
                    'key' => $idempotencyKey, 'order_id' => $order->id, 'customer_id' => $customer->id,
                    'created_at' => now(), 'updated_at' => now(),
                ]);
            }

            $this->audit->log(null, 'catalogue.order_placed', 'wholesale_order', $order->id, [
                'order' => $order->reading(), 'business' => $customer->business_name,
                'units' => $order->units, 'total' => CataloguePricing::dollars($order->subtotal_cents),
            ]);

            return $order->fresh(['items']);
        });
    }

    /**
     * The buyer opened WhatsApp with the order in it.
     *
     * Recorded as its own fact and nothing more. Opening WhatsApp is not the message being sent, so it does not
     * move the order, and opening it again does not make a second order — the order already exists.
     */
    public function whatsappOpened(WholesaleOrder $order): WholesaleOrder
    {
        if ($order->whatsapp_opened_at === null) {
            $order->update(['whatsapp_opened_at' => Time::nowMs()]);
        }

        return $order->fresh();
    }

    // ───────────────────────── the shop decides ─────────────────────────

    /**
     * Approves an order: the stock comes off the shelf for good and the hold is consumed, together.
     *
     * Running this twice is harmless. The second call finds the order already approved and simply returns it,
     * because the state is changed inside the same transaction that moves the stock.
     */
    public function approve(User $actor, string $orderId): WholesaleOrder
    {
        $this->need($actor, 'catalogue.orders');

        return DB::transaction(function () use ($actor, $orderId) {
            $order = WholesaleOrder::lockForUpdate()->findOrFail($orderId);

            if ($order->status === WholesaleOrder::APPROVED) {
                return $order;   // already done; deducting again would take the stock twice
            }
            if (! $order->isOpen()) {
                throw new AppException('order_not_open', ['status' => $order->status]);
            }

            $reservation = WholesaleReservation::where('order_id', $order->id)->lockForUpdate()->first();
            if (! $reservation || $reservation->status === WholesaleReservation::CONSUMED) {
                throw new AppException('reservation_missing');
            }

            $was = $order->status;
            $now = Time::nowMs();

            try {
                foreach ($reservation->items as $item) {
                    // the one writer of stock in the whole system; the hold is what made this quantity safe
                    $this->stock->applyMovement($item->variant_id, -$item->qty, 'sale', $actor, [
                        'refType' => 'wholesale_order',
                        'refId' => $order->id,
                        'note' => 'Wholesale order '.$order->reading(),
                        'occurredAt' => $now,
                    ]);
                }
            } catch (Throwable $e) {
                // Nothing is marked approved when the stock could not be taken. The transaction rolls back, so
                // the hold stands and the order can be tried again once the shop has looked at it.
                throw new AppException('order_stock_failed', ['sku' => $e instanceof AppException ? (string) ($e->params['sku'] ?? '') : '']);
            }

            $reservation->update(['status' => WholesaleReservation::CONSUMED, 'consumed_at' => $now]);
            $order->update(['status' => WholesaleOrder::APPROVED, 'decided_at' => $now, 'decided_by' => $actor->id]);
            $this->remember($order, $was, WholesaleOrder::APPROVED, $actor, '');

            $customer = $order->customer;
            $customer?->update([
                'orders_count' => $customer->orders_count + 1,
                'orders_value_cents' => $customer->orders_value_cents + $order->subtotal_cents,
            ]);

            $this->audit->log($actor, 'catalogue.order_approved', 'wholesale_order', $order->id, [
                'order' => $order->reading(), 'business' => $order->business_name,
                'total' => CataloguePricing::dollars($order->subtotal_cents),
            ]);

            return $order->fresh();
        });
    }

    /** Refuses an order and lets the bottles go. */
    public function reject(User $actor, string $orderId, string $reason = ''): WholesaleOrder
    {
        return $this->close($actor, $orderId, WholesaleOrder::REJECTED, $reason, 'catalogue.order_rejected');
    }

    /** Calls an order off — the shop's own doing, or at the buyer's asking. The bottles go back. */
    public function cancel(User $actor, string $orderId, string $reason = ''): WholesaleOrder
    {
        return $this->close($actor, $orderId, WholesaleOrder::CANCELLED, $reason, 'catalogue.order_cancelled');
    }

    private function close(User $actor, string $orderId, string $to, string $reason, string $action): WholesaleOrder
    {
        $this->need($actor, 'catalogue.orders');

        return DB::transaction(function () use ($actor, $orderId, $to, $reason, $action) {
            $order = WholesaleOrder::lockForUpdate()->findOrFail($orderId);
            if ($order->status === $to) {
                return $order;
            }
            if ($order->status === WholesaleOrder::APPROVED) {
                // the stock is already gone; undoing that is a return, not a cancellation
                throw new AppException('order_already_approved');
            }
            if (! $order->isOpen()) {
                throw new AppException('order_not_open', ['status' => $order->status]);
            }

            $was = $order->status;
            $now = Time::nowMs();
            $this->release($order, $now, $reason);

            $order->update(['status' => $to, 'decided_at' => $now, 'decided_by' => $actor->id, 'reject_reason' => $reason]);
            $this->remember($order, $was, $to, $actor, $reason);

            $this->audit->log($actor, $action, 'wholesale_order', $order->id, [
                'order' => $order->reading(), 'business' => $order->business_name, 'reason' => $reason ?: '—',
            ]);

            return $order->fresh();
        });
    }

    /**
     * Lets a hold go by hand, leaving the order where it is.
     *
     * For an order that has sat so long the shop would rather have the bottles back without deciding on it yet.
     * The brief asks for this precisely because nothing expires on its own.
     */
    public function releaseHold(User $actor, string $orderId, string $reason = ''): WholesaleOrder
    {
        $this->need($actor, 'catalogue.orders');

        return DB::transaction(function () use ($actor, $orderId, $reason) {
            $order = WholesaleOrder::lockForUpdate()->findOrFail($orderId);
            $this->release($order, Time::nowMs(), $reason);

            $this->audit->log($actor, 'catalogue.hold_released', 'wholesale_order', $order->id, [
                'order' => $order->reading(), 'reason' => $reason ?: '—',
            ]);

            return $order->fresh();
        });
    }

    private function release(WholesaleOrder $order, int $now, string $reason): void
    {
        $reservation = WholesaleReservation::where('order_id', $order->id)->lockForUpdate()->first();
        if (! $reservation || $reservation->status !== WholesaleReservation::ACTIVE) {
            return;   // already consumed or already let go
        }
        $reservation->update(['status' => WholesaleReservation::RELEASED, 'released_at' => $now, 'note' => $reason]);
    }

    // ───────────────────────── reading them ─────────────────────────

    /**
     * @param  array{status?: string, customerId?: string, countryId?: string, q?: string, limit?: int}  $filters
     * @return \Illuminate\Database\Eloquent\Collection<int, WholesaleOrder>
     */
    public function list(User $actor, array $filters = [])
    {
        $this->need($actor, 'catalogue.orders');

        return WholesaleOrder::with(['customer', 'country', 'reservation'])
            ->when($filters['status'] ?? null, fn ($b, $s) => $b->where('status', $s))
            ->when($filters['customerId'] ?? null, fn ($b, $c) => $b->where('customer_id', $c))
            ->when($filters['countryId'] ?? null, fn ($b, $c) => $b->where('country_id', $c))
            ->when($filters['q'] ?? null, function ($b, $q) {
                $like = '%'.str_replace(['%', '_'], ['\%', '\_'], trim($q)).'%';
                $b->where(fn ($w) => $w->where('business_name', 'like', $like)->orWhere('number', 'like', $like));
            })
            ->orderByDesc('placed_at')
            ->limit(min(500, max(1, (int) ($filters['limit'] ?? 200))))
            ->get();
    }

    public function get(User $actor, string $orderId): WholesaleOrder
    {
        $this->need($actor, 'catalogue.orders');

        return WholesaleOrder::with(['items', 'reservation.items', 'history', 'payments', 'customer', 'country'])->findOrFail($orderId);
    }

    /**
     * The buyer's own order, found by the reference they were given.
     *
     * Knowing an order number is not enough: the reference is random and the session must belong to the same
     * business, so one buyer cannot read another's order by counting upwards.
     */
    public function forBuyer(WholesaleSession $session, string $reference): WholesaleOrder
    {
        $order = WholesaleOrder::with('items')
            ->where('reference', strtoupper(trim($reference)))
            ->where('customer_id', $session->customer_id)
            ->first();

        if (! $order) {
            throw AppException::notFound();
        }

        return $order;
    }

    /** @return \Illuminate\Database\Eloquent\Collection<int, WholesaleOrder> */
    public function mine(WholesaleSession $session)
    {
        return WholesaleOrder::with('items')
            ->where('customer_id', $session->customer_id)
            ->orderByDesc('placed_at')
            ->limit(50)
            ->get();
    }

    private function remember(WholesaleOrder $order, string $from, string $to, ?User $actor, string $reason): void
    {
        WholesaleOrderStatus::create([
            'order_id' => $order->id,
            'from_status' => $from,
            'to_status' => $to,
            'by_user_id' => $actor?->id,
            'by_name' => $actor?->name ?? '',
            'reason' => $reason,
            'occurred_at' => Time::nowMs(),
        ]);
    }
}
