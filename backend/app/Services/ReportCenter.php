<?php

namespace App\Services;

use App\Exceptions\AppException;
use App\Models\Expense;
use App\Models\Shift;
use App\Models\User;
use App\Support\Money;
use App\Support\Time;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Admin panel → Reports. Every report comes back in one shape, which the screen, the Excel file and the PDF all use:
 *
 *   columns  [{key, label, type}]   label is an i18n key; type says how a value is shown
 *   rows     [{key: value, …}]
 *   totals   {key: value} | null
 *
 * Column types: text · name ({en,ar,ku}) · label (the value is an i18n key) · enum:<prefix> (prefix + value is the key)
 * · day (Y-m-d) · date / datetime (epoch ms) · int · iqd · money (in the row's `currency`) · usd · pct
 * · items ([{name {en,ar,ku}, label, qty}], shown as "Khamrah 100 ml ×3, …") · map ("lat,lng", shown as a map link).
 * Columns marked as financial (cost, profit, margin) are only sent to people who hold `reports.financial`.
 */
class ReportCenter
{
    /** report → the permission it needs */
    public const REPORTS = [
        'sales-by-day' => 'reports.view',
        'sales-by-product' => 'reports.view',
        'sales-by-brand' => 'reports.view',
        'sales-by-category' => 'reports.view',
        'sales-by-seller' => 'reports.view',
        'profit-loss' => 'reports.financial',
        'expenses' => 'expenses.view',
        'delegate-commission' => 'delegates.manage',
        'delegate-sales' => 'delegates.manage',
        'debt-aging' => 'customers.view',
        'stock-valuation' => 'reports.financial',
        'slow-movers' => 'inventory.view',
        'purchases' => 'purchasing.view',
        'shifts' => 'shifts.view_all',
    ];

    private const DAY_MS = 86_400_000;

    private bool $fin = false;

    public function __construct(private StockService $stock, private ExpenseService $expenses, private ShiftService $shifts) {}

    /** @return array<string, mixed> */
    public function run(User $actor, string $type, int $from, int $to): array
    {
        $perm = self::REPORTS[$type] ?? throw AppException::notFound();
        if (! $actor->can($perm)) {
            throw AppException::forbidden($perm);
        }
        $this->fin = $actor->can('reports.financial');
        $out = match ($type) {
            'sales-by-day' => $this->salesByDay($from, $to),
            'sales-by-product' => $this->byProduct($from, $to),
            'sales-by-brand' => $this->grouped($from, $to, 'brand', 'text'),
            'sales-by-category' => $this->grouped($from, $to, 'category', 'enum:prod.cat_'),
            'sales-by-seller' => $this->bySeller($from, $to),
            'profit-loss' => $this->profitLoss($from, $to),
            'expenses' => $this->expenseList($from, $to),
            'delegate-commission' => $this->commission($from, $to),
            'delegate-sales' => $this->delegateSales($from, $to),
            'debt-aging' => $this->debtAging(),
            'stock-valuation' => $this->stockValuation(),
            'slow-movers' => $this->slowMovers($from, $to),
            'purchases' => $this->purchases($from, $to),
            'shifts' => $this->shiftList($from, $to),
        };

        return array_merge(['type' => $type, 'from' => $from, 'to' => $to, 'financial' => $this->fin, 'summary' => []], $out);
    }

    /** Set a delegate's commission percentage. */
    public function setCommission(User $actor, string $delegateId, float $pct): void
    {
        if (! $actor->can('delegates.manage')) {
            throw AppException::forbidden('delegates.manage');
        }
        $u = User::with('role')->find($delegateId) ?? throw AppException::notFound();
        if (! DelegateService::isDelegate($u) || $pct < 0 || $pct > 100) {
            throw new AppException('validation');
        }
        $u->update(['commission_pct' => number_format($pct, 2, '.', '')]);
        app(AuditService::class)->log($actor, 'delegate.commission', 'user', $u->id, ['name' => $u->name, 'pct' => round($pct, 2)]);
    }

    /* ───────── building blocks ───────── */

    /** @param array<int, array{0: string, 1: string, 2?: bool}> $defs [key, type, financial?] */
    private function cols(array $defs): array
    {
        $out = [];
        foreach ($defs as $d) {
            if (($d[2] ?? false) && ! $this->fin) {
                continue;
            }
            $out[] = ['key' => $d[0], 'label' => 'rc.'.$d[0], 'type' => $d[1]];
        }

        return $out;
    }

    /** Keeps only the keys a person may see (cost/profit/margin stay on the server without reports.financial). */
    private function strip(array $columns, array $row): array
    {
        return array_intersect_key($row, array_flip([...array_column($columns, 'key'), 'id', 'currency', 'kind']));
    }

    private function table(array $columns, iterable $rows, ?array $totals = null, array $summary = []): array
    {
        $rows = collect($rows)->map(fn ($r) => $this->strip($columns, $r))->values()->all();

        return ['columns' => $columns, 'rows' => $rows, 'totals' => $totals === null ? null : $this->strip($columns, $totals), 'summary' => $summary];
    }

    private static function pct(int|float $part, int|float $whole): ?float
    {
        return $whole ? round($part / $whole * 100, 1) : null;
    }

    private static function day(int $ms): string
    {
        return Time::at($ms)->format('Y-m-d');
    }

    /** Bills that count: everything in the window except voided ones. */
    private function sales(int $from, int $to)
    {
        return DB::table('sales')->where('sales.status', '!=', 'voided')->whereBetween('sales.sold_at', [$from, $to]);
    }

    /** Every sold line in the window, with what came back of it (net = sold − returned). */
    private function items(int $from, int $to): Collection
    {
        return $this->sales($from, $to)->join('sale_items', 'sale_items.sale_id', '=', 'sales.id')
            ->leftJoin('products', 'products.id', '=', 'sale_items.product_id')
            ->select('sale_items.variant_id', 'sale_items.product_id', 'sale_items.name', 'sale_items.brand', 'sale_items.label', 'sale_items.sku',
                'sale_items.qty', 'sale_items.returned_qty', 'sale_items.line_total_iqd', 'sale_items.unit_cost_iqd',
                'sales.sold_at', 'sales.user_id', 'products.category', 'products.name as product_name')
            ->get()->map(function ($i) {
                $qty = (int) $i->qty;
                $net = max(0, $qty - (int) $i->returned_qty);
                $i->net_qty = $net;
                $i->net_revenue = $qty ? (int) round($i->line_total_iqd * $net / $qty) : 0;
                $i->net_cost = (int) $i->unit_cost_iqd * $net;

                return $i;
            });
    }

    /** Money handed back in the window (store credit stays in the shop), per sale. */
    private function refunds(int $from, int $to): Collection
    {
        return DB::table('returns')->whereBetween('occurred_at', [$from, $to])->where('refund_method', '!=', 'store_credit')->get(['sale_id', 'refund_iqd', 'occurred_at']);
    }

    /** What the returned bottles had cost, per return day. */
    private function returnedCost(int $from, int $to): Collection
    {
        return DB::table('return_items')->join('returns', 'returns.id', '=', 'return_items.return_id')
            ->join('sale_items', fn ($j) => $j->on('sale_items.sale_id', '=', 'returns.sale_id')->on('sale_items.position', '=', 'return_items.sale_item_index'))
            ->whereBetween('returns.occurred_at', [$from, $to])
            ->get(['returns.occurred_at', DB::raw('sale_items.unit_cost_iqd * return_items.qty as cost')]);
    }

    /* ───────── sales ───────── */

    private function salesByDay(int $from, int $to): array
    {
        $days = [];
        $blank = fn (string $d) => ['day' => $d, 'bills' => 0, 'units' => 0, 'revenue' => 0, 'discounts' => 0, 'refunds' => 0, 'net' => 0, 'cost' => 0, 'profit' => 0, 'margin' => null];
        if ($to - $from <= 400 * self::DAY_MS) {
            for ($t = $from; $t <= $to; $t += self::DAY_MS) {
                $days[self::day($t)] = $blank(self::day($t));
            }
            $days[self::day($to)] ??= $blank(self::day($to));
        }
        foreach ($this->sales($from, $to)->get(['sold_at', 'total_iqd', 'item_discount_iqd', 'order_discount_iqd', 'points_redeemed_iqd']) as $s) {
            $d = self::day((int) $s->sold_at);
            $days[$d] ??= $blank($d);
            $days[$d]['bills']++;
            $days[$d]['revenue'] += (int) $s->total_iqd;
            $days[$d]['discounts'] += (int) $s->item_discount_iqd + (int) $s->order_discount_iqd + (int) $s->points_redeemed_iqd;
        }
        foreach ($this->items($from, $to) as $i) {
            $d = self::day((int) $i->sold_at);
            $days[$d]['units'] += (int) $i->qty;
            $days[$d]['cost'] += (int) $i->unit_cost_iqd * (int) $i->qty;
        }
        foreach ($this->refunds($from, $to) as $r) {
            $d = self::day((int) $r->occurred_at);
            $days[$d] ??= $blank($d);
            $days[$d]['refunds'] += (int) $r->refund_iqd;
        }
        foreach ($this->returnedCost($from, $to) as $r) {
            $d = self::day((int) $r->occurred_at);
            $days[$d] ??= $blank($d);
            $days[$d]['cost'] -= (int) $r->cost;
        }
        ksort($days);
        $tot = $blank('');
        foreach ($days as &$row) {
            $row['net'] = $row['revenue'] - $row['refunds'];
            $row['profit'] = $row['net'] - $row['cost'];
            $row['margin'] = self::pct($row['profit'], $row['net']);
            foreach (['bills', 'units', 'revenue', 'discounts', 'refunds', 'net', 'cost', 'profit'] as $k) {
                $tot[$k] += $row[$k];
            }
        }
        unset($row);
        $tot['margin'] = self::pct($tot['profit'], $tot['net']);
        unset($tot['day']);
        $columns = $this->cols([['day', 'day'], ['bills', 'int'], ['units', 'int'], ['revenue', 'iqd'], ['discounts', 'iqd'], ['refunds', 'iqd'], ['net', 'iqd'],
            ['cost', 'iqd', true], ['profit', 'iqd', true], ['margin', 'pct', true]]);

        return $this->table($columns, array_values($days), $tot);
    }

    /** Per size: what sold (after returns), for how much, and — for those who may see it — what it cost and earned. */
    private function byProduct(int $from, int $to): array
    {
        $rows = [];
        foreach ($this->items($from, $to) as $i) {
            $r = &$rows[$i->variant_id];
            $r ??= ['id' => $i->variant_id, 'product' => $i->product_name ? json_decode($i->product_name, true) : json_decode($i->name, true), 'size' => $i->label, 'sku' => $i->sku,
                'brand' => $i->brand, 'units' => 0, 'returned' => 0, 'revenue' => 0, 'cost' => 0];
            $r['units'] += $i->net_qty;
            $r['returned'] += (int) $i->returned_qty;
            $r['revenue'] += $i->net_revenue;
            $r['cost'] += $i->net_cost;
            unset($r);
        }
        $tot = ['units' => 0, 'returned' => 0, 'revenue' => 0, 'cost' => 0, 'profit' => 0];
        foreach ($rows as &$r) {
            $r['profit'] = $r['revenue'] - $r['cost'];
            $r['margin'] = self::pct($r['profit'], $r['revenue']);
            foreach (['units', 'returned', 'revenue', 'cost', 'profit'] as $k) {
                $tot[$k] += $r[$k];
            }
        }
        unset($r);
        $tot['margin'] = self::pct($tot['profit'], $tot['revenue']);
        $columns = $this->cols([['product', 'name'], ['size', 'text'], ['sku', 'text'], ['brand', 'text'], ['units', 'int'], ['returned', 'int'], ['revenue', 'iqd'],
            ['cost', 'iqd', true], ['profit', 'iqd', true], ['margin', 'pct', true]]);

        return $this->table($columns, collect($rows)->sortByDesc('revenue'), $tot);
    }

    /** The same lines, added up per brand or per category, with each one's share of the takings. */
    private function grouped(int $from, int $to, string $by, string $type): array
    {
        $rows = [];
        foreach ($this->items($from, $to) as $i) {
            $k = (string) ($i->{$by} ?? '') ?: '—';
            $r = &$rows[$k];
            $r ??= [$by => $k, 'products' => [], 'units' => 0, 'revenue' => 0, 'cost' => 0];
            $r['products'][$i->product_id] = true;
            $r['units'] += $i->net_qty;
            $r['revenue'] += $i->net_revenue;
            $r['cost'] += $i->net_cost;
            unset($r);
        }
        $total = array_sum(array_column($rows, 'revenue'));
        $tot = ['products' => 0, 'units' => 0, 'revenue' => 0, 'cost' => 0, 'profit' => 0, 'share' => $total ? 100.0 : null];
        foreach ($rows as &$r) {
            $r['products'] = count($r['products']);
            $r['profit'] = $r['revenue'] - $r['cost'];
            $r['margin'] = self::pct($r['profit'], $r['revenue']);
            $r['share'] = self::pct($r['revenue'], $total);
            foreach (['products', 'units', 'revenue', 'cost', 'profit'] as $k) {
                $tot[$k] += $r[$k];
            }
        }
        unset($r);
        $tot['margin'] = self::pct($tot['profit'], $tot['revenue']);
        $columns = $this->cols([[$by, $type], ['products', 'int'], ['units', 'int'], ['revenue', 'iqd'], ['share', 'pct'], ['cost', 'iqd', true], ['profit', 'iqd', true], ['margin', 'pct', true]]);

        return $this->table($columns, collect($rows)->sortByDesc('revenue'), $tot);
    }

    /** Each cashier and delegate: bills, takings, discounts given, money handed back, and what their sales earned. */
    private function bySeller(int $from, int $to): array
    {
        $rows = [];
        foreach ($this->sales($from, $to)->get(['id', 'user_id', 'user_name', 'channel', 'total_iqd', 'item_discount_iqd', 'order_discount_iqd', 'points_redeemed_iqd']) as $s) {
            $k = $s->user_id.'|'.$s->channel;
            $r = &$rows[$k];
            $r ??= ['id' => $s->user_id, 'seller' => $s->user_name, 'channel' => $s->channel === 'delegate' ? 'delegate' : 'store', 'bills' => 0, 'units' => 0, 'revenue' => 0, 'discounts' => 0, 'refunds' => 0, 'cost' => 0];
            $r['bills']++;
            $r['revenue'] += (int) $s->total_iqd;
            $r['discounts'] += (int) $s->item_discount_iqd + (int) $s->order_discount_iqd + (int) $s->points_redeemed_iqd;
            unset($r);
        }
        // money handed back in the window, charged to whoever made the sale
        $refunds = $this->refunds($from, $to);
        $seller = DB::table('sales')->whereIn('id', $refunds->pluck('sale_id'))->get(['id', 'user_id', 'channel'])->keyBy('id');
        foreach ($refunds as $ret) {
            $s = $seller[$ret->sale_id] ?? null;
            $k = $s ? $s->user_id.'|'.$s->channel : null;
            if ($k && isset($rows[$k])) {
                $rows[$k]['refunds'] += (int) $ret->refund_iqd;
            }
        }
        foreach ($this->sales($from, $to)->join('sale_items', 'sale_items.sale_id', '=', 'sales.id')->get(['sales.user_id', 'sales.channel', 'sale_items.qty', 'sale_items.returned_qty', 'sale_items.unit_cost_iqd']) as $i) {
            $k = $i->user_id.'|'.$i->channel;
            $net = max(0, (int) $i->qty - (int) $i->returned_qty);
            $rows[$k]['units'] += $net;
            $rows[$k]['cost'] += $net * (int) $i->unit_cost_iqd;
        }
        $tot = ['bills' => 0, 'units' => 0, 'revenue' => 0, 'discounts' => 0, 'refunds' => 0, 'net' => 0, 'cost' => 0, 'profit' => 0];
        foreach ($rows as &$r) {
            $r['net'] = $r['revenue'] - $r['refunds'];
            $r['avg'] = $r['bills'] ? (int) round($r['revenue'] / $r['bills']) : 0;
            $r['profit'] = $r['net'] - $r['cost'];
            foreach (array_keys($tot) as $k) {
                $tot[$k] += $r[$k];
            }
        }
        unset($r);
        $tot['avg'] = $tot['bills'] ? (int) round($tot['revenue'] / $tot['bills']) : 0;
        $columns = $this->cols([['seller', 'text'], ['channel', 'enum:ap.channel_'], ['bills', 'int'], ['units', 'int'], ['revenue', 'iqd'], ['avg', 'iqd'], ['discounts', 'iqd'],
            ['refunds', 'iqd'], ['net', 'iqd'], ['cost', 'iqd', true], ['profit', 'iqd', true]]);

        return $this->table($columns, collect($rows)->sortByDesc('revenue'), $tot);
    }

    /* ───────── money ───────── */

    /** Sales − refunds = net sales; − cost of the bottles = gross profit; − every expense = net profit. */
    private function profitLoss(int $from, int $to): array
    {
        $revenue = (int) $this->sales($from, $to)->sum('total_iqd');
        $refunds = (int) $this->refunds($from, $to)->sum('refund_iqd');
        $cogs = (int) $this->sales($from, $to)->join('sale_items', 'sale_items.sale_id', '=', 'sales.id')->sum(DB::raw('sale_items.unit_cost_iqd * sale_items.qty'))
            - (int) $this->returnedCost($from, $to)->sum('cost');
        $net = $revenue - $refunds;
        $gross = $net - $cogs;
        $byCat = Expense::whereBetween('spent_at', [$from, $to])->selectRaw('category, coalesce(sum(amount_iqd), 0) as t')->groupBy('category')->pluck('t', 'category')->map(fn ($v) => (int) $v)->sortDesc();
        $delegates = $this->expenses->delegateExpenses($from, $to);
        $spent = $byCat->sum() + $delegates;
        $line = fn (string $item, int $amount, string $kind = 'line') => ['item' => $item, 'amount' => $amount, 'share' => self::pct($amount, $net), 'kind' => $kind];
        $rows = [
            $line('pl.sales', $revenue), $line('pl.refunds', -$refunds), $line('pl.net_sales', $net, 'subtotal'),
            $line('pl.cogs', -$cogs), $line('pl.gross_profit', $gross, 'subtotal'),
        ];
        foreach ($byCat as $cat => $amount) {
            $rows[] = $line('exp.cat_'.$cat, -$amount, 'expense');
        }
        if ($delegates) {
            $rows[] = $line('pl.delegate_expenses', -$delegates, 'expense');
        }
        $rows[] = $line('pl.expenses', -$spent, 'subtotal');
        $rows[] = $line('pl.net_profit', $gross - $spent, 'total');

        return $this->table($this->cols([['item', 'label'], ['amount', 'iqd'], ['share', 'pct']]), $rows, null, [
            ['label' => 'pl.net_sales', 'type' => 'iqd', 'value' => $net], ['label' => 'pl.gross_profit', 'type' => 'iqd', 'value' => $gross],
            ['label' => 'pl.expenses', 'type' => 'iqd', 'value' => $spent], ['label' => 'pl.net_profit', 'type' => 'iqd', 'value' => $gross - $spent],
        ]);
    }

    private function expenseList(int $from, int $to): array
    {
        $rows = Expense::whereBetween('spent_at', [$from, $to])->orderBy('spent_at')->get()->map(fn (Expense $e) => [
            'id' => $e->id, 'date' => $e->spent_at, 'category' => $e->category, 'note' => $e->note, 'method' => $e->method,
            'amount' => Money::out($e->amount), 'currency' => $e->currency, 'amountIQD' => $e->amount_iqd, 'by' => $e->user_name,
        ]);
        $columns = $this->cols([['date', 'date'], ['category', 'enum:exp.cat_'], ['note', 'text'], ['method', 'enum:pay.'], ['amount', 'money'], ['amountIQD', 'iqd'], ['by', 'text']]);

        return $this->table($columns, $rows, ['amountIQD' => (int) $rows->sum('amountIQD')], [
            ['label' => 'rc.amountIQD', 'type' => 'iqd', 'value' => (int) $rows->sum('amountIQD')],
            ['label' => 'pl.delegate_expenses', 'type' => 'iqd', 'value' => $this->expenses->delegateExpenses($from, $to)],
        ]);
    }

    /** Each delegate's sales after refunds, their percentage, and what they earned. */
    private function commission(int $from, int $to): array
    {
        $people = User::with('role')->where('active', true)->orderBy('name')->get()->filter(fn (User $u) => DelegateService::isDelegate($u));
        $sales = $this->sales($from, $to)->where('channel', 'delegate')->selectRaw('user_id, count(*) as n, coalesce(sum(total_iqd), 0) as t')->groupBy('user_id')->get()->keyBy('user_id');
        $refunds = DB::table('returns')->join('sales', 'sales.id', '=', 'returns.sale_id')->where('sales.channel', 'delegate')
            ->whereBetween('returns.occurred_at', [$from, $to])->where('returns.refund_method', '!=', 'store_credit')
            ->selectRaw('sales.user_id, coalesce(sum(returns.refund_iqd), 0) as t')->groupBy('sales.user_id')->pluck('t', 'user_id');
        $rows = $people->map(function (User $u) use ($sales, $refunds) {
            $gross = (int) ($sales[$u->id]->t ?? 0);
            $back = (int) ($refunds[$u->id] ?? 0);
            $pct = (float) $u->commission_pct;

            return ['id' => $u->id, 'delegate' => $u->name, 'bills' => (int) ($sales[$u->id]->n ?? 0), 'sales' => $gross, 'refunds' => $back, 'net' => $gross - $back,
                'rate' => round($pct, 2), 'commission' => (int) round(max(0, $gross - $back) * $pct / 100)];
        })->sortByDesc('net')->values();
        $tot = ['bills' => $rows->sum('bills'), 'sales' => $rows->sum('sales'), 'refunds' => $rows->sum('refunds'), 'net' => $rows->sum('net'), 'commission' => $rows->sum('commission')];
        $columns = $this->cols([['delegate', 'text'], ['bills', 'int'], ['sales', 'iqd'], ['refunds', 'iqd'], ['net', 'iqd'], ['rate', 'pct'], ['commission', 'iqd']]);

        return $this->table($columns, $rows, $tot);
    }

    /**
     * Every sale a delegate made: when, which shop and where (the phone's GPS when the bill was finished, else the
     * shop's saved spot), what was sold, and the bill in the currency it was made in (dollars, as a rule).
     */
    private function delegateSales(int $from, int $to): array
    {
        $sales = $this->sales($from, $to)->where('sales.channel', 'delegate')->leftJoin('customers', 'customers.id', '=', 'sales.customer_id')
            ->orderByDesc('sales.sold_at')
            ->get(['sales.id', 'sales.number', 'sales.sold_at', 'sales.user_name', 'sales.customer_name', 'sales.total_iqd', 'sales.due_iqd', 'sales.exchange_rate', 'sales.currency',
                'sales.lat', 'sales.lng', 'customers.city', 'customers.lat as shop_lat', 'customers.lng as shop_lng']);
        $lines = DB::table('sale_items')->whereIn('sale_id', $sales->pluck('id'))->orderBy('position')->get(['sale_id', 'name', 'label', 'qty'])->groupBy('sale_id');
        $usdIn = DB::table('sale_payments')->whereIn('sale_id', $sales->pluck('id'))->where('method', 'cash_usd')->sum('tendered');
        $rows = $sales->map(function ($s) use ($lines) {
            $items = ($lines[$s->id] ?? collect())->map(fn ($i) => ['name' => json_decode($i->name, true) ?: ['en' => (string) $i->name], 'label' => $i->label, 'qty' => (int) $i->qty])->values()->all();
            $usd = $s->currency === 'USD' && $s->exchange_rate > 0;
            [$lat, $lng] = $s->lat !== null ? [$s->lat, $s->lng] : [$s->shop_lat, $s->shop_lng];

            return [
                'id' => $s->id, 'date' => (int) $s->sold_at, 'number' => $s->number, 'delegate' => $s->user_name, 'soldTo' => $s->customer_name ?: null, 'area' => $s->city ?: null,
                'place' => $lat !== null && $lng !== null ? round((float) $lat, 6).','.round((float) $lng, 6) : null, 'sold' => $items,
                'units' => array_sum(array_column($items, 'qty')), 'amount' => $usd ? round($s->total_iqd / $s->exchange_rate, 2) : (int) $s->total_iqd, 'currency' => $usd ? 'USD' : 'IQD',
                'amountIQD' => (int) $s->total_iqd, 'debt' => (int) $s->due_iqd,
            ];
        });
        $columns = $this->cols([['date', 'datetime'], ['delegate', 'text'], ['soldTo', 'text'], ['area', 'text'], ['place', 'map'], ['sold', 'items'],
            ['units', 'int'], ['amount', 'money'], ['amountIQD', 'iqd'], ['debt', 'iqd'], ['number', 'text']]);

        return $this->table($columns, $rows, ['units' => $rows->sum('units'), 'amountIQD' => $rows->sum('amountIQD'), 'debt' => $rows->sum('debt')], [
            ['label' => 'rc.bills', 'type' => 'int', 'value' => $rows->count()],
            ['label' => 'rc.usd_received', 'type' => 'usd', 'value' => round((float) $usdIn, 2)],
            ['label' => 'rc.amountIQD', 'type' => 'iqd', 'value' => $rows->sum('amountIQD')],
            ['label' => 'rc.debt', 'type' => 'iqd', 'value' => $rows->sum('debt')],
        ]);
    }

    /**
     * Who owes the shop, and since when. Payments clear the oldest debt first, so what is still owed is the newest
     * credit sales: walk them from the newest back until they add up to the balance. Debt the sales do not explain
     * (an opening balance) counts as the oldest.
     */
    private function debtAging(): array
    {
        $now = Time::nowMs();
        $customers = DB::table('customers')->where('active', true)->where('balance_iqd', '>', 0)->orderByDesc('balance_iqd')->get(['id', 'name', 'phone', 'type', 'balance_iqd']);
        $credit = DB::table('sale_payments')->join('sales', 'sales.id', '=', 'sale_payments.sale_id')
            ->where('sale_payments.method', 'debt')->where('sales.status', '!=', 'voided')->whereIn('sales.customer_id', $customers->pluck('id'))
            ->orderByDesc('sales.sold_at')->get(['sales.customer_id', 'sales.sold_at', 'sale_payments.amount_iqd'])->groupBy('customer_id');
        $lastPaid = DB::table('collections')->whereIn('customer_id', $customers->pluck('id'))->selectRaw('customer_id, max(occurred_at) as at')->groupBy('customer_id')->pluck('at', 'customer_id');
        $buckets = ['age0' => 30, 'age31' => 60, 'age61' => 90];
        $rows = $customers->map(function ($c) use ($credit, $lastPaid, $now, $buckets) {
            $left = (int) $c->balance_iqd;
            $row = ['id' => $c->id, 'customer' => $c->name, 'phone' => $c->phone, 'type' => $c->type, 'balance' => $left, 'age0' => 0, 'age31' => 0, 'age61' => 0, 'age91' => 0,
                'lastPayment' => isset($lastPaid[$c->id]) ? (int) $lastPaid[$c->id] : null];
            foreach ($credit[$c->id] ?? [] as $debt) {
                if ($left <= 0) {
                    break;
                }
                $part = min($left, (int) $debt->amount_iqd);
                $days = intdiv($now - (int) $debt->sold_at, self::DAY_MS);
                $key = 'age91';
                foreach ($buckets as $k => $limit) {
                    if ($days <= $limit) {
                        $key = $k;
                        break;
                    }
                }
                $row[$key] += $part;
                $left -= $part;
            }
            $row['age91'] += max(0, $left);

            return $row;
        });
        $tot = ['balance' => $rows->sum('balance'), 'age0' => $rows->sum('age0'), 'age31' => $rows->sum('age31'), 'age61' => $rows->sum('age61'), 'age91' => $rows->sum('age91')];
        $columns = $this->cols([['customer', 'text'], ['phone', 'text'], ['type', 'enum:cust.type_'], ['balance', 'iqd'], ['age0', 'iqd'], ['age31', 'iqd'], ['age61', 'iqd'], ['age91', 'iqd'], ['lastPayment', 'date']]);

        return $this->table($columns, $rows, $tot);
    }

    /* ───────── stock ───────── */

    /** Every size: bottles in the shop and in the vans, and what they are worth at cost and at the shop price. */
    private function stockValuation(): array
    {
        $shop = $this->stock->map();
        $vans = DB::table('stock')->where('location_id', 'like', 'van:%')->selectRaw('variant_id, coalesce(sum(qty), 0) as q')->groupBy('variant_id')->pluck('q', 'variant_id');
        $rows = $this->variants()->map(function ($v) use ($shop, $vans) {
            $s = (int) ($shop[$v->id] ?? 0);
            $van = (int) ($vans[$v->id] ?? 0);
            $count = max(0, $s) + max(0, $van);

            return ['id' => $v->id, 'product' => json_decode($v->name, true), 'size' => $v->label, 'sku' => $v->sku, 'brand' => $v->brand, 'shop' => $s, 'vans' => $van, 'total' => $s + $van,
                'unitCost' => (int) $v->cost_iqd, 'costValue' => $count * (int) $v->cost_iqd, 'unitRetail' => (int) $v->retail_iqd, 'retailValue' => $count * (int) $v->retail_iqd];
        })->sortByDesc('costValue')->values();
        $tot = ['shop' => $rows->sum('shop'), 'vans' => $rows->sum('vans'), 'total' => $rows->sum('total'), 'costValue' => $rows->sum('costValue'), 'retailValue' => $rows->sum('retailValue')];
        $columns = $this->cols([['product', 'name'], ['size', 'text'], ['sku', 'text'], ['brand', 'text'], ['shop', 'int'], ['vans', 'int'], ['total', 'int'],
            ['unitCost', 'iqd'], ['costValue', 'iqd'], ['unitRetail', 'iqd'], ['retailValue', 'iqd']]);

        return $this->table($columns, $rows, $tot, [
            ['label' => 'rc.costValue', 'type' => 'iqd', 'value' => $tot['costValue']], ['label' => 'rc.retailValue', 'type' => 'iqd', 'value' => $tot['retailValue']],
            ['label' => 'rc.total', 'type' => 'int', 'value' => $tot['total']],
        ]);
    }

    /** Sizes in stock that sold fewer than two bottles in the window, the longest-idle first. */
    private function slowMovers(int $from, int $to): array
    {
        $now = Time::nowMs();
        $shop = $this->stock->map();
        $vans = DB::table('stock')->where('location_id', 'like', 'van:%')->selectRaw('variant_id, coalesce(sum(qty), 0) as q')->groupBy('variant_id')->pluck('q', 'variant_id');
        $sold = [];
        foreach ($this->items($from, $to) as $i) {
            $sold[$i->variant_id] = ($sold[$i->variant_id] ?? 0) + $i->net_qty;
        }
        $last = DB::table('sale_items')->join('sales', 'sales.id', '=', 'sale_items.sale_id')->where('sales.status', '!=', 'voided')
            ->selectRaw('sale_items.variant_id, max(sales.sold_at) as at')->groupBy('sale_items.variant_id')->pluck('at', 'variant_id');
        $rows = $this->variants()->map(function ($v) use ($shop, $vans, $sold, $last, $now) {
            $stock = max(0, (int) ($shop[$v->id] ?? 0)) + max(0, (int) ($vans[$v->id] ?? 0));
            $at = isset($last[$v->id]) ? (int) $last[$v->id] : null;

            return ['id' => $v->id, 'product' => json_decode($v->name, true), 'size' => $v->label, 'sku' => $v->sku, 'stock' => $stock, 'sold' => (int) ($sold[$v->id] ?? 0),
                'lastSold' => $at, 'idleDays' => $at ? intdiv($now - $at, self::DAY_MS) : null, 'costValue' => $stock * (int) $v->cost_iqd];
        })->filter(fn ($r) => $r['stock'] > 0 && $r['sold'] < 2)
            ->sortBy([['sold', 'asc'], [fn ($a, $b) => ($b['idleDays'] ?? PHP_INT_MAX) <=> ($a['idleDays'] ?? PHP_INT_MAX)]])->values();
        $columns = $this->cols([['product', 'name'], ['size', 'text'], ['sku', 'text'], ['stock', 'int'], ['sold', 'int'], ['lastSold', 'date'], ['idleDays', 'int'], ['costValue', 'iqd', true]]);

        return $this->table($columns, $rows, ['stock' => $rows->sum('stock'), 'sold' => $rows->sum('sold'), 'costValue' => $rows->sum('costValue')]);
    }

    /** Deliveries received from suppliers in the window. */
    private function purchases(int $from, int $to): array
    {
        $rows = DB::table('purchase_receipts')->join('purchase_orders', 'purchase_orders.id', '=', 'purchase_receipts.purchase_order_id')
            ->join('suppliers', 'suppliers.id', '=', 'purchase_receipts.supplier_id')
            ->whereBetween('purchase_receipts.received_at', [$from, $to])->orderBy('purchase_receipts.received_at')
            ->get(['purchase_receipts.id', 'purchase_receipts.received_at', 'purchase_orders.number', 'suppliers.name', 'purchase_receipts.currency',
                'purchase_receipts.total', 'purchase_receipts.total_iqd', 'purchase_receipts.user_name']);
        $units = DB::table('purchase_receipt_items')->whereIn('purchase_receipt_id', $rows->pluck('id'))->selectRaw('purchase_receipt_id, coalesce(sum(qty), 0) as q')->groupBy('purchase_receipt_id')->pluck('q', 'purchase_receipt_id');
        $rows = $rows->map(fn ($r) => ['id' => $r->id, 'date' => (int) $r->received_at, 'order' => $r->number, 'supplier' => $r->name, 'units' => (int) ($units[$r->id] ?? 0),
            'amount' => Money::out($r->total), 'currency' => $r->currency, 'amountIQD' => (int) $r->total_iqd, 'by' => $r->user_name]);
        $columns = $this->cols([['date', 'datetime'], ['order', 'text'], ['supplier', 'text'], ['units', 'int'], ['amount', 'money'], ['amountIQD', 'iqd'], ['by', 'text']]);

        return $this->table($columns, $rows, ['units' => $rows->sum('units'), 'amountIQD' => $rows->sum('amountIQD')]);
    }

    /* ───────── staff ───────── */

    /** Shifts opened in the window: the float, what was sold, the cash expected and counted, and the difference. */
    private function shiftList(int $from, int $to): array
    {
        $codes = DB::table('devices')->pluck('code', 'id');
        $rows = Shift::whereBetween('opened_at', [$from, $to])->orderBy('opened_at')->get()->map(function (Shift $s) use ($codes) {
            $t = $s->status === 'open' ? $this->shifts->totals($s) : ((array) ($s->totals ?? []));

            return ['id' => $s->id, 'cashier' => $s->user_name, 'till' => $codes[$s->device_id] ?? '', 'opened' => (int) $s->opened_at, 'closed' => $s->closed_at ? (int) $s->closed_at : null,
                'opening' => (int) $s->opening_iqd, 'sales' => (int) ($t['salesIQD'] ?? 0), 'expected' => (int) ($t['expectedIQD'] ?? 0),
                'counted' => $s->counted_iqd === null ? null : (int) $s->counted_iqd, 'difference' => $s->variance_iqd === null ? null : (int) $s->variance_iqd, 'status' => $s->status];
        });
        $columns = $this->cols([['cashier', 'text'], ['till', 'text'], ['opened', 'datetime'], ['closed', 'datetime'], ['opening', 'iqd'], ['sales', 'iqd'], ['expected', 'iqd'],
            ['counted', 'iqd'], ['difference', 'iqd'], ['status', 'enum:rx.shift_']]);

        return $this->table($columns, $rows, ['sales' => $rows->sum('sales'), 'difference' => $rows->sum('difference')]);
    }

    private function variants(): Collection
    {
        return DB::table('variants')->join('products', 'products.id', '=', 'variants.product_id')
            ->where('variants.active', true)->where('products.active', true)
            ->orderBy('products.brand')->orderBy('variants.sku')
            ->get(['variants.id', 'variants.label', 'variants.sku', 'variants.cost_iqd', 'variants.retail_iqd', 'products.name', 'products.brand']);
    }
}
