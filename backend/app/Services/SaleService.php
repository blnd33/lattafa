<?php

namespace App\Services;

use App\Exceptions\AppException;
use App\Models\Customer;
use App\Models\Device;
use App\Models\Sale;
use App\Models\Shift;
use App\Models\User;
use App\Models\Variant;
use App\Support\Pricing;
use App\Support\Time;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Sales — checkout, void, history, and recording sales that were made offline on a till.
 *
 * `checkout` is one atomic DB transaction: stock, customer balance, loyalty points and the sale record all
 * commit together or not at all. Totals are recomputed here with {@see Pricing}, so the numbers stored are
 * never taken on trust from a client.
 *
 * `recordFromClient` accepts a sale a till already completed (possibly hours ago, offline). The customer has
 * already paid, so the sale is NEVER rejected for business reasons — instead anything odd (stock gone
 * negative, a price that changed, a credit limit exceeded…) is stored as a *flag* for an admin to review.
 */
class SaleService
{
    private const CASH = ['cash_iqd', 'cash_usd'];

    public function __construct(
        private StockService $stock,
        private SettingsService $settings,
        private AuditService $audit,
        private Counters $counters,
        private ShiftService $shifts,
    ) {}

    /* ───────────────────────── online checkout ───────────────────────── */

    /**
     * @param array{
     *   id?: string, lines: array<int, array{variantId: string, qty: int, discountPct?: int}>, customerId?: string|null,
     *   orderDiscount?: array{type: string, value: int|float}|null, giftWrap?: bool, redeemPoints?: int,
     *   payments: array<int, array{method: string, tendered: int|float, reference?: string}>, note?: string,
     *   approvedBy?: array{id: string}|null, returnCreditIQD?: int
     * } $in
     */
    public function checkout(User $actor, array $in, ?Device $device): Sale
    {
        if (! $actor->can('pos.sell')) {
            throw AppException::forbidden('pos.sell');
        }
        if (empty($in['lines'])) {
            throw new AppException('cart_empty');
        }
        $cfg = $this->settings->get();
        $shift = $this->shifts->openFor($actor->id);
        if ($cfg['sales']['requireShift'] && ! $shift) {
            throw new AppException('shift_required');
        }

        return DB::transaction(function () use ($actor, $in, $device, $cfg, $shift) {
            if (! empty($in['id']) && ($dup = Sale::with(['items', 'payments'])->find($in['id']))) {
                return $dup; // a retry of a checkout that already succeeded
            }

            /* 1. resolve lines */
            $items = [];
            $pricingLines = [];
            $wantsLineDiscount = false;
            foreach (array_values($in['lines']) as $i => $l) {
                $qty = (int) ($l['qty'] ?? 0);
                $pct = (int) ($l['discountPct'] ?? 0);
                if ($qty <= 0) {
                    throw new AppException('invalid_quantity');
                }
                if ($pct < 0 || $pct > 100) {
                    throw new AppException('invalid_discount');
                }
                $wantsLineDiscount = $wantsLineDiscount || $pct > 0;
                $v = Variant::with('product')->find($l['variantId']);
                if (! $v || ! $v->active || ! $v->product->active) {
                    throw new AppException('product_unavailable');
                }
                $pricingLines[] = ['key' => (string) $i, 'unitPriceIQD' => $v->retail_iqd, 'qty' => $qty, 'discountPct' => $pct];
                $items[] = ['variant' => $v, 'qty' => $qty, 'pct' => $pct];
            }

            /* 2. discount permissions */
            if ($wantsLineDiscount && ! $actor->can('sales.discount.item')) {
                throw AppException::forbidden('sales.discount.item');
            }
            $orderDiscount = $in['orderDiscount'] ?? null;
            if ($orderDiscount && ($orderDiscount['value'] ?? 0) > 0 && ! $actor->can('sales.discount.order')) {
                throw AppException::forbidden('sales.discount.order');
            }

            /* 3. customer + points */
            $customer = ! empty($in['customerId']) ? (Customer::lockForUpdate()->find($in['customerId']) ?? throw AppException::notFound()) : null;
            $redeem = max(0, (int) ($in['redeemPoints'] ?? 0));
            if ($redeem > 0) {
                if (! $cfg['loyalty']['enabled'] || ! $customer) {
                    throw new AppException('loyalty_unavailable');
                }
                if ($redeem > $customer->points) {
                    throw new AppException('not_enough_points', ['points' => $customer->points]);
                }
            }
            $pointValue = (int) $cfg['loyalty']['pointValueIQD'];

            /* 4. price it (authoritative) */
            $priced = Pricing::priceCart([
                'lines' => $pricingLines,
                'orderDiscount' => $orderDiscount,
                'pointsRedeemedIQD' => $redeem * $pointValue,
                'giftWrapIQD' => ! empty($in['giftWrap']) ? (int) $cfg['sales']['giftWrapFeeIQD'] : 0,
                'taxPct' => $cfg['tax']['pct'],
                'rounding' => (int) $cfg['currency']['rounding'],
            ]);
            if ($pointValue > 0 && $priced['pointsRedeemed'] < $redeem * $pointValue) {
                $redeem = (int) ceil($priced['pointsRedeemed'] / $pointValue);
            }

            /* 5. over-limit discount needs a supervisor */
            $approver = null;
            if ($priced['effectiveDiscountPct'] > $actor->max_discount_pct + 1e-9 && ! $actor->can('sales.discount.above_limit')) {
                if (empty($in['approvedBy']['id'])) {
                    throw new AppException('approval_required', ['permission' => 'sales.discount.above_limit'], 403);
                }
                $approver = $this->verifyApprover($in['approvedBy']['id'], 'sales.discount.above_limit');
            }

            /* 6. payments */
            $total = $priced['total'];
            $rate = (int) $cfg['currency']['rate'];
            [$payments, $change, $debt] = $this->allocatePayments($in['payments'] ?? [], $total, $rate, (bool) $cfg['currency']['usdEnabled'], (int) ($in['returnCreditIQD'] ?? 0));
            if ($debt > 0) {
                if (! $customer) {
                    throw new AppException('customer_required_for_debt');
                }
                if (! $actor->can('customers.credit')) {
                    throw AppException::forbidden('customers.credit');
                }
                if ($customer->balance_iqd + $debt > $customer->credit_limit_iqd) {
                    throw new AppException('credit_limit_exceeded', ['limit' => $customer->credit_limit_iqd, 'balance' => $customer->balance_iqd]);
                }
            }

            /* 7. persist (stock → customer → sale) */
            $saleItems = [];
            foreach ($items as $i => $it) {
                $pl = $priced['lines'][$i];
                $v = $it['variant'];
                $saleItems[] = [
                    'variant_id' => $v->id, 'product_id' => $v->product_id, 'name' => $v->product->name, 'brand' => $v->product->brand, 'label' => $v->label,
                    'sku' => $v->sku, 'barcode' => $v->barcode, 'qty' => $it['qty'], 'unit_price_iqd' => $v->retail_iqd, 'unit_cost_iqd' => $v->cost_iqd,
                    'discount_pct' => $it['pct'], 'discount_iqd' => $pl['discount'], 'line_total_iqd' => $pl['net'],
                ];
            }
            $earned = $customer && $cfg['loyalty']['enabled'] ? Pricing::pointsEarned($total, $cfg['loyalty']['pointsPer1000IQD']) : 0;

            $totals = [
                'subtotal_iqd' => $priced['subtotal'], 'item_discount_iqd' => $priced['itemDiscount'], 'order_discount_iqd' => $priced['orderDiscount'],
                'order_discount' => $orderDiscount && ($orderDiscount['value'] ?? 0) > 0 ? $orderDiscount : null, 'gift_wrap_iqd' => $priced['giftWrap'],
                'tax_iqd' => $priced['tax'], 'rounding_iqd' => $priced['rounding'], 'points_redeemed_iqd' => $priced['pointsRedeemed'], 'total_iqd' => $total,
            ];
            $sale = $this->persist($actor, [
                'id' => $in['id'] ?? (string) Str::uuid7(),
                'number' => $in['number'] ?? $this->nextNumber('sale', $device),
                'shift_id' => $shift?->id, 'customer' => $customer, 'items' => $saleItems, 'payments' => $payments, 'change' => $change, 'due' => $debt,
                'points_earned' => $earned, 'points_redeemed' => $redeem, 'rate' => $rate, 'note' => trim($in['note'] ?? ''),
                'approved_by' => $approver?->id, 'device_id' => $device?->id, 'sold_at' => Time::nowMs(), 'totals' => $totals, 'flags' => [],
            ], allowNegativeStock: (bool) $cfg['sales']['allowNegativeStock'], flags: $flags);

            return $sale;
        });
    }

    /**
     * Splits what the customer handed over across payment methods and works out change and debt.
     * Order: return credit → card/wallets → debt → cash IQD → cash USD (cash last so it absorbs the change).
     *
     * @param array<int, array{method: string, tendered: int|float, reference?: string}> $given
     * @return array{0: array<int, array<string, mixed>>, 1: int, 2: int} [payments, change, debt]
     */
    private function allocatePayments(array $given, int $total, int $rate, bool $usdEnabled, int $returnCredit): array
    {
        $order = ['return_credit', 'card', 'fib', 'zain', 'debt', 'cash_iqd', 'cash_usd'];
        $given = array_values(array_filter($given, fn ($p) => ($p['tendered'] ?? 0) > 0));
        usort($given, fn ($a, $b) => array_search($a['method'], $order, true) <=> array_search($b['method'], $order, true));

        $remaining = $total;
        $payments = [];
        $debt = $cashValue = $cashApplied = 0;
        foreach ($given as $p) {
            $method = $p['method'];
            if (! in_array($method, $order, true)) {
                throw new AppException('invalid_amount');
            }
            if ($method === 'cash_usd' && ! $usdEnabled) {
                throw new AppException('usd_disabled');
            }
            $isUsd = $method === 'cash_usd';
            $value = $isUsd ? Pricing::round($p['tendered'] * $rate) : Pricing::round($p['tendered']);
            if ($method === 'return_credit' && $value > $returnCredit) {
                throw new AppException('invalid_amount');
            }
            if (in_array($method, self::CASH, true)) {
                $applied = min($value, max(0, $remaining));
                $cashValue += $value;
                $cashApplied += $applied;
                $remaining -= $applied;
                $payments[] = ['method' => $method, 'amount_iqd' => $applied, 'tendered' => $p['tendered'], 'currency' => $isUsd ? 'USD' : 'IQD', 'rate' => $rate, 'reference' => $p['reference'] ?? ''];
            } else {
                if ($value > $remaining) {
                    throw new AppException('overpayment_non_cash');
                }
                $remaining -= $value;
                if ($method === 'debt') {
                    $debt += $value;
                }
                $payments[] = ['method' => $method, 'amount_iqd' => $value, 'tendered' => $p['tendered'], 'currency' => 'IQD', 'rate' => $rate, 'reference' => $p['reference'] ?? ''];
            }
        }
        if ($remaining > 0) {
            throw new AppException('underpayment', ['remaining' => $remaining]);
        }
        $change = $cashValue - $cashApplied;
        if ($change > 0 && $cashApplied === 0) {
            throw new AppException('overpayment_non_cash');
        }

        return [$payments, $change, $debt];
    }

    /**
     * Writes a fully-resolved sale: stock movements, customer balance/points, sale rows, audit.
     *
     * @param array<string, mixed> $d
     * @param array<int, string> $flags collected review flags (by reference, for sync)
     */
    private function persist(User $actor, array $d, bool $allowNegativeStock, ?array &$flags = null): Sale
    {
        $flags ??= [];
        foreach ($d['items'] as $it) {
            $mv = $this->stock->applyMovement($it['variant_id'], -$it['qty'], 'sale', $actor, [
                'refType' => 'sale', 'refId' => $d['id'], 'allowNegative' => $allowNegativeStock, 'deviceId' => $d['device_id'], 'occurredAt' => $d['sold_at'],
                'locationId' => $d['location_id'] ?? StockService::LOCATION,
            ]);
            if ($mv->balance_after < 0 && ! in_array('negative_stock', $flags, true)) {
                $flags[] = 'negative_stock';
            }
        }
        /** @var Customer|null $customer */
        $customer = $d['customer'];
        if ($customer) {
            $customer->update([
                'balance_iqd' => $customer->balance_iqd + $d['due'],
                'points' => max(0, $customer->points - $d['points_redeemed'] + $d['points_earned']),
            ]);
            if ($customer->balance_iqd > $customer->credit_limit_iqd && $d['due'] > 0 && ! in_array('credit_limit_exceeded', $flags, true)) {
                $flags[] = 'credit_limit_exceeded';
            }
        }
        $paid = collect($d['payments'])->where('method', '!=', 'debt')->sum('amount_iqd');
        $sale = Sale::create($d['totals'] + [
            'id' => $d['id'], 'number' => $d['number'], 'shift_id' => $d['shift_id'], 'user_id' => $actor->id, 'user_name' => $actor->name,
            'customer_id' => $customer?->id, 'customer_name' => $customer?->name ?? '', 'channel' => $d['channel'] ?? 'store', 'location_id' => $d['location_id'] ?? StockService::LOCATION, 'status' => 'completed',
            'paid_iqd' => $paid, 'change_iqd' => $d['change'], 'due_iqd' => $d['due'], 'points_earned' => $d['points_earned'], 'points_redeemed' => $d['points_redeemed'],
            'exchange_rate' => $d['rate'], 'note' => $d['note'], 'approved_by' => $d['approved_by'], 'device_id' => $d['device_id'],
            'flags' => $flags, 'needs_review' => count($flags) > 0, 'sold_at' => $d['sold_at'],
            'currency' => $d['currency'] ?? 'IQD', 'lat' => $d['lat'] ?? null, 'lng' => $d['lng'] ?? null, 'accuracy_m' => $d['accuracy_m'] ?? null,
        ]);
        foreach ($d['items'] as $pos => $it) {
            $sale->items()->create($it + ['position' => $pos]);
        }
        foreach ($d['payments'] as $p) {
            $sale->payments()->create($p);
        }
        $this->audit->log($actor, 'sale.create', 'sale', $sale->id, ['number' => $sale->number, 'total' => $sale->total_iqd, 'items' => count($d['items']), 'approvedBy' => $d['approved_by'], 'flags' => $flags], $d['device_id'], $d['sold_at']);

        return $sale->load(['items', 'payments']);
    }

    /* ───────────────────────── offline sales pushed by a till ───────────────────────── */

    /**
     * Records a sale a till completed offline. Idempotent on the client-generated UUID.
     *
     * @param array<string, mixed> $s the till's Sale JSON (camelCase, exactly as stored in its IndexedDB)
     * @return array{status: string, flags: string[]}  status: ok | duplicate
     */
    public function recordFromClient(User $tokenUser, array $s, ?Device $device): array
    {
        return DB::transaction(function () use ($tokenUser, $s, $device) {
            $existing = Sale::find($s['id'] ?? '');
            if ($existing) {
                // the only change a till may make to an already-synced sale is voiding it
                if (($s['status'] ?? '') === 'voided' && $existing->status === 'completed') {
                    $by = User::find($s['userId'] ?? '') ?? $tokenUser;
                    $this->applyVoid($existing, (string) ($s['voidReason'] ?? ''), $by, $s['approvedBy'] ?? null, $s['voidedAt'] ?? null);

                    return ['status' => 'ok', 'flags' => []];
                }

                return ['status' => 'duplicate', 'flags' => []];
            }
            if (Sale::where('number', $s['number'] ?? '')->exists()) {
                throw new AppException('number_taken', ['number' => $s['number'] ?? ''], 409);
            }
            if (empty($s['items']) || ! is_array($s['items'])) {
                throw new AppException('cart_empty');
            }

            $cfg = $this->settings->get();
            $actor = User::with('role')->find($s['userId'] ?? '') ?? $tokenUser;
            $flags = [];
            if ($actor->id !== ($s['userId'] ?? null)) {
                $flags[] = 'unknown_cashier';
            }
            // a delegate sells the shop's own stock (never trust a location sent by the phone)
            $delegate = ($s['channel'] ?? 'store') === 'delegate';
            $rate = (int) ($s['exchangeRate'] ?? $cfg['currency']['rate']);
            if ($delegate && ! $actor->can('delegate.sell')) {
                $flags[] = 'not_a_delegate';
            }
            $customer = ! empty($s['customerId']) ? Customer::lockForUpdate()->find($s['customerId']) : null;
            if (! empty($s['customerId']) && ! $customer) {
                $flags[] = 'customer_missing';
            }
            $shiftId = ! empty($s['shiftId']) && Shift::whereKey($s['shiftId'])->exists() ? $s['shiftId'] : null;
            if (! empty($s['shiftId']) && ! $shiftId) {
                $flags[] = 'shift_missing';
            }

            $items = [];
            $lines = [];
            foreach (array_values($s['items']) as $i => $it) {
                $v = Variant::with('product')->find($it['variantId'] ?? '');
                if (! $v) {
                    throw new AppException('product_unavailable', ['variantId' => (string) ($it['variantId'] ?? '')]);
                }
                // a delegate's dollar bill uses the shop's dollar price list for that size when it has one, else the
                // dinar price at the bill's rate rounded to 50 cents (see usdListPrice)
                $listPrices = $delegate
                    ? array_filter([$v->retail_iqd, $v->wholesale_iqd, self::usdListPrice($v->retail_iqd, $rate), self::usdListPrice($v->wholesale_iqd, $rate), self::usdPrice($v->wholesale_usd_cents, $rate)])
                    : [$v->retail_iqd];
                if (! in_array((int) $it['unitPriceIQD'], $listPrices, true) && ! in_array('price_mismatch', $flags, true)) {
                    $flags[] = 'price_mismatch';
                }
                $lines[] = ['key' => (string) $i, 'unitPriceIQD' => (int) $it['unitPriceIQD'], 'qty' => (int) $it['qty'], 'discountPct' => (int) ($it['discountPct'] ?? 0)];
                $items[] = [
                    'variant_id' => $v->id, 'product_id' => $v->product_id, 'name' => $it['name'] ?? $v->product->name, 'brand' => $it['brand'] ?? $v->product->brand,
                    'label' => $it['label'] ?? $v->label, 'sku' => $it['sku'] ?? $v->sku, 'barcode' => $it['barcode'] ?? $v->barcode, 'qty' => (int) $it['qty'],
                    // cost is server-owned: a till without cost access never sends it
                    'unit_price_iqd' => (int) $it['unitPriceIQD'], 'unit_cost_iqd' => $v->cost_iqd, 'discount_pct' => (int) ($it['discountPct'] ?? 0),
                    'discount_iqd' => (int) ($it['discountIQD'] ?? 0), 'line_total_iqd' => (int) ($it['lineTotalIQD'] ?? 0),
                ];
            }
            // Arithmetic check: does the till's total follow from its own line prices and discounts?
            $priced = Pricing::priceCart(['lines' => $lines, 'orderDiscount' => $s['orderDiscount'] ?? null, 'pointsRedeemedIQD' => (int) ($s['pointsRedeemedIQD'] ?? 0)]);
            $expected = $priced['subtotal'] - $priced['itemDiscount'] - $priced['orderDiscount'] - $priced['pointsRedeemed'] + (int) ($s['taxIQD'] ?? 0) + (int) ($s['giftWrapIQD'] ?? 0) + (int) ($s['roundingIQD'] ?? 0);
            if ($expected !== (int) $s['totalIQD']) {
                $flags[] = 'total_mismatch';
            }
            $payments = [];
            foreach (($s['payments'] ?? []) as $p) {
                $payments[] = ['method' => $p['method'], 'amount_iqd' => (int) $p['amountIQD'], 'tendered' => $p['tendered'], 'currency' => $p['currency'] ?? 'IQD', 'rate' => (int) ($p['rate'] ?? $s['exchangeRate'] ?? 0), 'reference' => $p['reference'] ?? ''];
            }
            $paidSum = collect($payments)->sum('amount_iqd');
            if ($paidSum !== (int) $s['totalIQD']) {
                $flags[] = 'payment_mismatch';
            }
            if ($priced['effectiveDiscountPct'] > $actor->max_discount_pct + 1e-9 && empty($s['approvedBy']) && ! $actor->can('sales.discount.above_limit')) {
                $flags[] = 'discount_over_limit';
            }

            $totals = [
                'subtotal_iqd' => (int) $s['subtotalIQD'], 'item_discount_iqd' => (int) $s['itemDiscountIQD'], 'order_discount_iqd' => (int) $s['orderDiscountIQD'],
                'order_discount' => $s['orderDiscount'] ?? null, 'gift_wrap_iqd' => (int) $s['giftWrapIQD'], 'tax_iqd' => (int) $s['taxIQD'],
                'rounding_iqd' => (int) $s['roundingIQD'], 'points_redeemed_iqd' => (int) $s['pointsRedeemedIQD'], 'total_iqd' => (int) $s['totalIQD'],
            ];
            $sale = $this->persist($actor, [
                'id' => $s['id'], 'number' => $s['number'], 'shift_id' => $shiftId, 'customer' => $customer, 'items' => $items, 'payments' => $payments,
                'change' => (int) ($s['changeIQD'] ?? 0), 'due' => (int) ($s['dueIQD'] ?? 0), 'points_earned' => (int) ($s['pointsEarned'] ?? 0),
                'points_redeemed' => (int) ($s['pointsRedeemed'] ?? 0), 'rate' => (int) ($s['exchangeRate'] ?? $cfg['currency']['rate']), 'note' => (string) ($s['note'] ?? ''),
                'approved_by' => is_string($s['approvedBy'] ?? null) ? $s['approvedBy'] : null, 'device_id' => $device?->id ?? ($s['deviceId'] ?? null),
                'sold_at' => (int) ($s['createdAt'] ?? Time::nowMs()), 'totals' => $totals,
                'channel' => $delegate ? 'delegate' : 'store', 'location_id' => StockService::LOCATION,
                'currency' => ($s['currency'] ?? 'IQD') === 'USD' ? 'USD' : 'IQD', ...self::place($s),
            ], allowNegativeStock: true, flags: $flags);

            // a sale that was already voided on the till when it first synced
            if (($s['status'] ?? 'completed') === 'voided') {
                $this->applyVoid($sale, (string) ($s['voidReason'] ?? ''), $actor, null, $s['voidedAt'] ?? null);
            }

            return ['status' => 'ok', 'flags' => $flags];
        });
    }

    /**
     * A list price in dollars, as the delegate app shows it: to the nearest 50 cents (never below 50 cents), back in
     * dinars at the bill's rate — so "$24.50" on the phone is exactly what the bill says. Same sum as `usdListPrice` there.
     */
    /** A size's own dollar price (cents from the shop's price list) in dinars at the bill's rate; 0 when it has none. */
    public static function usdPrice(int $cents, int $rate): int
    {
        return $cents > 0 && $rate > 0 ? (int) round($cents / 100 * $rate) : 0;
    }

    public static function usdListPrice(int $iqd, int $rate): int
    {
        if ($iqd <= 0 || $rate <= 0) {
            return $iqd;
        }
        $usd = max(0.5, round($iqd / $rate * 2) / 2);

        return (int) round($usd * $rate);
    }

    /** Where the phone was when the bill was finished — kept only when it looks like a real GPS reading. */
    private static function place(array $s): array
    {
        $lat = $s['lat'] ?? null;
        $lng = $s['lng'] ?? null;
        if (! is_numeric($lat) || ! is_numeric($lng) || abs((float) $lat) > 90 || abs((float) $lng) > 180 || ((float) $lat === 0.0 && (float) $lng === 0.0)) {
            return [];
        }
        $acc = $s['accuracyM'] ?? null;

        return ['lat' => round((float) $lat, 7), 'lng' => round((float) $lng, 7), 'accuracy_m' => is_numeric($acc) && $acc >= 0 ? min(100_000, (int) round((float) $acc)) : null];
    }

    /* ───────────────────────── void ───────────────────────── */

    /** Cancel a sale entirely: stock comes back, debt/points are reversed. */
    public function void(User $actor, string $saleId, string $reason, ?string $approvedById): Sale
    {
        $approver = null;
        if (! $actor->can('sales.void')) {
            if (! $approvedById) {
                throw new AppException('approval_required', ['permission' => 'sales.void'], 403);
            }
            $approver = $this->verifyApprover($approvedById, 'sales.void');
        }
        if (trim($reason) === '') {
            throw new AppException('required_fields');
        }

        return DB::transaction(function () use ($actor, $saleId, $reason, $approver) {
            $sale = Sale::lockForUpdate()->find($saleId) ?? throw AppException::notFound();
            if ($sale->status !== 'completed') {
                throw new AppException('sale_not_voidable');
            }
            $shift = $sale->shift_id ? Shift::find($sale->shift_id) : null;
            if ($shift?->status === 'closed' && ! $actor->can('sales.view_all')) {
                throw new AppException('shift_closed');
            }

            return $this->applyVoid($sale, trim($reason), $actor, $approver?->id);
        });
    }

    private function applyVoid(Sale $sale, string $reason, User $by, mixed $approver, ?int $at = null): Sale
    {
        foreach ($sale->items as $it) {
            $this->stock->applyMovement($it->variant_id, $it->qty, 'void', $by, ['refType' => 'sale', 'refId' => $sale->id, 'note' => $reason, 'allowNegative' => true, 'locationId' => $sale->location_id ?: StockService::LOCATION]);
        }
        if ($sale->customer_id && ($c = Customer::lockForUpdate()->find($sale->customer_id))) {
            $c->update(['balance_iqd' => max(0, $c->balance_iqd - $sale->due_iqd), 'points' => max(0, $c->points + $sale->points_redeemed - $sale->points_earned)]);
        }
        $sale->update(['status' => 'voided', 'voided_at' => $at ?? Time::nowMs(), 'void_reason' => $reason]);
        $this->audit->log($by, 'sale.void', 'sale', $sale->id, ['number' => $sale->number, 'reason' => $reason, 'approvedBy' => is_string($approver) ? $approver : null], null, $at);

        return $sale->fresh(['items', 'payments']);
    }

    /**
     * Correcting a cashier's slip — Super Admin only.
     *
     * The bill is cancelled and written again with the corrected quantities and prices, which is how the stock, the
     * customer's balance, their points and the day's takings all end up right: both halves run through the same
     * cancel and sell paths the till uses, inside one transaction, so nothing can be left half-done. The old bill
     * stays, cancelled and pointing at the new one, so the trail is intact.
     *
     * The money is not moved: this is for a bill rung up wrong, where the customer handed over the right amount.
     * The corrected bill is recorded as paid by the same methods, and a sale on account owes the corrected sum.
     *
     * @param array<int, array{index: int, qty: int, unitPriceIQD?: int}> $lines  by position in the original
     */
    public function correct(User $actor, string $saleId, array $lines, string $reason, ?Device $device): Sale
    {
        if (! $actor->isSuperAdmin()) {
            throw AppException::forbidden('sales.correct');
        }
        if (trim($reason) === '') {
            throw new AppException('required_fields');
        }
        $cfg = $this->settings->get();

        return DB::transaction(function () use ($actor, $saleId, $lines, $reason, $device, $cfg) {
            $old = Sale::with(['items', 'payments'])->lockForUpdate()->find($saleId) ?? throw AppException::notFound();
            if ($old->status !== 'completed') {
                // a bill with goods already given back, or already cancelled, is not a simple slip of the keyboard
                throw new AppException('sale_not_correctable');
            }
            $byIndex = [];
            foreach ($lines as $l) {
                $byIndex[(int) ($l['index'] ?? -1)] = $l;
            }
            $items = [];
            foreach ($old->items->values() as $i => $it) {
                $l = $byIndex[$i] ?? ['qty' => $it->qty];
                $qty = max(0, (int) ($l['qty'] ?? 0));
                if ($qty === 0) {
                    continue; // the line comes off the bill
                }
                $unit = isset($l['unitPriceIQD']) ? max(0, (int) $l['unitPriceIQD']) : $it->unit_price_iqd;
                $items[] = ['item' => $it, 'qty' => $qty, 'unit' => $unit, 'pct' => $it->discount_pct];
            }
            if (! $items) {
                throw new AppException('cart_empty');
            }

            $priced = Pricing::priceCart([
                'lines' => array_map(fn ($x, $i) => ['key' => (string) $i, 'unitPriceIQD' => $x['unit'], 'qty' => $x['qty'], 'discountPct' => $x['pct']], $items, array_keys($items)),
                'orderDiscount' => $old->order_discount,
                'giftWrapIQD' => $old->gift_wrap_iqd,
                'rounding' => $cfg['currency']['rounding'],
                'taxPct' => 0,
            ]);
            $total = $priced['total'];

            $saleItems = [];
            foreach ($items as $i => $x) {
                $pl = $priced['lines'][$i];
                $it = $x['item'];
                $saleItems[] = [
                    'variant_id' => $it->variant_id, 'product_id' => $it->product_id, 'name' => $it->name, 'brand' => $it->brand, 'label' => $it->label,
                    'sku' => $it->sku, 'barcode' => $it->barcode, 'qty' => $x['qty'], 'unit_price_iqd' => $x['unit'], 'unit_cost_iqd' => $it->unit_cost_iqd,
                    'discount_pct' => $x['pct'], 'discount_iqd' => $pl['discount'], 'line_total_iqd' => $pl['net'],
                ];
            }

            // paid the same way as before, for the corrected sum (the till took the right money at the counter)
            $wasOnAccount = $old->due_iqd > 0;
            $method = $old->payments->first(fn ($p) => $p->method !== 'debt')?->method ?? 'cash_iqd';
            $payments = $wasOnAccount
                ? [['method' => 'debt', 'tendered' => $total, 'amount_iqd' => $total, 'currency' => 'IQD', 'rate' => $old->exchange_rate, 'reference' => '']]
                : [['method' => $method, 'tendered' => $total, 'amount_iqd' => $total, 'currency' => 'IQD', 'rate' => $old->exchange_rate, 'reference' => '']];

            $customer = $old->customer_id ? Customer::lockForUpdate()->find($old->customer_id) : null;
            $earned = $customer && $cfg['loyalty']['enabled'] ? Pricing::pointsEarned($total, $cfg['loyalty']['pointsPer1000IQD']) : 0;

            // 1. undo the old bill in full (stock back, balance and points reversed)
            $this->applyVoid($old, $reason, $actor, null);
            $old->update(['void_reason' => $reason]);

            // 2. write it again, corrected
            $fresh = $this->persist($actor, [
                'id' => (string) Str::uuid7(),
                'number' => $this->nextNumber('sale', $device),
                'shift_id' => $old->shift_id, 'customer' => $customer, 'items' => $saleItems, 'payments' => $payments,
                'change' => 0, 'due' => $wasOnAccount ? $total : 0,
                'points_earned' => $earned, 'points_redeemed' => 0, 'rate' => $old->exchange_rate,
                'note' => trim($old->note), 'approved_by' => null, 'device_id' => $device?->id, 'sold_at' => $old->sold_at,
                'totals' => [
                    'subtotal_iqd' => $priced['subtotal'], 'item_discount_iqd' => $priced['itemDiscount'], 'order_discount_iqd' => $priced['orderDiscount'],
                    'order_discount' => $old->order_discount, 'gift_wrap_iqd' => $priced['giftWrap'], 'tax_iqd' => $priced['tax'],
                    'rounding_iqd' => $priced['rounding'], 'points_redeemed_iqd' => 0, 'total_iqd' => $total,
                ],
                'flags' => [],
            ], allowNegativeStock: true);

            $fresh->update(['corrects_sale_id' => $old->id, 'channel' => $old->channel]);
            $old->update(['corrected_by_sale_id' => $fresh->id]);
            $this->audit->log($actor, 'sale.correct', 'sale', $fresh->id, [
                'was' => $old->number, 'now' => $fresh->number, 'from' => $old->total_iqd, 'to' => $total, 'reason' => $reason,
            ], $device?->id);

            return $fresh->fresh(['items', 'payments']);
        });
    }

    /** The approver must be an active user who really holds the permission (never trust the client's word). */
    public function verifyApprover(string $userId, string $permission): User
    {
        $u = User::with('role')->find($userId);
        if (! $u || ! $u->active || ! $u->can($permission)) {
            throw new AppException('approval_invalid', [], 403);
        }

        return $u;
    }

    /* ───────────────────────── reading ───────────────────────── */

    /** @param array{from?: int, to?: int, userId?: string, status?: string, q?: string, limit?: int} $f */
    public function list(User $actor, array $f = [])
    {
        $all = $actor->can('sales.view_all');
        if (! $all && ! $actor->can('sales.view_own')) {
            throw AppException::forbidden('sales.view_own');
        }
        $q = Sale::with(['items', 'payments'])
            ->when(! $all, fn ($q) => $q->where('user_id', $actor->id))
            ->when($all && ! empty($f['userId']), fn ($q) => $q->where('user_id', $f['userId']))
            ->when(! empty($f['from']), fn ($q) => $q->where('sold_at', '>=', $f['from']))
            ->when(! empty($f['to']), fn ($q) => $q->where('sold_at', '<=', $f['to']))
            ->when(! empty($f['status']), fn ($q) => $q->where('status', $f['status']))
            ->when(! empty($f['q']), function ($q) use ($f) {
                $s = trim($f['q']);
                $q->where(fn ($w) => $w->whereLike('number', '%'.$s.'%')->orWhereLike('customer_name', '%'.$s.'%')
                    ->orWhereHas('items', fn ($i) => $i->where('barcode', $s)->orWhere('sku', $s)));
            });

        return $q->orderByDesc('sold_at')->limit(min((int) ($f['limit'] ?? 500), 2000))->get();
    }

    public function find(User $actor, string $idOrNumber): Sale
    {
        // ids are uuid columns (PostgreSQL errors on a non-uuid comparison), so only match by id when it looks like one
        $sale = Sale::with(['items', 'payments'])
            ->where(fn ($q) => Str::isUuid($idOrNumber) ? $q->where('id', $idOrNumber) : $q->where('number', Str::upper($idOrNumber)))
            ->first() ?? throw AppException::notFound();
        if ($sale->user_id !== $actor->id && ! $actor->can('sales.view_all')) {
            throw AppException::forbidden('sales.view_all');
        }

        return $sale;
    }

    /** Sales that need an admin's eye (negative stock, price/total mismatches, credit limit…). */
    public function needingReview(User $actor)
    {
        if (! $actor->can('sales.view_all')) {
            throw AppException::forbidden('sales.view_all');
        }

        return Sale::with(['items', 'payments'])->where('needs_review', true)->orderByDesc('sold_at')->limit(300)->get();
    }

    /** "I've looked at it": the sale leaves the to-check list; its flags stay, with who checked it, when and why. */
    public function markReviewed(User $actor, string $id, string $note = ''): Sale
    {
        if (! $actor->can('sales.view_all')) {
            throw AppException::forbidden('sales.view_all');
        }
        $sale = Sale::with(['items', 'payments'])->find($id) ?? throw AppException::notFound();
        if (! $sale->needs_review) {
            return $sale; // already checked (by someone else, or a second click)
        }
        $sale->update(['needs_review' => false, 'reviewed_at' => Time::nowMs(), 'reviewed_by' => $actor->id, 'review_note' => trim($note)]);
        $this->audit->log($actor, 'sale.reviewed', 'sale', $sale->id, ['number' => $sale->number, 'flags' => $sale->flags ?? [], 'note' => trim($note)]);

        return $sale;
    }

    public function nextNumber(string $kind, ?Device $device): string
    {
        $code = $device?->code ?? 'WEB';
        $format = fn (int $seq) => $kind === 'return'
            ? $code.'-R'.str_pad((string) $seq, 5, '0', STR_PAD_LEFT)
            : $code.'-'.str_pad((string) $seq, 6, '0', STR_PAD_LEFT);
        // tills number their own receipts offline with the same prefix — skip any number already taken
        $model = $kind === 'return' ? \App\Models\SaleReturn::class : Sale::class;
        do {
            $number = $format($this->counters->next($kind.':'.$code));
        } while ($model::where('number', $number)->exists());

        return $number;
    }
}
