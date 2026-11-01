<?php

namespace App\Services;

use App\Exceptions\AppException;
use App\Models\Customer;
use App\Models\Product;
use App\Models\User;
use App\Support\Time;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/**
 * The admin panel's first screen: how the shop and the delegates are doing over a period, compared with the period
 * before, and what needs attention. Sums are done by the database, so a month of sales stays quick.
 *
 * Periods end now: today (since midnight), week (the last 7 days) and month (the last 30 days). The comparison is the
 * same stretch of time just before, up to the same moment — today until 14:00 is compared with yesterday until 14:00.
 */
class DashboardService
{
    public const PERIODS = ['today' => 1, 'week' => 7, 'month' => 30];

    private const DAY_MS = 86_400_000;

    public function __construct(private StockService $stock, private ExpenseService $expenses, private PurchasingService $purchasing, private SettingsService $settings) {}

    /** @return array<string, mixed> */
    public function get(User $actor, string $period): array
    {
        if (! $actor->can('reports.view')) {
            throw AppException::forbidden('reports.view');
        }
        $days = self::PERIODS[$period] ?? throw new AppException('validation');
        $financial = $actor->can('reports.financial');
        $now = Time::nowMs();
        $from = Time::startOfDayMs($now - ($days - 1) * self::DAY_MS);
        $shift = $days * self::DAY_MS;

        $totals = $this->totals($from, $now, $financial);
        $previous = $this->totals($from - $shift, $now - $shift, $financial);

        return [
            'period' => $period, 'from' => $from, 'to' => $now, 'financial' => $financial,
            'totals' => $totals,
            'previous' => array_intersect_key($previous, array_flip(['count', 'revenueIQD', 'netIQD', 'profitIQD'])),
            'channels' => $totals['channels'],
            'series' => $this->series($from, $now, $period === 'today' ? 'hour' : 'day'),
            'topProducts' => $this->topProducts($from, $now),
            'lowStock' => $actor->can('inventory.view') ? $this->lowStock() : null,
            'delegates' => $actor->can('delegates.manage') ? $this->delegates($from, $now) : null,
            'debts' => $actor->can('customers.view') ? $this->debts() : null,
            // what running the shop cost in the window (shop expenses + delegates' approved road expenses)
            'expensesIQD' => $actor->can('expenses.view') ? $this->expenses->totalIQD($from, $now) + $this->expenses->delegateExpenses($from, $now) : null,
            'suppliers' => $actor->can('purchasing.view') ? $this->suppliers() : null,
            'attention' => [
                'openRequests' => $actor->can('delegates.manage') ? DB::table('stock_requests')->where('status', 'open')->count() : null,
                'pendingClosings' => $actor->can('delegates.manage') ? DB::table('delegate_closings')->where('status', 'submitted')->count() : null,
                'salesToReview' => $actor->can('sales.view_all') ? DB::table('sales')->where('needs_review', true)->count() : null,
                'ordersWaiting' => $actor->can('purchasing.view') ? DB::table('purchase_orders')->whereIn('status', PurchasingService::WAITING)->count() : null,
            ],
        ];
    }

    /** Sales that count: everything in the window except voided bills. */
    private function sales(int $from, int $to): Builder
    {
        return DB::table('sales')->where('sales.status', '!=', 'voided')->whereBetween('sales.sold_at', [$from, $to]);
    }

    /** @return array<string, mixed> */
    private function totals(int $from, int $to, bool $financial): array
    {
        $channels = ['store' => ['count' => 0, 'revenueIQD' => 0], 'delegate' => ['count' => 0, 'revenueIQD' => 0]];
        foreach ($this->sales($from, $to)->selectRaw('channel, count(*) as n, coalesce(sum(total_iqd), 0) as revenue')->groupBy('channel')->get() as $row) {
            $key = $row->channel === 'delegate' ? 'delegate' : 'store';
            $channels[$key]['count'] += (int) $row->n;
            $channels[$key]['revenueIQD'] += (int) $row->revenue;
        }
        $count = $channels['store']['count'] + $channels['delegate']['count'];
        $revenue = $channels['store']['revenueIQD'] + $channels['delegate']['revenueIQD'];
        // money handed back (store credit stays in the shop, as in the sales report)
        $refunds = (int) DB::table('returns')->whereBetween('occurred_at', [$from, $to])->where('refund_method', '!=', 'store_credit')->sum('refund_iqd');
        $items = $this->sales($from, $to)->join('sale_items', 'sale_items.sale_id', '=', 'sales.id')
            ->selectRaw('coalesce(sum(sale_items.qty), 0) as units, coalesce(sum(sale_items.unit_cost_iqd * sale_items.qty), 0) as cost')->first();
        $net = $revenue - $refunds;
        $profit = null;
        if ($financial) {
            // what the returned bottles had cost comes back off the cost of goods
            $returnedCost = (int) DB::table('return_items')
                ->join('returns', 'returns.id', '=', 'return_items.return_id')
                ->join('sale_items', fn ($j) => $j->on('sale_items.sale_id', '=', 'returns.sale_id')->on('sale_items.position', '=', 'return_items.sale_item_index'))
                ->whereBetween('returns.occurred_at', [$from, $to])
                ->selectRaw('coalesce(sum(sale_items.unit_cost_iqd * return_items.qty), 0) as c')->value('c');
            $profit = $net - ((int) $items->cost - $returnedCost);
        }

        return [
            'count' => $count, 'revenueIQD' => $revenue, 'refundsIQD' => $refunds, 'netIQD' => $net,
            'unitsSold' => (int) $items->units, 'avgBasketIQD' => $count ? (int) round($revenue / $count) : 0,
            'profitIQD' => $profit, 'channels' => $channels,
        ];
    }

    /** Takings per hour (today) or per day, shop and delegates apart — every bucket present, empty ones as 0. */
    private function series(int $from, int $to, string $unit): array
    {
        $buckets = [];
        $key = fn (int $ms) => $unit === 'hour' ? Time::at($ms)->format('G') : Time::at($ms)->format('Y-m-d');
        for ($t = $from; $t <= $to; $t += $unit === 'hour' ? 3_600_000 : self::DAY_MS) {
            $buckets[$key($t)] = ['key' => $key($t), 'storeIQD' => 0, 'delegateIQD' => 0, 'count' => 0];
        }
        $buckets[$key($to)] ??= ['key' => $key($to), 'storeIQD' => 0, 'delegateIQD' => 0, 'count' => 0];
        foreach ($this->sales($from, $to)->select('sold_at', 'channel', 'total_iqd')->orderBy('sold_at')->cursor() as $s) {
            $k = $key((int) $s->sold_at);
            if (! isset($buckets[$k])) {
                continue;
            }
            $buckets[$k][$s->channel === 'delegate' ? 'delegateIQD' : 'storeIQD'] += (int) $s->total_iqd;
            $buckets[$k]['count']++;
        }

        return ['unit' => $unit, 'points' => array_values($buckets)];
    }

    private function topProducts(int $from, int $to): array
    {
        $rows = $this->sales($from, $to)->join('sale_items', 'sale_items.sale_id', '=', 'sales.id')
            ->selectRaw('sale_items.product_id, coalesce(sum(sale_items.qty), 0) as units, coalesce(sum(sale_items.line_total_iqd), 0) as revenue')
            ->groupBy('sale_items.product_id')->orderByDesc('revenue')->limit(5)->get();
        $products = Product::whereIn('id', $rows->pluck('product_id'))->get()->keyBy('id');

        return $rows->map(function ($r) use ($products) {
            $p = $products[$r->product_id] ?? null;

            return [
                'productId' => $r->product_id, 'name' => $p?->name ?? ['en' => '', 'ar' => '', 'ku' => ''], 'brand' => $p?->brand ?? '',
                'image' => $p?->image_path ? Storage::disk('public')->url($p->image_path) : null, 'art' => $p?->art,
                'units' => (int) $r->units, 'revenueIQD' => (int) $r->revenue,
            ];
        })->values()->all();
    }

    /** Sizes at or below their alert level in the shop, emptiest first. */
    private function lowStock(): array
    {
        $stock = $this->stock->map();
        $low = DB::table('variants')->join('products', 'products.id', '=', 'variants.product_id')
            ->where('variants.active', true)->where('products.active', true)
            ->select('variants.id', 'variants.label', 'variants.sku', 'variants.min_stock', 'products.name')->get()
            ->map(fn ($v) => ['variantId' => $v->id, 'name' => json_decode($v->name, true), 'label' => $v->label, 'sku' => $v->sku, 'qty' => (int) ($stock[$v->id] ?? 0), 'minStock' => (int) $v->min_stock])
            ->filter(fn ($v) => $v['qty'] <= $v['minStock'])
            ->sortBy([['qty', 'asc'], ['sku', 'asc']])->values();

        return ['count' => $low->count(), 'items' => $low->take(8)->all()];
    }

    /** Every delegate, best seller first: sales and collections in the window, and when their phone was last seen. */
    private function delegates(int $from, int $to): array
    {
        $people = User::with('role')->where('active', true)->orderBy('name')->get()->filter(fn (User $u) => DelegateService::isDelegate($u));
        $ids = $people->pluck('id')->all();
        if (! $ids) {
            return [];
        }
        $sales = $this->sales($from, $to)->where('channel', 'delegate')->whereIn('user_id', $ids)
            ->selectRaw('user_id, count(*) as n, coalesce(sum(total_iqd), 0) as revenue')->groupBy('user_id')->get()->keyBy('user_id');
        $collected = DB::table('collections')->whereIn('user_id', $ids)->whereBetween('occurred_at', [$from, $to])
            ->selectRaw('user_id, coalesce(sum(amount_iqd), 0) as amount')->groupBy('user_id')->pluck('amount', 'user_id');
        $seen = DB::table('delegate_locations')->whereIn('user_id', $ids)->selectRaw('user_id, max(recorded_at) as at')->groupBy('user_id')->pluck('at', 'user_id');

        return $people->map(fn (User $u) => [
            'id' => $u->id, 'name' => $u->name, 'color' => $u->color,
            'salesIQD' => (int) ($sales[$u->id]->revenue ?? 0), 'salesCount' => (int) ($sales[$u->id]->n ?? 0),
            'collectedIQD' => (int) ($collected[$u->id] ?? 0), 'lastSeenAt' => isset($seen[$u->id]) ? (int) $seen[$u->id] : null,
        ])->sortByDesc('salesIQD')->values()->all();
    }

    /** What the shop owes its suppliers: per currency, in dinars at today's rate, and the biggest balances. */
    private function suppliers(): array
    {
        $owed = array_filter($this->purchasing->balances(), fn ($c) => $c > 0);
        $rate = (int) $this->settings->get()['currency']['rate'];
        $people = \App\Models\Supplier::whereIn('id', array_keys($owed))->get()->keyBy('id');
        $byCurrency = ['IQD' => 0, 'USD' => 0];
        foreach ($owed as $id => $cents) {
            $byCurrency[$people[$id]->currency ?? 'IQD'] += $cents;
        }
        $top = collect($owed)->map(fn ($cents, $id) => ['id' => $id, 'name' => $people[$id]->name ?? '', 'currency' => $people[$id]->currency ?? 'IQD', 'balance' => round($cents / 100, 2),
            'balanceIQD' => \App\Support\Money::iqd($cents, $people[$id]->currency ?? 'IQD', $rate)])->sortByDesc('balanceIQD')->take(5)->values()->all();

        return [
            'owedUSD' => round($byCurrency['USD'] / 100, 2), 'owedIQD' => intdiv($byCurrency['IQD'], 100),
            'totalIQD' => \App\Support\Money::iqd($byCurrency['USD'], 'USD', $rate) + intdiv($byCurrency['IQD'], 100), 'rate' => $rate,
            'suppliers' => count($owed), 'top' => $top,
        ];
    }

    private function debts(): array
    {
        $owing = Customer::where('active', true)->where('balance_iqd', '>', 0);

        return [
            'totalIQD' => (int) (clone $owing)->sum('balance_iqd'),
            'customers' => (clone $owing)->count(),
            'top' => (clone $owing)->orderByDesc('balance_iqd')->limit(5)->get(['id', 'name', 'phone', 'balance_iqd'])
                ->map(fn (Customer $c) => ['id' => $c->id, 'name' => $c->name, 'phone' => $c->phone, 'balanceIQD' => (int) $c->balance_iqd])->all(),
        ];
    }
}
