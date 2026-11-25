<?php

namespace App\Services\Assistant;

use App\Exceptions\AppException;
use App\Models\Customer;
use App\Models\User;
use App\Services\CatalogService;
use App\Services\Catalogue\OrderService;
use App\Services\CustomerService;
use App\Services\DashboardService;
use App\Services\DebtService;
use App\Services\DelegateService;
use App\Services\ExpenseService;
use App\Services\ReportCenter;
use App\Support\Time;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

/**
 * What the admin panel's assistant may look at. Every tool only READS, and runs as the person asking: the same
 * services and permission checks as the screens, so the assistant never shows anyone more than their own screens
 * would. A refusal comes back to the model as an error it explains, not as an exception.
 */
class AssistantTools
{
    /** keep each tool result well inside the model's context (characters of JSON) */
    private const MAX_RESULT_CHARS = 60_000;

    private const DATE = ['type' => 'string', 'description' => 'A day in the shop\'s calendar, YYYY-MM-DD.'];

    public function __construct(
        private DashboardService $dashboard,
        private ReportCenter $reports,
        private DebtService $debts,
        private ExpenseService $expenses,
        private CatalogService $catalog,
        private CustomerService $customers,
        private DelegateService $delegates,
        private OrderService $wholesale,
    ) {}

    /**
     * The tool definitions sent to the model. Kept in a fixed order so the request prefix (and its cache) never changes.
     *
     * @return array<int, array<string, mixed>>
     */
    public function definitions(): array
    {
        $object = fn (array $props, array $required = []) => ['type' => 'object', 'properties' => (object) $props, 'required' => $required, 'additionalProperties' => false];

        return [
            [
                'name' => 'get_overview',
                'description' => 'The dashboard for a period ending now: sales (total, paid at the counter, sold on debt), refunds, profit, bills, '
                    .'bottles, shop vs delegates, takings per hour/day, the 5 best-selling perfumes, low stock, delegates\' sales, who owes the shop, '
                    .'what the shop owes suppliers, expenses, and what needs attention. Each part is null when the person may not see it. '
                    .'Also returns the same figures for the period just before, to compare. Use this first for "how are we doing" questions.',
                'inputSchema' => $object(['period' => ['type' => 'string', 'enum' => array_keys(DashboardService::PERIODS), 'description' => 'today (since midnight), week (last 7 days) or month (last 30 days).']], ['period']),
            ],
            [
                'name' => 'run_report',
                'description' => 'Runs one of the shop\'s reports for any dates (the same reports as Admin → Reports). Rows come back as objects keyed by the '
                    .'report\'s column keys, with totals and a summary. Reports: sales-by-day, sales-by-product (best/worst sellers, profit per size), '
                    .'sales-by-brand, sales-by-category, sales-by-seller (each cashier and delegate), profit-loss (net profit after cost and expenses), '
                    .'expenses, delegate-commission, delegate-sales (every delegate bill with place), debt-aging (who owes and since when), '
                    .'debt-movements (debt sales, collections, returns off debt), supplier-balances (what the shop owes each supplier), '
                    .'supplier-movements, missing-cost (sizes sold without a cost price, which makes profit wrong), stock-valuation (stock value at '
                    .'cost and retail), slow-movers (sizes that barely sell), purchases (deliveries from suppliers), shifts (cash counted vs expected). '
                    .'"As of now" reports (debt-aging, supplier-balances, stock-valuation) ignore the dates.',
                'inputSchema' => $object([
                    'report' => ['type' => 'string', 'enum' => array_keys(ReportCenter::REPORTS)],
                    'from' => self::DATE + ['description' => 'First day, YYYY-MM-DD (shop calendar).'],
                    'to' => self::DATE + ['description' => 'Last day, YYYY-MM-DD, included.'],
                ], ['report', 'from', 'to']),
            ],
            [
                'name' => 'get_debts',
                'description' => 'Debts both ways: every customer who owes the shop (balance, limit, how old the debt is, last payment) and every supplier the '
                    .'shop owes (in their currency and in dinars), the period\'s debt sales, collections, deliveries and payments, the net position, and '
                    .'the latest debt movements.',
                'inputSchema' => $object(['period' => ['type' => 'string', 'enum' => array_keys(DebtService::PERIODS), 'description' => 'today, week (7 days), month (30 days) or quarter (90 days), ending now.']], ['period']),
            ],
            [
                'name' => 'get_expenses',
                'description' => 'Shop expenses between two days: the total, each category\'s total, the delegates\' road expenses, and the entries themselves '
                    .'(latest first). Use from 2000-01-01 for "everything ever recorded".',
                'inputSchema' => $object(['from' => self::DATE, 'to' => self::DATE], ['from', 'to']),
            ],
            [
                'name' => 'find_products',
                'description' => 'Looks up perfumes by name, brand, SKU or barcode (leave query empty to list all): each size with its shop price, wholesale '
                    .'prices, cost (when the person may see costs), stock on the shop shelf and its low-stock alert level.',
                'inputSchema' => $object(['query' => ['type' => 'string', 'description' => 'Part of a name, brand, SKU or barcode. Empty for every perfume.']], ['query']),
            ],
            [
                'name' => 'find_customers',
                'description' => 'Looks up the shop\'s customers by name or phone (or lists those who owe money): balance owed, credit limit, type, city, '
                    .'points. When exactly one customer matches, also returns their recent account statement (debt sales, payments, returns).',
                'inputSchema' => $object([
                    'query' => ['type' => 'string', 'description' => 'Part of a name or phone number. Empty to list customers.'],
                    'owing_only' => ['type' => 'boolean', 'description' => 'Only customers who owe money, the most owed first.'],
                ], ['query', 'owing_only']),
            ],
            [
                'name' => 'get_delegates',
                'description' => 'The field-sales delegates. Without a name: every delegate today (sales, collections, visits, stock in their van and its '
                    .'value, open stock requests, closings to approve, last seen). With a name: that delegate\'s figures between two days (sales, '
                    .'debt, collections, bottles, the shops they sold to).',
                'inputSchema' => $object([
                    'name' => ['type' => 'string', 'description' => 'Part of a delegate\'s name, or empty for all delegates today.'],
                    'from' => self::DATE + ['description' => 'With a name: first day (YYYY-MM-DD). Ignored without a name.'],
                    'to' => self::DATE + ['description' => 'With a name: last day (YYYY-MM-DD).'],
                ], ['name', 'from', 'to']),
            ],
            [
                'name' => 'get_wholesale_orders',
                'description' => 'Orders that shops abroad placed in the wholesale catalogue: number, business, country, status (pending_approval, '
                    .'approved, rejected, cancelled…), payment status, bottles, amount and currency, when placed.',
                'inputSchema' => $object([
                    'status' => ['type' => 'string', 'description' => 'Only orders in this status, or empty for all.'],
                    'query' => ['type' => 'string', 'description' => 'Part of a business name or order number, or empty.'],
                ], ['status', 'query']),
            ],
        ];
    }

    /**
     * Runs one tool for `$actor`. Returns the JSON text for the tool_result and whether it is an error.
     *
     * @param  array<string, mixed>  $input
     * @return array{0: string, 1: bool}
     */
    public function run(User $actor, string $name, array $input): array
    {
        try {
            $out = match ($name) {
                'get_overview' => $this->overview($actor, $input),
                'run_report' => $this->report($actor, $input),
                'get_debts' => $this->debtsOverview($actor, $input),
                'get_expenses' => $this->expenseList($actor, $input),
                'find_products' => $this->products($actor, $input),
                'find_customers' => $this->customerList($actor, $input),
                'get_delegates' => $this->delegateFigures($actor, $input),
                'get_wholesale_orders' => $this->wholesaleOrders($actor, $input),
                default => throw new AppException('validation', ['field' => 'tool']),
            };

            return [$this->encode($out), false];
        } catch (AppException $e) {
            $why = $e->errorCode === 'forbidden'
                ? 'This person is not allowed to see this (missing permission: '.($e->params['permission'] ?? '?').'). Tell them so; do not guess the figures.'
                : 'The request could not be answered: '.$e->errorCode.($e->params ? ' '.json_encode($e->params) : '');

            return [$why, true];
        } catch (\Illuminate\Database\Eloquent\ModelNotFoundException) {
            return ['Nothing was found for that.', true];
        }
    }

    /* ───────── the tools ───────── */

    private function overview(User $actor, array $in): array
    {
        $d = $this->dashboard->get($actor, $this->oneOf($in['period'] ?? '', array_keys(DashboardService::PERIODS)));
        unset($d['series']['unit']);
        $d['topProducts'] = array_map(fn ($p) => ['name' => $p['name']['en'] ?? '', 'brand' => $p['brand'], 'units' => $p['units'], 'revenueIQD' => $p['revenueIQD']], $d['topProducts']);

        return ['window' => $this->window($d['from'], $d['to'])] + $d;
    }

    private function report(User $actor, array $in): array
    {
        [$from, $to] = $this->days($in);
        $r = $this->reports->run($actor, $this->oneOf($in['report'] ?? '', array_keys(ReportCenter::REPORTS)), $from, $to);
        $rows = $r['rows'];
        $out = [
            'report' => $r['type'], 'window' => $this->window($r['from'], $r['to']), 'columns' => array_column($r['columns'], 'type', 'key'),
            'summary' => $r['summary'], 'totals' => $r['totals'], 'rowCount' => count($rows),
            'rows' => array_slice($rows, 0, 300),
        ];
        if (count($rows) > 300) {
            $out['note'] = 'Only the first 300 rows are included (in the report\'s own order); the totals cover all of them.';
        }

        return $out;
    }

    private function debtsOverview(User $actor, array $in): array
    {
        $d = $this->debts->overview($actor, $this->oneOf($in['period'] ?? '', array_keys(DebtService::PERIODS)));
        foreach (['receivable', 'payable'] as $side) {
            if ($d[$side] && count($d[$side]['rows']) > 100) {
                $d[$side]['rows'] = array_slice($d[$side]['rows'], 0, 100);
                $d[$side]['note'] = 'Only the 100 largest balances are listed; the totals cover everyone.';
            }
        }
        unset($d['series']);

        return ['window' => $this->window($d['from'], $d['to'])] + $d;
    }

    private function expenseList(User $actor, array $in): array
    {
        [$from, $to] = $this->days($in);
        $l = $this->expenses->list($actor, $from, $to);
        $rows = array_map(fn ($e) => ['date' => Time::at($e['spentAt'])->format('Y-m-d'), 'category' => $e['category'], 'amount' => $e['amount'], 'currency' => $e['currency'],
            'amountIQD' => $e['amountIQD'], 'method' => $e['method'], 'note' => $e['note'], 'by' => $e['userName']], array_slice($l['expenses'], 0, 150));

        return ['window' => $this->window($from, $to), 'totalIQD' => $l['totalIQD'], 'count' => $l['count'], 'delegateRoadExpensesIQD' => $l['delegateIQD'],
            'byCategory' => $l['byCategory'], 'latest' => $rows] + ($l['count'] > count($rows) ? ['note' => 'Only the latest '.count($rows).' entries are listed; the totals cover all.'] : []);
    }

    private function products(User $actor, array $in): array
    {
        $q = Str::lower(trim((string) ($in['query'] ?? '')));
        $cost = $actor->can('reports.financial');
        $match = $this->catalog->list($actor)->filter(function ($p) use ($q) {
            if ($q === '') {
                return true;
            }
            $hay = Str::lower(implode(' ', [...array_values((array) $p->name), $p->brand, ...$p->variants->pluck('sku')->all(), ...$p->variants->pluck('barcode')->all()]));

            return str_contains($hay, $q);
        })->values();

        $rows = $match->take(60)->map(fn ($p) => [
            'name' => $p->name['en'] ?? '', 'nameAr' => $p->name['ar'] ?? '', 'brand' => $p->brand, 'category' => $p->category, 'gender' => $p->gender,
            'sizes' => $p->variants->map(fn ($v) => array_filter([
                'size' => $v->label, 'sku' => $v->sku, 'shopPriceIQD' => $v->retail_iqd, 'wholesaleIQD' => $v->wholesale_iqd,
                'wholesaleUSD' => $v->wholesale_usd_cents ? round($v->wholesale_usd_cents / 100, 2) : null,
                'costIQD' => $cost ? $v->cost_iqd : null, 'shopStock' => (int) $v->getAttribute('stock_qty'), 'lowStockAlertAt' => $v->min_stock,
            ], fn ($x) => $x !== null))->values()->all(),
        ])->all();

        return ['matches' => $match->count(), 'products' => $rows] + ($match->count() > 60 ? ['note' => 'Only the first 60 matches are listed; ask for a narrower search.'] : []);
    }

    private function customerList(User $actor, array $in): array
    {
        if (! $actor->can('customers.view')) {
            throw AppException::forbidden('customers.view');
        }
        $q = trim((string) ($in['query'] ?? ''));
        $digits = preg_replace('/\D/', '', $q);
        $list = Customer::where('active', true)
            ->when($in['owing_only'] ?? false, fn ($b) => $b->where('balance_iqd', '>', 0))
            ->when($q !== '', function ($b) use ($q, $digits) {
                $like = '%'.str_replace(['%', '_'], ['\%', '\_'], $q).'%';
                $b->where(fn ($w) => $w->where('name', 'like', $like)->when(strlen($digits) >= 3, fn ($w2) => $w2->orWhereRaw("replace(phone, ' ', '') like ?", ['%'.$digits.'%'])));
            })
            ->orderByDesc('balance_iqd')->orderBy('name')->limit(50)->get();

        $out = ['count' => $list->count(), 'customers' => $list->map(fn (Customer $c) => [
            'name' => $c->name, 'phone' => $c->phone, 'type' => $c->type, 'city' => $c->city, 'owesIQD' => $c->balance_iqd, 'creditLimitIQD' => $c->credit_limit_iqd, 'points' => $c->points,
        ])->all()];
        if ($list->count() === 1) {
            $st = $this->customers->statement($actor, $list[0]->id);
            $out['statement'] = array_map(fn ($r) => ['date' => Time::at($r['at'])->format('Y-m-d'), 'kind' => $r['kind'], 'ref' => $r['ref'], 'amountIQD' => $r['amountIQD'], 'note' => $r['note']],
                array_slice($st['rows'], 0, 30));
            $out['spentIQD'] = (int) $st['sales']->where('status', '!=', 'voided')->sum('total_iqd');
        }

        return $out;
    }

    private function delegateFigures(User $actor, array $in): array
    {
        $name = Str::lower(trim((string) ($in['name'] ?? '')));
        $all = $this->delegates->overview($actor);
        if ($name === '') {
            return ['today' => Time::at(Time::nowMs())->format('Y-m-d'), 'delegates' => array_map(fn ($d) => array_diff_key($d, array_flip(['id', 'color'])), $all)];
        }
        $found = array_values(array_filter($all, fn ($d) => str_contains(Str::lower($d['name']), $name)));
        if (count($found) !== 1) {
            return ['note' => count($found) ? 'More than one delegate matches; ask which one.' : 'No delegate has that name.', 'delegates' => array_column($all, 'name')];
        }
        [$from, $to] = $this->days($in);
        $d = $this->delegates->dashboard($actor, $found[0]['id'], $from, $to);

        return ['delegate' => $found[0]['name'], 'window' => $this->window($from, $to)] + $d;
    }

    private function wholesaleOrders(User $actor, array $in): array
    {
        $orders = $this->wholesale->list($actor, array_filter(['status' => trim((string) ($in['status'] ?? '')), 'q' => trim((string) ($in['query'] ?? '')), 'limit' => 100]));

        return ['count' => $orders->count(), 'orders' => $orders->map(fn ($o) => [
            'number' => 'LAT-'.$o->number, 'business' => $o->business_name, 'country' => $o->country ? ((array) $o->country->name)['en'] ?? $o->country->iso2 : null, 'status' => $o->status, 'payment' => $o->payment_status,
            'bottles' => $o->units, 'amount' => round($o->subtotal_cents / 100, 2), 'paid' => round($o->paid_cents / 100, 2), 'currency' => $o->currency,
            'placed' => Time::at((int) $o->placed_at)->format('Y-m-d H:i'),
        ])->all()];
    }

    /* ───────── helpers ───────── */

    /** "from"/"to" days (YYYY-MM-DD, shop calendar) → the first and last millisecond. */
    private function days(array $in): array
    {
        $day = function (string $key) use ($in): Carbon {
            $v = (string) ($in[$key] ?? '');
            if (! preg_match('/^\d{4}-\d{2}-\d{2}$/', $v)) {
                throw new AppException('validation', ['field' => $key, 'expected' => 'YYYY-MM-DD']);
            }

            return Carbon::createFromFormat('Y-m-d', $v, config('app.timezone'))->startOfDay();
        };
        [$a, $b] = [$day('from'), $day('to')];
        if ($b->lt($a)) {
            [$a, $b] = [$b, $a];
        }

        return [(int) $a->getTimestampMs(), (int) $b->copy()->addDay()->getTimestampMs() - 1];
    }

    private function oneOf(string $v, array $allowed): string
    {
        return in_array($v, $allowed, true) ? $v : throw new AppException('validation', ['allowed' => implode(', ', $allowed)]);
    }

    private function window(int $from, int $to): string
    {
        return Time::at($from)->format('Y-m-d H:i').' → '.Time::at($to)->format('Y-m-d H:i');
    }

    private function encode(array $out): string
    {
        $json = json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR);

        return mb_strlen($json) > self::MAX_RESULT_CHARS
            ? mb_substr($json, 0, self::MAX_RESULT_CHARS).' …[cut: too long — ask a narrower question]'
            : $json;
    }
}
