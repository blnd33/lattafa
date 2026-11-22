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
use App\Models\WholesaleSession;
use App\Services\AuditService;
use App\Services\Concerns\RequiresPermission;
use App\Services\Counters;
use App\Support\CataloguePricing;
use App\Support\Time;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Wholesale orders: placing one, and the shop’s decision on it.
 *
 * ## The catalogue sells with no limit
 *
 * Nothing here looks at the shop’s shelf. A buyer abroad orders what they want, in any quantity, and the shop
 * decides when the order arrives — so there is no hold, no reservation, nothing locked, and no refusal that
 * could tell a buyer how many bottles are on a shelf in Duhok.
 *
 * **Placing an order.** The basket is priced and checked again on the server — never trusted from the browser —
 * and the order and its lines are written in one transaction. An idempotency key makes a checkout sent twice
 * return the same order rather than creating a second.
 *
 * **Approving one.** A decision and nothing more: no stock moves. The bottles are ordered from the supplier or
 * shipped as the owner arranges, and if any of them do come off the shop’s shelf that is recorded there, in the
 * ordinary way, by whoever takes them. A repeated approval is a no-op.
 *
 * ## What this service will not do
 *
 * It will not treat opening WhatsApp as an order being sent, which is why that is recorded as its own fact.
 */class OrderService
{
    use RequiresPermission;

    public function __construct(
        private RulesService $rules,
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
            // Priced and checked again here, never trusting what the browser was shown. No stock is locked:
            // the catalogue sells with no limit, so two orders for the same bottle is not a race to lose.
            $checked = $this->rules->check($customer, $country, $lines);
            if (! $checked['ok']) {
                $first = $checked['problems'][0] ?? ['code' => 'cart_empty', 'params' => []];
                throw new AppException($first['code'], $first['params']);
            }

            $now = Time::nowMs();
            $number = 10000 + $this->counters->next('wholesale_order');
            $wanted = array_values(array_unique(array_map(fn ($l) => (string) $l['variantId'], $lines)));
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
                return $order;   // already done
            }
            if (! $order->isOpen()) {
                throw new AppException('order_not_open', ['status' => $order->status]);
            }

            $was = $order->status;
            $now = Time::nowMs();

            // Approving takes nothing off the shop's shelf. The catalogue is its own channel: these bottles are
            // ordered from the supplier or shipped as the owner arranges, and the till's stock is not part of it.
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
                // an approved order has been accepted and may already have shipped; undoing it is a return
                throw new AppException('order_already_approved');
            }
            if (! $order->isOpen()) {
                throw new AppException('order_not_open', ['status' => $order->status]);
            }

            $was = $order->status;
            $now = Time::nowMs();

            $order->update(['status' => $to, 'decided_at' => $now, 'decided_by' => $actor->id, 'reject_reason' => $reason]);
            $this->remember($order, $was, $to, $actor, $reason);

            $this->audit->log($actor, $action, 'wholesale_order', $order->id, [
                'order' => $order->reading(), 'business' => $order->business_name, 'reason' => $reason ?: '—',
            ]);

            return $order->fresh();
        });
    }

    // ───────────────────────── reading them ─────────────────────────

    /**
     * @param  array{status?: string, customerId?: string, countryId?: string, q?: string, limit?: int}  $filters
     * @return \Illuminate\Database\Eloquent\Collection<int, WholesaleOrder>
     */
    public function list(User $actor, array $filters = [])
    {
        $this->need($actor, 'catalogue.orders');

        return WholesaleOrder::with(['customer', 'country'])
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

        return WholesaleOrder::with(['items', 'history', 'payments', 'customer', 'country'])->findOrFail($orderId);
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
