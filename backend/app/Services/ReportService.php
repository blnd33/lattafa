<?php

namespace App\Services;

use App\Exceptions\AppException;
use App\Models\Customer;
use App\Models\Sale;
use App\Models\SaleReturn;
use App\Models\User;
use App\Models\Variant;
use App\Support\Time;

/** Sales, payments, products and stock at a glance. Profit/cost are only visible with `reports.financial`. */
class ReportService
{
    public function __construct(private StockService $stock) {}

    /** @return array<string, mixed> */
    public function sales(User $actor, int $from, int $to, ?string $userId = null): array
    {
        if (! $actor->can('reports.view')) {
            throw AppException::forbidden('reports.view');
        }
        $financial = $actor->can('reports.financial');
        $sales = Sale::with('items')->where('status', '!=', 'voided')->whereBetween('sold_at', [$from, $to])->when($userId, fn ($q) => $q->where('user_id', $userId))->get();
        $ids = $sales->pluck('id')->all();
        $returns = SaleReturn::with('items')->whereBetween('occurred_at', [$from, $to])->whereIn('sale_id', $ids)->get();
        $byId = $sales->keyBy('id');

        $days = $hours = $cashiers = $methods = $products = $brands = [];
        $revenue = $discount = $units = $cost = 0;
        foreach ($sales as $s) {
            $revenue += $s->total_iqd;
            $discount += $s->item_discount_iqd + $s->order_discount_iqd + $s->points_redeemed_iqd;
            $d = Time::at($s->sold_at);
            $dk = $d->format('Y-m-d');
            $days[$dk] = ['day' => $dk, 'count' => ($days[$dk]['count'] ?? 0) + 1, 'revenueIQD' => ($days[$dk]['revenueIQD'] ?? 0) + $s->total_iqd];
            $hr = (int) $d->format('G');
            $hours[$hr] = ['hour' => $hr, 'count' => ($hours[$hr]['count'] ?? 0) + 1, 'revenueIQD' => ($hours[$hr]['revenueIQD'] ?? 0) + $s->total_iqd];
            $cashiers[$s->user_id] = ['userId' => $s->user_id, 'name' => $s->user_name, 'count' => ($cashiers[$s->user_id]['count'] ?? 0) + 1, 'revenueIQD' => ($cashiers[$s->user_id]['revenueIQD'] ?? 0) + $s->total_iqd];
            foreach ($s->payments()->get() as $p) {
                $methods[$p->method] = ($methods[$p->method] ?? 0) + $p->amount_iqd;
            }
            foreach ($s->items as $it) {
                $units += $it->qty;
                $cost += $it->unit_cost_iqd * $it->qty;
                $name = $it->name['en'] ?: ($it->name['ar'] ?: ($it->name['ku'] ?? ''));
                $products[$it->product_id] = ['productId' => $it->product_id, 'name' => $name, 'units' => ($products[$it->product_id]['units'] ?? 0) + $it->qty, 'revenueIQD' => ($products[$it->product_id]['revenueIQD'] ?? 0) + $it->line_total_iqd];
                $brands[$it->brand] = ['brand' => $it->brand, 'units' => ($brands[$it->brand]['units'] ?? 0) + $it->qty, 'revenueIQD' => ($brands[$it->brand]['revenueIQD'] ?? 0) + $it->line_total_iqd];
            }
        }
        $refunds = $returns->where('refund_method', '!=', 'store_credit')->sum('refund_iqd');
        $returnedCost = 0;
        foreach ($returns as $r) {
            foreach ($r->items as $ri) {
                $returnedCost += ($byId[$r->sale_id]->items[$ri->sale_item_index]->unit_cost_iqd ?? 0) * $ri->qty;
            }
        }
        $net = $revenue - $refunds;
        $sortDesc = fn (array $rows, string $k) => array_values(collect($rows)->sortByDesc($k)->all());

        return [
            'from' => $from, 'to' => $to, 'count' => $sales->count(), 'revenueIQD' => $revenue, 'discountIQD' => $discount, 'refundsIQD' => $refunds, 'netIQD' => $net,
            'avgBasketIQD' => $sales->count() ? (int) round($revenue / $sales->count()) : 0, 'unitsSold' => $units,
            'costIQD' => $financial ? $cost - $returnedCost : null,
            'profitIQD' => $financial ? $net - ($cost - $returnedCost) : null,
            'byDay' => array_values(collect($days)->sortBy('day')->all()),
            'byHour' => array_values(collect($hours)->sortBy('hour')->all()),
            'byCashier' => $sortDesc($cashiers, 'revenueIQD'),
            'byMethod' => array_values(collect($methods)->map(fn ($v, $k) => ['method' => $k, 'amountIQD' => $v])->sortByDesc('amountIQD')->all()),
            'topProducts' => array_slice($sortDesc($products, 'revenueIQD'), 0, 10),
            'byBrand' => $sortDesc($brands, 'revenueIQD'),
        ];
    }

    /** @return array{costIQD: int, retailIQD: int, units: int} */
    public function stockValuation(User $actor): array
    {
        if (! $actor->can('reports.financial')) {
            throw AppException::forbidden('reports.financial');
        }
        $stock = $this->stock->map();
        $cost = $retail = $units = 0;
        foreach (Variant::all() as $v) {
            $q = max(0, $stock[$v->id] ?? 0);
            $cost += $q * $v->cost_iqd;
            $retail += $q * $v->retail_iqd;
            $units += $q;
        }

        return ['costIQD' => $cost, 'retailIQD' => $retail, 'units' => $units];
    }

    public function debtors(User $actor)
    {
        if (! $actor->can('customers.view')) {
            throw AppException::forbidden('customers.view');
        }

        return Customer::where('active', true)->where('balance_iqd', '>', 0)->orderByDesc('balance_iqd')->get();
    }
}
