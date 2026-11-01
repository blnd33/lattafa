<?php

namespace App\Services;

use App\Exceptions\AppException;
use App\Models\Customer;
use App\Models\Device;
use App\Models\Sale;
use App\Models\SaleReturn;
use App\Models\User;
use App\Support\Pricing;
use App\Support\Time;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Returns & exchanges.
 *
 * Refund value per unit = the line's net price (after its discount) scaled by how much of the *whole bill*
 * discount/points/rounding applied, so a customer is never refunded more than they paid for that item.
 */
class ReturnService
{
    public function __construct(
        private StockService $stock,
        private SettingsService $settings,
        private AuditService $audit,
        private SaleService $sales,
        private ShiftService $shifts,
    ) {}

    /** Value of ONE returned unit of `$sale->items[$index]` (whole dinar). */
    public static function unitRefund(Sale $sale, int $index): int
    {
        $items = $sale->items->values();
        $it = $items[$index] ?? null;
        $sumLines = $items->sum('line_total_iqd');
        if (! $it || ! $sumLines || ! $it->qty) {
            return 0;
        }
        $payable = $sale->total_iqd - $sale->gift_wrap_iqd - $sale->tax_iqd;
        $factor = min(1, max(0, $payable / $sumLines));

        return Pricing::round(($it->line_total_iqd / $it->qty) * $factor);
    }

    /**
     * @param array<int, array{saleItemIndex: int, qty: int, restock?: bool, reason?: string}> $lines
     */
    public function create(User $actor, string $saleId, array $lines, string $refundMethod, string $note, ?string $approvedById, ?Device $device): SaleReturn
    {
        if (! $actor->can('returns.create')) {
            throw AppException::forbidden('returns.create');
        }
        $lines = array_values(array_filter($lines, fn ($l) => ($l['qty'] ?? 0) > 0));
        if (! $lines) {
            throw new AppException('nothing_to_return');
        }
        if (! in_array($refundMethod, ['cash_iqd', 'card', 'fib', 'zain', 'store_credit', 'debt_reduction'], true)) {
            throw new AppException('invalid_amount');
        }
        $cfg = $this->settings->get();

        return DB::transaction(function () use ($actor, $saleId, $lines, $refundMethod, $note, $approvedById, $device, $cfg) {
            $sale = Sale::with('items')->lockForUpdate()->find($saleId) ?? throw AppException::notFound();
            if ($sale->status === 'voided') {
                throw new AppException('sale_voided');
            }
            $overWindow = (Time::nowMs() - $sale->sold_at) / 86_400_000 > $cfg['sales']['returnWindowDays'];

            $refund = 0;
            $rows = [];
            foreach ($lines as $l) {
                $item = $sale->items[$l['saleItemIndex']] ?? throw AppException::notFound();
                if ($l['qty'] > $item->qty - $item->returned_qty) {
                    throw new AppException('invalid_quantity');
                }
                $unit = self::unitRefund($sale, $l['saleItemIndex']);
                $refund += $unit * $l['qty'];
                $rows[] = ['item' => $item, 'index' => $l['saleItemIndex'], 'qty' => (int) $l['qty'], 'unit' => $unit, 'restock' => (bool) ($l['restock'] ?? true), 'reason' => (string) ($l['reason'] ?? '')];
            }

            $approver = null;
            if (($refund > $actor->max_refund_iqd || $overWindow) && ! $actor->can('returns.above_limit')) {
                if (! $approvedById) {
                    throw new AppException('approval_required', ['permission' => 'returns.above_limit'], 403);
                }
                $approver = $this->sales->verifyApprover($approvedById, 'returns.above_limit');
            }

            $shift = $this->shifts->openFor($actor->id);
            if ($refundMethod === 'cash_iqd' && $cfg['sales']['requireShift'] && ! $shift) {
                throw new AppException('shift_required');
            }
            if ($refundMethod === 'debt_reduction') {
                $c = $sale->customer_id ? Customer::lockForUpdate()->find($sale->customer_id) : null;
                if (! $sale->customer_id) {
                    throw new AppException('customer_required_for_debt');
                }
                if (! $c || $c->balance_iqd <= 0) {
                    throw new AppException('no_debt_to_reduce');
                }
                $c->update(['balance_iqd' => max(0, $c->balance_iqd - $refund)]);
            }

            return $this->apply($actor, $sale, $rows, $refund, $refundMethod, $note, $approver?->id, $shift?->id, $this->sales->nextNumber('return', $device), (string) Str::uuid7(), Time::nowMs());
        });
    }

    /**
     * Records a return a till completed offline (idempotent on its UUID). The sale must already be on the server.
     *
     * @param array<string, mixed> $r the till's SaleReturn JSON (camelCase)
     * @return array{status: string}
     */
    public function recordFromClient(User $tokenUser, array $r): array
    {
        return DB::transaction(function () use ($tokenUser, $r) {
            if (SaleReturn::whereKey($r['id'])->exists()) {
                return ['status' => 'duplicate'];
            }
            $sale = Sale::with('items')->lockForUpdate()->find($r['saleId'] ?? '');
            if (! $sale) {
                throw new AppException('sale_not_synced', ['saleId' => (string) ($r['saleId'] ?? '')], 409);
            }
            $actor = User::find($r['userId'] ?? '') ?? $tokenUser;
            $rows = [];
            foreach ($r['items'] ?? [] as $it) {
                $item = $sale->items[$it['saleItemIndex']] ?? null;
                if (! $item) {
                    continue;
                }
                $rows[] = ['item' => $item, 'index' => (int) $it['saleItemIndex'], 'qty' => min((int) $it['qty'], $item->qty - $item->returned_qty), 'unit' => (int) $it['unitNetIQD'], 'restock' => (bool) ($it['restock'] ?? true), 'reason' => (string) ($it['reason'] ?? '')];
            }
            $rows = array_values(array_filter($rows, fn ($x) => $x['qty'] > 0));
            if (! $rows) {
                return ['status' => 'duplicate'];
            }
            $method = (string) ($r['refundMethod'] ?? 'cash_iqd');
            $refund = (int) ($r['refundIQD'] ?? array_sum(array_map(fn ($x) => $x['unit'] * $x['qty'], $rows)));
            if ($method === 'debt_reduction' && $sale->customer_id && ($c = Customer::lockForUpdate()->find($sale->customer_id))) {
                $c->update(['balance_iqd' => max(0, $c->balance_iqd - $refund)]);
            }
            $shiftId = ! empty($r['shiftId']) && \App\Models\Shift::whereKey($r['shiftId'])->exists() ? $r['shiftId'] : null;
            $this->apply($actor, $sale, $rows, $refund, $method, (string) ($r['note'] ?? ''), is_string($r['approvedBy'] ?? null) ? $r['approvedBy'] : null, $shiftId, (string) $r['number'], $r['id'], (int) ($r['createdAt'] ?? Time::nowMs()));

            return ['status' => 'ok'];
        });
    }

    /** Shared tail: stock, points, sale status, rows, audit. @param array<int, array<string, mixed>> $rows */
    private function apply(User $actor, Sale $sale, array $rows, int $refund, string $method, string $note, ?string $approver, ?string $shiftId, string $number, string $id, int $at): SaleReturn
    {
        foreach ($rows as $x) {
            $x['item']->update(['returned_qty' => $x['item']->returned_qty + $x['qty']]);
            if ($x['restock']) {
                $this->stock->applyMovement($x['item']->variant_id, $x['qty'], 'return', $actor, ['refType' => 'return', 'refId' => $sale->id, 'note' => $x['reason'], 'allowNegative' => true, 'locationId' => $sale->location_id ?: StockService::LOCATION]);
            }
        }
        // points earned on the returned share are taken back
        if ($sale->customer_id && $sale->points_earned > 0 && $sale->total_iqd > 0 && ($c = Customer::lockForUpdate()->find($sale->customer_id))) {
            $c->update(['points' => max(0, $c->points - (int) floor($sale->points_earned * $refund / $sale->total_iqd))]);
        }
        $sale->load('items');
        $all = $sale->items->every(fn ($i) => $i->returned_qty >= $i->qty);
        $sale->update(['status' => $all ? 'returned' : 'partially_returned']);

        $ret = SaleReturn::create([
            'id' => $id, 'number' => $number, 'sale_id' => $sale->id, 'sale_number' => $sale->number, 'shift_id' => $shiftId, 'user_id' => $actor->id,
            'user_name' => $actor->name, 'refund_iqd' => $refund, 'refund_method' => $method, 'note' => trim($note), 'approved_by' => $approver, 'occurred_at' => $at,
        ]);
        foreach ($rows as $x) {
            $ret->items()->create([
                'sale_item_index' => $x['index'], 'variant_id' => $x['item']->variant_id, 'product_id' => $x['item']->product_id, 'name' => $x['item']->name,
                'label' => $x['item']->label, 'qty' => $x['qty'], 'unit_net_iqd' => $x['unit'], 'restock' => $x['restock'], 'reason' => $x['reason'],
            ]);
        }
        $this->audit->log($actor, 'return.create', 'return', $ret->id, ['number' => $number, 'sale' => $sale->number, 'refund' => $refund, 'method' => $method, 'approvedBy' => $approver], null, $at);

        return $ret->load('items');
    }

    /** @return \Illuminate\Support\Collection<int, SaleReturn> */
    public function list(User $actor, int $limit = 300)
    {
        $all = $actor->can('sales.view_all');
        if (! $all && ! $actor->can('sales.view_own')) {
            throw AppException::forbidden('sales.view_own');
        }

        return SaleReturn::with('items')->when(! $all, fn ($q) => $q->where('user_id', $actor->id))->orderByDesc('occurred_at')->limit(min($limit, 1000))->get();
    }
}
