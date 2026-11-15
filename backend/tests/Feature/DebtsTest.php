<?php

namespace Tests\Feature;

use Tests\ApiTestCase;

/** Admin panel → Debts: what customers owe the shop and what the shop owes its suppliers, apart from the sales figures. */
class DebtsTest extends ApiTestCase
{
    /** Today: one Asad sold on debt to Al-Noor (who already owed 350,000), 50,000 paid back, a dollar supplier delivered and was part-paid. */
    private function day(): array
    {
        $this->shop();
        $asad = $this->variantOf('Asad');
        $kh = $this->variantOf('Khamrah');
        $noor = $this->customerNamed('Al-Noor Perfumes');
        $this->cashierWithShift();
        $this->checkout($kh, 1, [['method' => 'cash_iqd', 'tendered' => $kh->retail_iqd]])->assertCreated();
        $credit = $this->checkout($asad, 1, [['method' => 'debt', 'tendered' => $asad->retail_iqd]], ['customerId' => $noor->id])->assertCreated()->json('sale');
        $this->api('POST', "customers/{$noor->id}/collect", ['amountIQD' => 50000, 'method' => 'cash_iqd', 'note' => 'part'])->assertSuccessful();

        $this->asOwner();
        $sup = $this->api('POST', 'suppliers', ['name' => 'Dubai Perfume House', 'currency' => 'USD'])->assertCreated()->json('supplier.id');
        $this->api('POST', 'purchase-orders', ['supplierId' => $sup, 'rate' => 1500, 'receiveNow' => true, 'lines' => [['variantId' => $kh->id, 'qty' => 10, 'unitCost' => 20]]])->assertCreated();
        $this->api('POST', "suppliers/$sup/payments", ['amount' => 80, 'method' => 'bank', 'rate' => 1500])->assertCreated();

        return compact('asad', 'kh', 'noor', 'credit', 'sup');
    }

    public function test_the_debts_screen_shows_both_sides(): void
    {
        ['noor' => $noor, 'credit' => $credit] = $this->day();
        $rate = (int) $this->api('GET', 'settings')->json('settings.currency.rate');
        $d = $this->api('GET', 'debts?period=today')->assertOk()->json();

        // customers → the shop
        $r = $d['receivable'];
        $this->assertSame($noor->fresh()->balance_iqd, collect($r['rows'])->firstWhere('name', 'Al-Noor Perfumes')['balanceIQD']);
        $this->assertSame((int) collect($r['rows'])->sum('balanceIQD'), $r['totalIQD']);
        $this->assertSame([$credit['dueIQD'], 1, 50000, 1], [$r['givenIQD'], $r['givenCount'], $r['collectedIQD'], $r['collectedCount']]);
        $this->assertSame($r['totalIQD'], array_sum($r['aging']));

        // the shop → suppliers: $200 received, $80 paid, $120 left
        $p = $d['payable'];
        $this->assertSame([120.0, 1, 200 * 1500, 80 * 1500], [(float) $p['owedUSD'], $p['suppliers'], $p['boughtIQD'], $p['paidIQD']]);
        $this->assertSame(120 * $rate, $p['totalIQD']);
        $this->assertSame($r['totalIQD'] - $p['totalIQD'], $d['netIQD']);

        // the day's movements, newest first, and the chart adds up to the same
        $kinds = array_column($d['activity'], 'kind');
        $this->assertEqualsCanonicalizing(['debt_sale', 'collection', 'purchase', 'supplier_payment'], $kinds);
        $this->assertSame($r['givenIQD'], array_sum(array_column($d['series']['points'], 'givenIQD')));
        $this->assertSame($p['paidIQD'], array_sum(array_column($d['series']['points'], 'paidIQD')));

        $this->api('GET', 'debts?period=year')->assertStatus(422);
    }

    public function test_the_dashboard_keeps_debt_apart_from_what_was_paid(): void
    {
        ['kh' => $kh, 'credit' => $credit] = $this->day();
        $t = $this->api('GET', 'dashboard?period=today')->assertOk()->json('totals');
        $this->assertSame($kh->retail_iqd + $credit['totalIQD'], $t['revenueIQD']);
        $this->assertSame([$credit['dueIQD'], $t['revenueIQD'] - $credit['dueIQD'], 50000], [$t['creditIQD'], $t['paidIQD'], $t['collectedIQD']]);
    }

    public function test_the_debt_reports(): void
    {
        ['credit' => $credit] = $this->day();
        $m = $this->api('GET', 'reports/table/debt-movements')->assertOk()->json();
        $this->assertSame(['debt_sale', 'collection'], array_column($m['rows'], 'movement'));
        $this->assertSame($credit['dueIQD'] - 50000, $m['totals']['amountIQD']);
        $this->assertSame('method.cash_iqd', $m['rows'][1]['method']);

        $s = $this->api('GET', 'reports/table/supplier-movements')->assertOk()->json();
        $this->assertSame(['purchase', 'supplier_payment'], array_column($s['rows'], 'movement'));
        $this->assertSame([200.0, 'USD'], [(float) $s['rows'][0]['added'], $s['rows'][0]['currency']]);

        $b = $this->api('GET', 'reports/table/supplier-balances')->assertOk()->json();
        $row = collect($b['rows'])->firstWhere('supplier', 'Dubai Perfume House');
        $this->assertSame([200.0, 80.0, 120.0], [(float) $row['received'], (float) $row['paid'], (float) $row['left']]);
    }

    public function test_each_side_is_shown_only_to_those_who_may_see_it(): void
    {
        $this->day();
        $role = $this->api('POST', 'roles', ['name' => 'Collector', 'description' => '', 'permissions' => ['customers.view'], 'apps' => ['admin']])->assertCreated()->json('role.id');
        $u = $this->makeUser('Lana', 'lana', 'cashier', '4242', ['roleId' => $role]);
        $none = $this->api('POST', 'roles', ['name' => 'Viewer', 'description' => '', 'permissions' => ['reports.view'], 'apps' => ['admin']])->assertCreated()->json('role.id');
        $viewer = $this->makeUser('Dara', 'dara', 'cashier', '4343', ['roleId' => $none]);

        $this->asUser($viewer, '4343');
        $this->api('GET', 'debts')->assertStatus(403);

        $this->asUser($u, '4242');
        $d = $this->api('GET', 'debts')->assertOk()->json();
        $this->assertNotNull($d['receivable']);
        $this->assertNull($d['payable']);
        $this->assertNull($d['netIQD']);
        $this->assertSame(['customer'], array_values(array_unique(array_column($d['activity'], 'side'))));
        $this->api('GET', 'reports/table/supplier-balances')->assertStatus(403);
    }
}
