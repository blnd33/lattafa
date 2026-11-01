<?php

namespace App\Services;

use App\Exceptions\AppException;
use App\Http\Resources\Present;
use App\Models\PurchaseOrder;
use App\Models\PurchaseOrderItem;
use App\Models\PurchaseReceipt;
use App\Models\Supplier;
use App\Models\SupplierPayment;
use App\Models\User;
use App\Models\Variant;
use App\Services\Concerns\RequiresPermission;
use App\Support\Money;
use App\Support\Time;
use Illuminate\Support\Facades\DB;

/**
 * Buying from suppliers.
 *
 *  - An order lists what is wanted at what unit cost, in the supplier's currency (USD or IQD) with the dollar rate.
 *  - Receiving puts the bottles in the shop's stock (through StockService, so every bottle can be explained), sets each
 *    size's cost price to what was paid (in dinars at that rate), and adds the delivery to what the shop owes.
 *  - Payments bring the balance down. Balance = everything received − everything paid, in the supplier's currency.
 */
class PurchasingService
{
    use RequiresPermission;

    public const METHODS = ['cash', 'bank', 'other'];

    /** orders still expecting goods */
    public const WAITING = ['open', 'partial'];

    public function __construct(private StockService $stock, private AuditService $audit, private Counters $counters, private SettingsService $settings) {}

    /* ───────── suppliers ───────── */

    /** @return array<int, array<string, mixed>> every supplier, with what the shop owes them and their open orders */
    public function suppliers(User $actor): array
    {
        $this->need($actor, 'purchasing.view');
        $owed = $this->balances();
        $waiting = DB::table('purchase_orders')->whereIn('status', self::WAITING)->selectRaw('supplier_id, count(*) as n')->groupBy('supplier_id')->pluck('n', 'supplier_id');

        return Supplier::orderByDesc('active')->orderBy('name')->get()
            ->map(fn (Supplier $s) => Present::supplier($s, $owed[$s->id] ?? 0, (int) ($waiting[$s->id] ?? 0)))->all();
    }

    /** @param array<string, mixed> $in {id?, name, phone?, contact?, city?, currency, notes?, active?} */
    public function saveSupplier(User $actor, array $in): Supplier
    {
        $this->need($actor, 'purchasing.manage');
        $currency = (string) ($in['currency'] ?? 'USD');
        if (! in_array($currency, Money::CURRENCIES, true)) {
            throw new AppException('validation');
        }
        $data = [
            'name' => trim((string) $in['name']), 'phone' => trim((string) ($in['phone'] ?? '')), 'contact' => trim((string) ($in['contact'] ?? '')),
            'city' => trim((string) ($in['city'] ?? '')), 'currency' => $currency, 'notes' => trim((string) ($in['notes'] ?? '')), 'active' => (bool) ($in['active'] ?? true),
        ];
        if ($data['name'] === '') {
            throw new AppException('validation');
        }
        if (! empty($in['id'])) {
            $s = Supplier::find($in['id']) ?? throw AppException::notFound();
            // a balance only makes sense in one currency: it is fixed once there are orders or payments
            if ($s->currency !== $currency && $this->hasHistory($s->id)) {
                throw new AppException('supplier_currency_locked');
            }
            $s->update($data);
            $this->audit->log($actor, 'supplier.update', 'supplier', $s->id, ['name' => $s->name]);

            return $s;
        }
        $s = Supplier::create($data);
        $this->audit->log($actor, 'supplier.create', 'supplier', $s->id, ['name' => $s->name, 'currency' => $currency]);

        return $s;
    }

    /** Every delivery (+) and payment (−), oldest first, with the running balance. @return array<string, mixed> */
    public function statement(User $actor, string $supplierId): array
    {
        $this->need($actor, 'purchasing.view');
        $s = Supplier::find($supplierId) ?? throw AppException::notFound();
        $numbers = DB::table('purchase_orders')->where('supplier_id', $s->id)->pluck('number', 'id');
        $rows = [];
        foreach (PurchaseReceipt::where('supplier_id', $s->id)->get() as $r) {
            $rows[] = ['type' => 'receipt', 'id' => $r->id, 'at' => $r->received_at, 'cents' => self::raw($r->total), 'orderId' => $r->purchase_order_id,
                'orderNumber' => $numbers[$r->purchase_order_id] ?? '', 'method' => null, 'note' => $r->note, 'userName' => $r->user_name];
        }
        foreach (SupplierPayment::where('supplier_id', $s->id)->get() as $p) {
            $rows[] = ['type' => 'payment', 'id' => $p->id, 'at' => $p->paid_at, 'cents' => -self::raw($p->amount), 'orderId' => $p->purchase_order_id,
                'orderNumber' => $p->purchase_order_id ? ($numbers[$p->purchase_order_id] ?? '') : '', 'method' => $p->method, 'note' => $p->note, 'userName' => $p->user_name];
        }
        usort($rows, fn ($a, $b) => [$a['at'], $a['type'] === 'payment'] <=> [$b['at'], $b['type'] === 'payment']);
        $balance = 0;
        foreach ($rows as &$row) {
            $balance += $row['cents'];
            $row['amount'] = Money::out(Money::decimal($row['cents']));
            $row['balance'] = Money::out(Money::decimal($balance));
            unset($row['cents']);
        }
        unset($row);
        $waiting = PurchaseOrder::where('supplier_id', $s->id)->whereIn('status', self::WAITING)->count();

        return ['supplier' => Present::supplier($s, $balance, $waiting), 'rows' => array_reverse($rows), 'balance' => Money::out(Money::decimal($balance))];
    }

    /** @param array<string, mixed> $in {amount, method, note?, paidAt?, rate?, purchaseOrderId?} */
    public function pay(User $actor, string $supplierId, array $in): SupplierPayment
    {
        $this->need($actor, 'purchasing.pay');
        $s = Supplier::find($supplierId) ?? throw AppException::notFound();
        $cents = Money::cents($in['amount'] ?? 0, $s->currency);
        if ($cents <= 0) {
            throw new AppException('invalid_amount');
        }
        $method = (string) ($in['method'] ?? 'cash');
        if (! in_array($method, self::METHODS, true)) {
            throw new AppException('validation');
        }
        $orderId = $in['purchaseOrderId'] ?? null;
        if ($orderId && ! PurchaseOrder::where('id', $orderId)->where('supplier_id', $s->id)->exists()) {
            throw AppException::notFound();
        }
        $rate = $this->rate($s->currency, $in['rate'] ?? null);
        $p = SupplierPayment::create([
            'supplier_id' => $s->id, 'purchase_order_id' => $orderId, 'amount' => Money::decimal($cents), 'currency' => $s->currency, 'rate' => $rate,
            'amount_iqd' => Money::iqd($cents, $s->currency, $rate), 'method' => $method, 'note' => trim((string) ($in['note'] ?? '')),
            'paid_at' => (int) ($in['paidAt'] ?? Time::nowMs()), 'user_id' => $actor->id, 'user_name' => $actor->name,
        ]);
        $this->audit->log($actor, 'supplier.pay', 'supplier', $s->id, ['name' => $s->name, 'amount' => Money::out($p->amount), 'currency' => $s->currency, 'method' => $method]);

        return $p;
    }

    /** A payment entered by mistake. The activity log keeps what it was. */
    public function deletePayment(User $actor, string $paymentId): void
    {
        $this->need($actor, 'purchasing.pay');
        $p = SupplierPayment::find($paymentId) ?? throw AppException::notFound();
        $p->delete();
        $this->audit->log($actor, 'supplier.payment_delete', 'supplier', $p->supplier_id, ['amount' => Money::out($p->amount), 'currency' => $p->currency, 'paidAt' => $p->paid_at]);
    }

    /* ───────── orders ───────── */

    /** @param array{status?: string|null, supplierId?: string|null} $f  status: waiting | received | cancelled | all */
    public function orders(User $actor, array $f = []): array
    {
        $this->need($actor, 'purchasing.view');
        $status = $f['status'] ?? 'all';

        return PurchaseOrder::with(['supplier', 'items'])
            ->when($status === 'waiting', fn ($q) => $q->whereIn('status', self::WAITING))
            ->when($status === 'received', fn ($q) => $q->whereIn('status', ['received', 'closed']))
            ->when($status === 'cancelled', fn ($q) => $q->where('status', 'cancelled'))
            ->when(! empty($f['supplierId']), fn ($q) => $q->where('supplier_id', $f['supplierId']))
            ->orderByDesc('ordered_at')->limit(300)->get()
            ->map(fn (PurchaseOrder $o) => Present::purchaseOrder($o))->all();
    }

    /** @return array<string, mixed> the order with its lines and deliveries */
    public function order(User $actor, string $id): array
    {
        $this->need($actor, 'purchasing.view');
        $o = PurchaseOrder::with(['supplier', 'items', 'receipts.items'])->find($id) ?? throw AppException::notFound();

        return Present::purchaseOrder($o, true);
    }

    /** @param array<string, mixed> $in {supplierId, rate?, note?, expectedAt?, lines: [{variantId, qty, unitCost}], receiveNow?} */
    public function createOrder(User $actor, array $in): PurchaseOrder
    {
        $this->need($actor, 'purchasing.manage');
        $s = Supplier::find($in['supplierId'] ?? '') ?? throw AppException::notFound();
        if (! $s->active) {
            throw new AppException('supplier_inactive');
        }
        $lines = $this->lines($in['lines'] ?? [], $s->currency);
        $rate = $this->rate($s->currency, $in['rate'] ?? null);

        $o = DB::transaction(function () use ($actor, $in, $s, $lines, $rate) {
            $o = PurchaseOrder::create([
                'number' => 'PO-'.str_pad((string) $this->counters->next('purchase_order'), 6, '0', STR_PAD_LEFT),
                'supplier_id' => $s->id, 'status' => 'open', 'currency' => $s->currency, 'rate' => $rate,
                'total' => Money::decimal(array_sum(array_map(fn ($l) => $l['qty'] * $l['cents'], $lines))),
                'note' => trim((string) ($in['note'] ?? '')), 'ordered_at' => Time::nowMs(), 'expected_at' => $in['expectedAt'] ?? null,
                'created_by' => $actor->id, 'created_by_name' => $actor->name,
            ]);
            $this->writeLines($o, $lines);
            $this->audit->log($actor, 'purchase.order', 'purchase_order', $o->id, ['number' => $o->number, 'supplier' => $s->name, 'total' => Money::out($o->total), 'currency' => $o->currency]);
            if (! empty($in['receiveNow'])) {
                // the goods are already here: receive everything in the same step
                $all = $o->items()->get()->map(fn ($it) => ['itemId' => $it->id, 'qty' => $it->qty])->all();
                $this->receive($actor, $o->id, ['lines' => $all, 'note' => $in['note'] ?? '']);
            }

            return $o;
        });

        return $o->fresh(['supplier', 'items']);
    }

    /** Change an order that nothing has arrived for yet. */
    public function updateOrder(User $actor, string $id, array $in): PurchaseOrder
    {
        $this->need($actor, 'purchasing.manage');
        $o = PurchaseOrder::with('supplier')->find($id) ?? throw AppException::notFound();
        if ($o->status !== 'open' || self::raw($o->received_total) > 0) {
            throw new AppException('order_locked');
        }
        $lines = $this->lines($in['lines'] ?? [], $o->currency);
        DB::transaction(function () use ($actor, $o, $in, $lines) {
            $o->update([
                'rate' => $this->rate($o->currency, $in['rate'] ?? $o->rate), 'note' => trim((string) ($in['note'] ?? $o->note)),
                'expected_at' => array_key_exists('expectedAt', $in) ? $in['expectedAt'] : $o->expected_at,
                'total' => Money::decimal(array_sum(array_map(fn ($l) => $l['qty'] * $l['cents'], $lines))),
            ]);
            $o->items()->delete();
            $this->writeLines($o, $lines);
            $this->audit->log($actor, 'purchase.order_update', 'purchase_order', $o->id, ['number' => $o->number, 'total' => Money::out($o->total)]);
        });

        return $o->fresh(['supplier', 'items']);
    }

    /**
     * Goods arrived. Each line's quantity goes into the shop's stock, its size's cost price becomes what was paid (in
     * dinars at the rate), and the shop owes the supplier the delivery's value.
     *
     * @param array<string, mixed> $in {lines: [{itemId, qty, unitCost?}], rate?, note?}
     */
    public function receive(User $actor, string $id, array $in): PurchaseOrder
    {
        $this->need($actor, 'purchasing.manage');

        return DB::transaction(function () use ($actor, $id, $in) {
            $o = PurchaseOrder::whereKey($id)->lockForUpdate()->first() ?? throw AppException::notFound(); // no double receiving
            if (! in_array($o->status, self::WAITING, true)) {
                throw new AppException('order_locked');
            }
            $items = $o->items()->get()->keyBy('id');
            $rate = $this->rate($o->currency, $in['rate'] ?? $o->rate);
            $wanted = [];
            foreach ($in['lines'] ?? [] as $l) {
                $qty = (int) ($l['qty'] ?? 0);
                if ($qty <= 0) {
                    continue;
                }
                $item = $items[(int) ($l['itemId'] ?? 0)] ?? throw AppException::notFound();
                $already = $wanted[$item->id]['qty'] ?? 0;
                if ($item->received_qty + $already + $qty > $item->qty) {
                    throw new AppException('over_received', ['sku' => $item->sku, 'left' => $item->qty - $item->received_qty]);
                }
                $cents = array_key_exists('unitCost', $l) && $l['unitCost'] !== null ? Money::cents($l['unitCost'], $o->currency) : self::raw($item->unit_cost);
                if ($cents < 0) {
                    throw new AppException('invalid_amount');
                }
                $wanted[$item->id] = ['item' => $item, 'qty' => $already + $qty, 'cents' => $cents];
            }
            if (! $wanted) {
                throw new AppException('invalid_quantity');
            }

            $receipt = PurchaseReceipt::create([
                'purchase_order_id' => $o->id, 'supplier_id' => $o->supplier_id, 'currency' => $o->currency, 'rate' => $rate,
                'total' => '0', 'total_iqd' => 0, 'note' => trim((string) ($in['note'] ?? '')), 'received_at' => Time::nowMs(),
                'user_id' => $actor->id, 'user_name' => $actor->name,
            ]);
            $total = 0;
            foreach ($wanted as ['item' => $item, 'qty' => $qty, 'cents' => $cents]) {
                $costIqd = Money::iqd($cents, $o->currency, $rate);
                $receipt->items()->create(['order_item_id' => $item->id, 'variant_id' => $item->variant_id, 'qty' => $qty, 'unit_cost' => Money::decimal($cents), 'unit_cost_iqd' => $costIqd]);
                $item->update(['received_qty' => $item->received_qty + $qty]);
                $this->stock->applyMovement($item->variant_id, $qty, 'purchase', $actor, ['refType' => 'purchase_receipt', 'refId' => $receipt->id, 'note' => $o->number]);
                if ($costIqd > 0) {
                    Variant::whereKey($item->variant_id)->update(['cost_iqd' => $costIqd]); // the cost price is what was paid last
                }
                $total += $qty * $cents;
            }
            $receipt->update(['total' => Money::decimal($total), 'total_iqd' => Money::iqd($total, $o->currency, $rate)]);
            $done = $o->items()->get()->every(fn (PurchaseOrderItem $it) => $it->received_qty >= $it->qty);
            $o->update([
                'received_total' => Money::decimal(self::raw($o->received_total) + $total),
                'status' => $done ? 'received' : 'partial', 'closed_at' => $done ? Time::nowMs() : null,
            ]);
            $this->audit->log($actor, 'purchase.receive', 'purchase_order', $o->id, [
                'number' => $o->number, 'units' => array_sum(array_column($wanted, 'qty')), 'total' => Money::out(Money::decimal($total)), 'currency' => $o->currency,
            ]);

            return $o->fresh(['supplier', 'items', 'receipts.items']);
        });
    }

    /** Nothing arrived yet → cancelled. Part arrived → closed: the rest is not coming. */
    public function cancel(User $actor, string $id): PurchaseOrder
    {
        $this->need($actor, 'purchasing.manage');
        $o = PurchaseOrder::find($id) ?? throw AppException::notFound();
        $status = match ($o->status) {
            'open' => 'cancelled',
            'partial' => 'closed',
            default => throw new AppException('order_locked'),
        };
        $o->update(['status' => $status, 'closed_at' => Time::nowMs()]);
        $this->audit->log($actor, 'purchase.'.($status === 'cancelled' ? 'cancel' : 'close'), 'purchase_order', $o->id, ['number' => $o->number]);

        return $o->fresh(['supplier', 'items', 'receipts.items']);
    }

    /* ───────── helpers ───────── */

    /** What the shop owes each supplier, in cents of the supplier's currency. @return array<string, int> */
    public function balances(): array
    {
        $out = [];
        foreach (DB::table('purchase_receipts')->selectRaw('supplier_id, coalesce(sum(total), 0) as t')->groupBy('supplier_id')->get() as $r) {
            $out[$r->supplier_id] = self::raw($r->t);
        }
        foreach (DB::table('supplier_payments')->selectRaw('supplier_id, coalesce(sum(amount), 0) as t')->groupBy('supplier_id')->get() as $r) {
            $out[$r->supplier_id] = ($out[$r->supplier_id] ?? 0) - self::raw($r->t);
        }

        return $out;
    }

    /** A decimal column value in cents. */
    private static function raw(mixed $decimal): int
    {
        return (int) round(((float) $decimal) * 100);
    }

    /** The dollar rate to use: the one given for a dollar deal, else the shop's rate today. */
    private function rate(string $currency, mixed $given): int
    {
        $rate = $currency === 'USD' && $given !== null ? (int) $given : (int) $this->settings->get()['currency']['rate'];
        if ($rate < 1) {
            throw new AppException('validation');
        }

        return $rate;
    }

    /** @return array<int, array{variant: Variant, qty: int, cents: int}> */
    private function lines(array $lines, string $currency): array
    {
        if (! $lines) {
            throw new AppException('invalid_quantity');
        }
        $variants = Variant::with('product')->whereIn('id', array_column($lines, 'variantId'))->get()->keyBy('id');
        $out = [];
        foreach ($lines as $l) {
            $v = $variants[$l['variantId'] ?? ''] ?? throw AppException::notFound();
            $qty = (int) ($l['qty'] ?? 0);
            $cents = Money::cents($l['unitCost'] ?? 0, $currency);
            if ($qty < 1 || $cents < 0) {
                throw new AppException($qty < 1 ? 'invalid_quantity' : 'invalid_amount');
            }
            $out[] = ['variant' => $v, 'qty' => $qty, 'cents' => $cents];
        }

        return $out;
    }

    private function writeLines(PurchaseOrder $o, array $lines): void
    {
        foreach ($lines as $i => ['variant' => $v, 'qty' => $qty, 'cents' => $cents]) {
            $o->items()->create([
                'position' => $i, 'variant_id' => $v->id, 'product_id' => $v->product_id, 'name' => $v->product->name, 'label' => $v->label,
                'sku' => $v->sku, 'qty' => $qty, 'received_qty' => 0, 'unit_cost' => Money::decimal($cents),
            ]);
        }
    }

    private function hasHistory(string $supplierId): bool
    {
        return PurchaseOrder::where('supplier_id', $supplierId)->exists() || SupplierPayment::where('supplier_id', $supplierId)->exists();
    }
}
