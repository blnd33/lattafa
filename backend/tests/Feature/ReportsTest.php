<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Variant;
use Illuminate\Support\Facades\DB;
use Tests\ApiTestCase;

/** Admin panel → Reports: every report in one table shape, adding up to what was sold, and only what a person may see. */
class ReportsTest extends ApiTestCase
{
    private function report(string $type, array $q = []): array
    {
        return $this->api('GET', "reports/table/$type".($q ? '?'.http_build_query($q) : ''))->assertOk()->json();
    }

    private function row(array $report, string $key, mixed $value): ?array
    {
        return collect($report['rows'])->firstWhere($key, $value);
    }

    /** Today: two Khamrah for cash (one comes back), one Asad on credit to Al-Noor, and an expense. */
    private function day(): array
    {
        $this->shop();
        $kh = $this->variantOf('Khamrah');
        $asad = $this->variantOf('Asad');
        $noor = $this->customerNamed('Al-Noor Perfumes'); // owes 350,000 from before (no sales behind it)
        $cashier = $this->cashierWithShift();
        $cash = $this->checkout($kh, 2, [['method' => 'cash_iqd', 'tendered' => 2 * $kh->retail_iqd]])->assertCreated()->json('sale');
        $credit = $this->checkout($asad, 1, [['method' => 'debt', 'tendered' => $asad->retail_iqd]], ['customerId' => $noor->id])->assertCreated()->json('sale');
        $this->api('POST', 'returns', ['saleId' => $cash['id'], 'lines' => [['saleItemIndex' => 0, 'qty' => 1, 'restock' => true]], 'refundMethod' => 'cash_iqd'])->assertCreated();
        $this->asOwner();
        $this->api('POST', 'expenses', ['category' => 'rent', 'amount' => 100000, 'currency' => 'IQD'])->assertCreated();

        return compact('kh', 'asad', 'noor', 'cashier', 'cash', 'credit');
    }

    public function test_the_sales_reports_add_up(): void
    {
        ['kh' => $kh, 'asad' => $asad, 'cash' => $cash, 'credit' => $credit] = $this->day();
        $revenue = $cash['totalIQD'] + $credit['totalIQD'];
        $refund = $kh->retail_iqd;
        $cost = 2 * $kh->cost_iqd + $asad->cost_iqd - $kh->cost_iqd; // what is still sold

        $d = $this->report('sales-by-day');
        $today = $d['rows'][0];
        $this->assertSame([2, 3, $revenue, $refund, $revenue - $refund], [$today['bills'], $today['units'], $today['revenue'], $today['refunds'], $today['net']]);
        $this->assertSame([$cost, $revenue - $refund - $cost], [$today['cost'], $today['profit']]);
        $this->assertSame($d['totals']['net'], array_sum(array_column($d['rows'], 'net')));
        $this->assertContains('profit', array_column($d['columns'], 'key'));

        $p = $this->report('sales-by-product');
        $row = $this->row($p, 'sku', $kh->sku);
        $this->assertSame([1, 1, $kh->retail_iqd, $kh->cost_iqd], [$row['units'], $row['returned'], $row['revenue'], $row['cost']]); // two sold, one back
        $this->assertSame('Khamrah', $row['product']['en']);
        $this->assertSame($kh->retail_iqd + $asad->retail_iqd, $p['totals']['revenue']);
        $this->assertSame($p['rows'][0]['revenue'], max(array_column($p['rows'], 'revenue'))); // biggest first

        $b = $this->report('sales-by-brand');
        $this->assertSame(['Lattafa', 2, 100.0], [$b['rows'][0]['brand'], $b['rows'][0]['products'], (float) $b['rows'][0]['share']]);
        $this->assertSame('perfume', $this->report('sales-by-category')['rows'][0]['category']);

        $s = $this->report('sales-by-seller');
        $till = $this->row($s, 'seller', 'Till');
        $this->assertSame(['store', 2, $revenue, $refund, $revenue - $refund], [$till['channel'], $till['bills'], $till['revenue'], $till['refunds'], $till['net']]);

        $pl = $this->report('profit-loss');
        $lines = collect($pl['rows'])->keyBy('item');
        $this->assertSame([$revenue, -$refund, $revenue - $refund], [$lines['pl.sales']['amount'], $lines['pl.refunds']['amount'], $lines['pl.net_sales']['amount']]);
        $this->assertSame(-100000, $lines['exp.cat_rent']['amount']);
        $this->assertSame($revenue - $refund - $cost - 100000, $lines['pl.net_profit']['amount']);
        $this->assertSame('total', $lines['pl.net_profit']['kind']);

        // nothing from yesterday
        $y = $this->report('sales-by-day', ['from' => $d['from'] - 86_400_000, 'to' => $d['from'] - 1]);
        $this->assertSame(0, $y['totals']['bills']);
    }

    public function test_money_stock_and_people_reports(): void
    {
        ['kh' => $kh, 'noor' => $noor, 'credit' => $credit] = $this->day();

        // debt aging: today's credit sale is new; the 350,000 from before has no sale behind it, so it counts as the oldest
        $a = $this->row($this->report('debt-aging'), 'customer', 'Al-Noor Perfumes');
        $this->assertSame([$noor->fresh()->balance_iqd, $credit['dueIQD'], 0, 0, 350000], [$a['balance'], $a['age0'], $a['age31'], $a['age61'], $a['age91']]);

        // stock value adds up every size, at cost and at the shop price
        $sv = $this->report('stock-valuation');
        $expected = 0;
        foreach (Variant::where('active', true)->get() as $v) {
            $expected += max(0, $this->stockOf($v)) * $v->cost_iqd;
        }
        $this->assertSame($expected, $sv['totals']['costValue']);
        $this->assertSame($expected, collect($sv['summary'])->firstWhere('label', 'rc.costValue')['value']);

        // slow sellers: in stock, under two sold in the window — Khamrah sold one after its return, Yara none at all
        $slow = $this->report('slow-movers');
        $this->assertNotNull($this->row($slow, 'sku', $this->variantOf('Yara')->sku));
        $this->assertSame(1, $this->row($slow, 'sku', $kh->sku)['sold']);

        // delegate commission: set the percentage, it is applied to sales after refunds
        $ahmed = $this->makeUser('Ahmed', 'ahmed', 'delegate', '5151');
        $this->api('PUT', "delegates/$ahmed/commission", ['pct' => 5])->assertOk();
        $c = $this->row($this->report('delegate-commission'), 'delegate', 'Ahmed');
        $this->assertSame([5.0, 0], [(float) $c['rate'], $c['commission']]);
        DB::table('sales')->where('user_name', 'Till')->update(['user_id' => $ahmed, 'channel' => 'delegate']); // as if Ahmed had sold today's bills
        $c = $this->row($this->report('delegate-commission'), 'delegate', 'Ahmed');
        $this->assertSame((int) round($c['net'] * 0.05), $c['commission']);
        $this->assertSame(1, AuditLog::where('action', 'delegate.commission')->count());
        $this->api('PUT', "delegates/$ahmed/commission", ['pct' => 120])->assertStatus(422);

        // the cashier's shift is still open: its figures are worked out live
        $sh = $this->report('shifts')['rows'][0];
        $this->assertSame(['Till', 'open', null], [$sh['cashier'], $sh['status'], $sh['closed']]);
        $this->assertSame(50000, $sh['opening']);

        $this->assertSame(100000, $this->report('expenses')['totals']['amountIQD']);
        $this->assertSame([], $this->report('purchases')['rows']);
    }

    public function test_people_see_only_the_reports_and_columns_they_may(): void
    {
        $this->day();
        $role = $this->api('POST', 'roles', ['name' => 'Viewer', 'description' => '', 'permissions' => ['reports.view'], 'apps' => ['admin']])->assertCreated()->json('role.id');
        $viewer = $this->makeUser('Lana', 'lana', 'cashier', '4242', ['roleId' => $role]);
        $this->asUser($viewer, '4242');

        $p = $this->report('sales-by-product');
        $this->assertFalse($p['financial']);
        $this->assertSame([], array_intersect(['cost', 'profit', 'margin'], array_column($p['columns'], 'key')));
        $this->assertArrayNotHasKey('cost', $p['rows'][0]);
        $this->assertArrayNotHasKey('profit', $p['totals']);
        $this->api('GET', 'reports/table/profit-loss')->assertStatus(403)->assertJsonPath('error.params.permission', 'reports.financial');
        $this->api('GET', 'reports/table/stock-valuation')->assertStatus(403);
        $this->api('GET', 'reports/table/debt-aging')->assertStatus(403);
        $this->api('GET', 'reports/table/no-such-report')->assertNotFound();
        $this->api('PUT', 'delegates/'.\Illuminate\Support\Str::uuid().'/commission', ['pct' => 5])->assertStatus(403);
    }
}
