<?php

namespace App\Services;

use App\Exceptions\AppException;
use App\Models\Supplier;
use App\Models\User;
use App\Support\Money;
use App\Support\Time;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Admin panel → Debts: money owed both ways, kept apart from the sales figures.
 *
 *   receivable  what customers owe the shop (bills sold "on debt", less what they paid back or returned)
 *   payable     what the shop owes its suppliers (deliveries received, less what was paid)
 *
 * Balances are as of now; "given / collected / bought / paid" are the movements inside the chosen window.
 * Each half is only sent to people who may see it (customers.view / purchasing.view).
 */
class DebtService
{
    /** window → days, ending now */
    public const PERIODS = ['today' => 1, 'week' => 7, 'month' => 30, 'quarter' => 90];

    private const DAY_MS = 86_400_000;

    /** aging bucket → its last day (anything older is age91) */
    private const BUCKETS = ['age0' => 30, 'age31' => 60, 'age61' => 90];

    public function __construct(private PurchasingService $purchasing, private SettingsService $settings) {}

    /** @return array<string, mixed> */
    public function overview(User $actor, string $period): array
    {
        $customers = $actor->can('customers.view');
        $suppliers = $actor->can('purchasing.view');
        if (! $customers && ! $suppliers) {
            throw AppException::forbidden('customers.view');
        }
        $days = self::PERIODS[$period] ?? throw new AppException('validation');
        $now = Time::nowMs();
        $from = Time::startOfDayMs($now - ($days - 1) * self::DAY_MS);

        $receivable = $customers ? $this->receivable($from, $now) : null;
        $payable = $suppliers ? $this->payable($from, $now) : null;

        return [
            'period' => $period, 'from' => $from, 'to' => $now,
            'receivable' => $receivable,
            'payable' => $payable,
            // what is owed to the shop minus what the shop owes, in dinars (only when both halves are visible)
            'netIQD' => $receivable && $payable ? $receivable['totalIQD'] - $payable['totalIQD'] : null,
            'series' => $this->series($from, $now, $period === 'today' ? 'hour' : 'day', $customers, $suppliers),
            'activity' => $this->activity($from, $now, $customers, $suppliers),
        ];
    }

    /* ───────── customers → the shop ───────── */

    /** @return array<string, mixed> */
    private function receivable(int $from, int $to): array
    {
        $rows = $this->aging();
        $moves = $this->customerMoves($from, $to);
        $overLimit = $rows->filter(fn ($r) => $r['creditLimitIQD'] > 0 && $r['balanceIQD'] > $r['creditLimitIQD'])->count();

        return [
            'totalIQD' => (int) $rows->sum('balanceIQD'),
            'customers' => $rows->count(),
            'overLimit' => $overLimit,
            'aging' => ['age0' => (int) $rows->sum('age0'), 'age31' => (int) $rows->sum('age31'), 'age61' => (int) $rows->sum('age61'), 'age91' => (int) $rows->sum('age91')],
            'givenIQD' => $moves['given'], 'givenCount' => $moves['givenCount'],
            'collectedIQD' => $moves['collected'], 'collectedCount' => $moves['collectedCount'],
            'returnedIQD' => $moves['returned'],
            'rows' => $rows->values()->all(),
        ];
    }

    /**
     * Everyone who owes the shop, the most owed first, with how old the debt is. Payments clear the oldest debt
     * first, so what is still owed is the newest credit sales: walk them from the newest back until they add up to
     * the balance. Debt the sales do not explain (an opening balance) counts as the oldest.
     */
    public function aging(?int $now = null): Collection
    {
        $now ??= Time::nowMs();
        $customers = DB::table('customers')->where('active', true)->where('balance_iqd', '>', 0)->orderByDesc('balance_iqd')
            ->get(['id', 'name', 'phone', 'type', 'city', 'balance_iqd', 'credit_limit_iqd']);
        $ids = $customers->pluck('id');
        $credit = DB::table('sale_payments')->join('sales', 'sales.id', '=', 'sale_payments.sale_id')
            ->where('sale_payments.method', 'debt')->where('sales.status', '!=', 'voided')->whereIn('sales.customer_id', $ids)
            ->orderByDesc('sales.sold_at')->get(['sales.customer_id', 'sales.sold_at', 'sale_payments.amount_iqd'])->groupBy('customer_id');
        $lastPaid = DB::table('collections')->whereIn('customer_id', $ids)->selectRaw('customer_id, max(occurred_at) as at')->groupBy('customer_id')->pluck('at', 'customer_id');

        return $customers->map(function ($c) use ($credit, $lastPaid, $now) {
            $left = (int) $c->balance_iqd;
            $row = [
                'id' => $c->id, 'name' => $c->name, 'phone' => $c->phone, 'type' => $c->type, 'city' => $c->city,
                'balanceIQD' => $left, 'creditLimitIQD' => (int) $c->credit_limit_iqd,
                'age0' => 0, 'age31' => 0, 'age61' => 0, 'age91' => 0,
                'lastDebtAt' => isset($credit[$c->id]) ? (int) $credit[$c->id]->first()->sold_at : null,
                'lastPaymentAt' => isset($lastPaid[$c->id]) ? (int) $lastPaid[$c->id] : null,
                // days since the oldest bill still unpaid; null when an opening balance (no bill behind it) is still owed
                'oldestDays' => null,
            ];
            foreach ($credit[$c->id] ?? [] as $debt) {
                if ($left <= 0) {
                    break;
                }
                $part = min($left, (int) $debt->amount_iqd);
                $days = intdiv(max(0, $now - (int) $debt->sold_at), self::DAY_MS);
                $row[self::bucket($days)] += $part;
                $row['oldestDays'] = $days;
                $left -= $part;
            }
            if ($left > 0) {
                // part of it is older than any bill on record (an opening balance): the oldest age is not known
                $row['age91'] += $left;
                $row['oldestDays'] = null;
            }

            return $row;
        })->values();
    }

    private static function bucket(int $days): string
    {
        foreach (self::BUCKETS as $k => $limit) {
            if ($days <= $limit) {
                return $k;
            }
        }

        return 'age91';
    }

    /** @return array{given: int, givenCount: int, collected: int, collectedCount: int, returned: int} */
    private function customerMoves(int $from, int $to): array
    {
        $given = DB::table('sales')->where('status', '!=', 'voided')->where('due_iqd', '>', 0)->whereBetween('sold_at', [$from, $to])
            ->selectRaw('count(*) as n, coalesce(sum(due_iqd), 0) as t')->first();
        $collected = DB::table('collections')->whereBetween('occurred_at', [$from, $to])->selectRaw('count(*) as n, coalesce(sum(amount_iqd), 0) as t')->first();
        $returned = (int) DB::table('returns')->where('refund_method', 'debt_reduction')->whereBetween('occurred_at', [$from, $to])->sum('refund_iqd');

        return ['given' => (int) $given->t, 'givenCount' => (int) $given->n, 'collected' => (int) $collected->t, 'collectedCount' => (int) $collected->n, 'returned' => $returned];
    }

    /* ───────── the shop → suppliers ───────── */

    /** @return array<string, mixed> */
    private function payable(int $from, int $to): array
    {
        $rate = (int) $this->settings->get()['currency']['rate'];
        $rows = $this->supplierBalances($rate)->filter(fn ($r) => $r['balance'] > 0)->sortByDesc('balanceIQD')->values();
        $bought = DB::table('purchase_receipts')->whereBetween('received_at', [$from, $to])->selectRaw('count(*) as n, coalesce(sum(total_iqd), 0) as t')->first();
        $paid = DB::table('supplier_payments')->whereBetween('paid_at', [$from, $to])->selectRaw('count(*) as n, coalesce(sum(amount_iqd), 0) as t')->first();

        return [
            'totalIQD' => (int) $rows->sum('balanceIQD'),
            'owedUSD' => round((float) $rows->where('currency', 'USD')->sum('balance'), 2),
            'owedIQD' => (int) $rows->where('currency', 'IQD')->sum('balance'),
            'rate' => $rate,
            'suppliers' => $rows->count(),
            'boughtIQD' => (int) $bought->t, 'boughtCount' => (int) $bought->n,
            'paidIQD' => (int) $paid->t, 'paidCount' => (int) $paid->n,
            'rows' => $rows->all(),
        ];
    }

    /**
     * Every supplier with what was received from them, what was paid and what is left, in their own currency and
     * roughly in dinars at today's rate.
     */
    public function supplierBalances(?int $rate = null): Collection
    {
        $rate ??= (int) $this->settings->get()['currency']['rate'];
        $balances = $this->purchasing->balances();
        $received = DB::table('purchase_receipts')->selectRaw('supplier_id, coalesce(sum(total), 0) as t, max(received_at) as at')->groupBy('supplier_id')->get()->keyBy('supplier_id');
        $paid = DB::table('supplier_payments')->selectRaw('supplier_id, coalesce(sum(amount), 0) as t, max(paid_at) as at')->groupBy('supplier_id')->get()->keyBy('supplier_id');

        return Supplier::orderBy('name')->get()->map(function (Supplier $s) use ($balances, $received, $paid, $rate) {
            $cents = (int) ($balances[$s->id] ?? 0);

            return [
                'id' => $s->id, 'name' => $s->name, 'phone' => $s->phone, 'city' => $s->city, 'currency' => $s->currency, 'active' => (bool) $s->active,
                'received' => Money::out($received[$s->id]->t ?? 0), 'paid' => Money::out($paid[$s->id]->t ?? 0),
                'balance' => round($cents / 100, 2), 'balanceIQD' => Money::iqd($cents, $s->currency, $rate),
                'lastReceiptAt' => isset($received[$s->id]) ? (int) $received[$s->id]->at : null,
                'lastPaymentAt' => isset($paid[$s->id]) ? (int) $paid[$s->id]->at : null,
            ];
        })->values();
    }

    /* ───────── over time ───────── */

    /** Debt given and collected (customers), bought and paid (suppliers) per hour (today) or per day. */
    private function series(int $from, int $to, string $unit, bool $customers, bool $suppliers): array
    {
        $key = fn (int $ms) => $unit === 'hour' ? Time::at($ms)->format('G') : Time::at($ms)->format('Y-m-d');
        $blank = fn (string $k) => ['key' => $k, 'givenIQD' => 0, 'collectedIQD' => 0, 'boughtIQD' => 0, 'paidIQD' => 0];
        $buckets = [];
        for ($t = $from; $t <= $to; $t += $unit === 'hour' ? 3_600_000 : self::DAY_MS) {
            $buckets[$key($t)] = $blank($key($t));
        }
        $buckets[$key($to)] ??= $blank($key($to));
        $add = function (iterable $rows, string $field) use (&$buckets, $key) {
            foreach ($rows as $r) {
                $k = $key((int) $r->at);
                if (isset($buckets[$k])) {
                    $buckets[$k][$field] += (int) $r->amount;
                }
            }
        };
        if ($customers) {
            $add(DB::table('sales')->where('status', '!=', 'voided')->where('due_iqd', '>', 0)->whereBetween('sold_at', [$from, $to])->get(['sold_at as at', 'due_iqd as amount']), 'givenIQD');
            $add(DB::table('collections')->whereBetween('occurred_at', [$from, $to])->get(['occurred_at as at', 'amount_iqd as amount']), 'collectedIQD');
        }
        if ($suppliers) {
            $add(DB::table('purchase_receipts')->whereBetween('received_at', [$from, $to])->get(['received_at as at', 'total_iqd as amount']), 'boughtIQD');
            $add(DB::table('supplier_payments')->whereBetween('paid_at', [$from, $to])->get(['paid_at as at', 'amount_iqd as amount']), 'paidIQD');
        }

        return ['unit' => $unit, 'points' => array_values($buckets)];
    }

    /* ───────── every movement ───────── */

    /**
     * Every debt movement in the window, newest first. `sign` is +1 when it makes a debt bigger, −1 when it pays it
     * down; `side` says whose debt it is.
     *
     * @return array<int, array<string, mixed>>
     */
    public function movements(int $from, int $to, bool $customers, bool $suppliers, ?int $limit = null): array
    {
        $rows = [];
        if ($customers) {
            $sales = DB::table('sales')->leftJoin('customers', 'customers.id', '=', 'sales.customer_id')
                ->where('sales.status', '!=', 'voided')->where('sales.due_iqd', '>', 0)->whereBetween('sales.sold_at', [$from, $to])
                ->get(['sales.id', 'sales.sold_at', 'sales.number', 'sales.due_iqd', 'sales.user_name', 'sales.channel', 'sales.customer_id', 'customers.name as customer']);
            foreach ($sales as $s) {
                $rows[] = ['id' => $s->id, 'at' => (int) $s->sold_at, 'side' => 'customer', 'kind' => 'debt_sale', 'sign' => 1, 'partyId' => $s->customer_id, 'party' => (string) $s->customer,
                    'ref' => $s->number, 'amount' => (int) $s->due_iqd, 'currency' => 'IQD', 'amountIQD' => (int) $s->due_iqd, 'method' => null, 'by' => (string) $s->user_name, 'note' => ''];
            }
            $names = DB::table('users')->pluck('name', 'id');
            $paid = DB::table('collections')->join('customers', 'customers.id', '=', 'collections.customer_id')->whereBetween('collections.occurred_at', [$from, $to])
                ->get(['collections.id', 'collections.occurred_at', 'collections.amount_iqd', 'collections.method', 'collections.user_id', 'collections.note', 'collections.customer_id', 'customers.name as customer']);
            foreach ($paid as $c) {
                $rows[] = ['id' => $c->id, 'at' => (int) $c->occurred_at, 'side' => 'customer', 'kind' => 'collection', 'sign' => -1, 'partyId' => $c->customer_id, 'party' => (string) $c->customer,
                    'ref' => '', 'amount' => (int) $c->amount_iqd, 'currency' => 'IQD', 'amountIQD' => (int) $c->amount_iqd, 'method' => $c->method, 'by' => (string) ($names[$c->user_id] ?? ''), 'note' => (string) $c->note];
            }
            $back = DB::table('returns')->join('sales', 'sales.id', '=', 'returns.sale_id')->leftJoin('customers', 'customers.id', '=', 'sales.customer_id')
                ->where('returns.refund_method', 'debt_reduction')->whereBetween('returns.occurred_at', [$from, $to])
                ->get(['returns.id', 'returns.occurred_at', 'returns.number', 'returns.refund_iqd', 'returns.user_name', 'sales.customer_id', 'customers.name as customer']);
            foreach ($back as $r) {
                $rows[] = ['id' => $r->id, 'at' => (int) $r->occurred_at, 'side' => 'customer', 'kind' => 'debt_return', 'sign' => -1, 'partyId' => $r->customer_id, 'party' => (string) $r->customer,
                    'ref' => $r->number, 'amount' => (int) $r->refund_iqd, 'currency' => 'IQD', 'amountIQD' => (int) $r->refund_iqd, 'method' => null, 'by' => (string) $r->user_name, 'note' => ''];
            }
        }
        if ($suppliers) {
            $receipts = DB::table('purchase_receipts')->join('suppliers', 'suppliers.id', '=', 'purchase_receipts.supplier_id')
                ->join('purchase_orders', 'purchase_orders.id', '=', 'purchase_receipts.purchase_order_id')->whereBetween('purchase_receipts.received_at', [$from, $to])
                ->get(['purchase_receipts.id', 'purchase_receipts.received_at', 'purchase_receipts.total', 'purchase_receipts.currency', 'purchase_receipts.total_iqd', 'purchase_receipts.user_name',
                    'purchase_receipts.note', 'purchase_receipts.supplier_id', 'suppliers.name as supplier', 'purchase_orders.number']);
            foreach ($receipts as $r) {
                $rows[] = ['id' => $r->id, 'at' => (int) $r->received_at, 'side' => 'supplier', 'kind' => 'purchase', 'sign' => 1, 'partyId' => $r->supplier_id, 'party' => (string) $r->supplier,
                    'ref' => $r->number, 'amount' => Money::out($r->total), 'currency' => $r->currency, 'amountIQD' => (int) $r->total_iqd, 'method' => null, 'by' => (string) $r->user_name, 'note' => (string) $r->note];
            }
            $payments = DB::table('supplier_payments')->join('suppliers', 'suppliers.id', '=', 'supplier_payments.supplier_id')->whereBetween('supplier_payments.paid_at', [$from, $to])
                ->get(['supplier_payments.id', 'supplier_payments.paid_at', 'supplier_payments.amount', 'supplier_payments.currency', 'supplier_payments.amount_iqd', 'supplier_payments.method',
                    'supplier_payments.user_name', 'supplier_payments.note', 'supplier_payments.supplier_id', 'suppliers.name as supplier']);
            foreach ($payments as $p) {
                $rows[] = ['id' => $p->id, 'at' => (int) $p->paid_at, 'side' => 'supplier', 'kind' => 'supplier_payment', 'sign' => -1, 'partyId' => $p->supplier_id, 'party' => (string) $p->supplier,
                    'ref' => '', 'amount' => Money::out($p->amount), 'currency' => $p->currency, 'amountIQD' => (int) $p->amount_iqd, 'method' => $p->method, 'by' => (string) $p->user_name, 'note' => (string) $p->note];
            }
        }
        usort($rows, fn ($a, $b) => $b['at'] <=> $a['at']);

        return $limit === null ? $rows : array_slice($rows, 0, $limit);
    }

    private function activity(int $from, int $to, bool $customers, bool $suppliers): array
    {
        return $this->movements($from, $to, $customers, $suppliers, 25);
    }
}
