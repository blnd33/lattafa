<?php

namespace App\Services\Catalogue;

use App\Exceptions\AppException;
use App\Models\User;
use App\Models\WholesaleOrder;
use App\Models\WholesalePayment;
use App\Services\AuditService;
use App\Services\Concerns\RequiresPermission;
use App\Support\CataloguePricing;
use App\Support\Time;
use Illuminate\Support\Facades\DB;

/**
 * Money received against a wholesale order.
 *
 * ## Payment is its own track
 *
 * Nothing here ever changes an order's state, and approving an order never changes its payment state. A shop can
 * pay in advance for an order nobody has approved yet, and can be approved on terms and pay next month. The two
 * are written separately and read separately, which is what the brief asks for and what wholesale actually works
 * like.
 *
 * Above all: **no stock moves because money arrived.** Stock moves when an order is approved, and only then.
 *
 * ## Offline is built; online is a door with nothing behind it
 *
 * Bank transfers and cash are real here — recorded with their reference, confirmed or left pending, part payments
 * added up. Card payment is not: no provider has been chosen, and which are even possible depends on the merchant
 * jurisdiction. `wholesale_payment_events` exists so that when one is connected, the same notification arriving
 * twice cannot be counted twice — its `(provider, external_id)` is unique, which is the whole guard. Nothing in
 * this file pretends a provider is connected.
 */
class PaymentService
{
    use RequiresPermission;

    /** What the shop can actually take today. */
    public const OFFLINE = ['bank_transfer', 'cash', 'other'];

    public function __construct(private AuditService $audit) {}

    /**
     * Records money received. Part payments are expected; the order's status follows from what has been confirmed.
     *
     * @param  array{method: string, amountCents: int, reference?: string, note?: string, status?: string, occurredAt?: int}  $in
     */
    public function record(User $actor, string $orderId, array $in): WholesalePayment
    {
        $this->need($actor, 'catalogue.payments');

        $method = $in['method'] ?? '';
        if (! in_array($method, self::OFFLINE, true)) {
            // `online` is deliberately refused here: there is no provider, and pretending otherwise would be a lie
            throw new AppException('payment_method_unavailable', ['method' => $method]);
        }

        $amount = (int) ($in['amountCents'] ?? 0);
        if ($amount <= 0) {
            throw new AppException('invalid_amount');
        }

        $status = $in['status'] ?? 'confirmed';
        if (! in_array($status, WholesalePayment::STATUSES, true)) {
            throw new AppException('payment_status_invalid');
        }

        return DB::transaction(function () use ($actor, $orderId, $method, $amount, $status, $in) {
            $order = WholesaleOrder::lockForUpdate()->findOrFail($orderId);

            $payment = WholesalePayment::create([
                'order_id' => $order->id,
                'method' => $method,
                'amount_cents' => $amount,
                'status' => $status,
                'reference' => trim($in['reference'] ?? ''),
                'note' => trim($in['note'] ?? ''),
                'recorded_by' => $actor->id,
                'recorded_by_name' => $actor->name,
                'occurred_at' => $in['occurredAt'] ?? Time::nowMs(),
            ]);

            $this->settle($order);

            $this->audit->log($actor, 'catalogue.payment_recorded', 'wholesale_order', $order->id, [
                'order' => $order->reading(), 'method' => $method,
                'amount' => CataloguePricing::dollars($amount), 'status' => $status,
            ]);

            return $payment;
        });
    }

    /** Changes a payment that was recorded wrongly, or marks a pending one confirmed. */
    public function setStatus(User $actor, string $paymentId, string $status): WholesalePayment
    {
        $this->need($actor, 'catalogue.payments');
        if (! in_array($status, WholesalePayment::STATUSES, true)) {
            throw new AppException('payment_status_invalid');
        }

        return DB::transaction(function () use ($actor, $paymentId, $status) {
            $payment = WholesalePayment::findOrFail($paymentId);
            $was = $payment->status;
            if ($was === $status) {
                return $payment;
            }

            $payment->update(['status' => $status]);
            $order = WholesaleOrder::lockForUpdate()->findOrFail($payment->order_id);
            $this->settle($order);

            $this->audit->log($actor, 'catalogue.payment_status', 'wholesale_order', $order->id, [
                'order' => $order->reading(), 'amount' => CataloguePricing::dollars($payment->amount_cents), 'status' => [$was, $status],
            ]);

            return $payment->fresh();
        });
    }

    /**
     * Works out where an order stands on money, from what has actually been confirmed.
     *
     * A refund is subtracted, so an order refunded in full reads as refunded rather than paid. Anything confirmed
     * but short of the total is a part payment, which wholesale does all the time.
     */
    public function settle(WholesaleOrder $order): WholesaleOrder
    {
        $payments = WholesalePayment::where('order_id', $order->id)->get();

        $confirmed = $payments->where('status', 'confirmed')->sum('amount_cents');
        $refunded = $payments->where('status', 'refunded')->sum('amount_cents');
        $paid = max(0, $confirmed - $refunded);

        $status = match (true) {
            $refunded > 0 && $paid === 0 => 'refunded',
            $paid >= $order->subtotal_cents && $order->subtotal_cents > 0 => 'paid',
            $paid > 0 => 'partial',
            $payments->contains(fn (WholesalePayment $p) => $p->status === 'pending') => 'pending',
            $payments->contains(fn (WholesalePayment $p) => $p->status === 'failed') => 'failed',
            default => 'unpaid',
        };

        // only the money track is written here; the order's own status is never touched
        $order->update(['paid_cents' => $paid, 'payment_status' => $status]);

        return $order;
    }

    /** @return \Illuminate\Database\Eloquent\Collection<int, WholesalePayment> */
    public function forOrder(User $actor, string $orderId)
    {
        $this->need($actor, 'catalogue.payments');

        return WholesalePayment::where('order_id', $orderId)->orderByDesc('occurred_at')->get();
    }

    public function delete(User $actor, string $paymentId): void
    {
        $this->need($actor, 'catalogue.payments');

        DB::transaction(function () use ($actor, $paymentId) {
            $payment = WholesalePayment::findOrFail($paymentId);
            $order = WholesaleOrder::lockForUpdate()->findOrFail($payment->order_id);
            $payment->delete();
            $this->settle($order);

            $this->audit->log($actor, 'catalogue.payment_deleted', 'wholesale_order', $order->id, [
                'order' => $order->reading(), 'amount' => CataloguePricing::dollars($payment->amount_cents),
            ]);
        });
    }
}
