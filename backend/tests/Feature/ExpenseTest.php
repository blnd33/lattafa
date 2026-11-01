<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Support\Time;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\ApiTestCase;

/** What the shop spends, in dinars or dollars, by month and category. */
class ExpenseTest extends ApiTestCase
{
    public function test_expenses_add_up_by_month_and_category(): void
    {
        $this->shop(false);
        $now = Time::nowMs();
        $monthStart = (int) Time::at($now)->startOfMonth()->getTimestampMs();

        $rent = $this->api('POST', 'expenses', ['category' => 'rent', 'amount' => 500, 'currency' => 'USD', 'rate' => 1480, 'note' => 'October rent', 'method' => 'bank', 'spentAt' => $now])
            ->assertCreated()->json('expense');
        $this->assertSame([500.0, 'USD', 740000, 'Owner'], [(float) $rent['amount'], $rent['currency'], $rent['amountIQD'], $rent['userName']]);
        $gen = $this->api('POST', 'expenses', ['category' => 'electricity', 'amount' => 125000.6, 'currency' => 'IQD', 'note' => 'Generator', 'spentAt' => $now])->assertCreated()->json('expense');
        $this->assertSame(125001, $gen['amountIQD']); // whole dinars
        $this->api('POST', 'expenses', ['category' => 'salaries', 'amount' => 600000, 'currency' => 'IQD', 'spentAt' => $monthStart - 86_400_000])->assertCreated(); // last month
        // a delegate's road expenses come with their closing: approved ones count, others do not
        foreach (['approved' => 15000, 'submitted' => 99000] as $status => $amount) {
            DB::table('delegate_closings')->insert(['id' => (string) Str::uuid(), 'user_id' => (string) Str::uuid(), 'user_name' => 'Ahmed', 'day' => Time::at($now)->format('Y-m-d'),
                'expenses_iqd' => $amount, 'status' => $status, 'occurred_at' => $now, 'created_at' => now(), 'updated_at' => now()]);
        }

        $m = $this->api('GET', 'expenses')->assertOk()->json(); // this month
        $this->assertCount(2, $m['expenses']);
        $this->assertSame(740000 + 125001, $m['totalIQD']);
        $this->assertSame(['rent', 'electricity'], array_column($m['byCategory'], 'category'));
        $this->assertSame(15000, $m['delegateIQD']);
        $this->assertCount(3, $this->api('GET', 'expenses?from='.($monthStart - 40 * 86_400_000)."&to=$now")->json('expenses'));
        $this->assertSame([740000], array_column($this->api('GET', 'expenses?category=rent')->json('byCategory'), 'amountIQD'));

        // the dashboard's period counts both
        $this->assertSame(740000 + 125001 + 15000, $this->api('GET', 'dashboard?period=today')->json('expensesIQD'));

        // corrected, then removed — both in the activity log
        $this->assertSame(130000, $this->api('PUT', "expenses/{$gen['id']}", ['category' => 'electricity', 'amount' => 130000, 'currency' => 'IQD', 'spentAt' => $now])->assertOk()->json('expense.amountIQD'));
        $this->api('DELETE', "expenses/{$gen['id']}")->assertOk();
        $this->assertSame(740000, $this->api('GET', 'expenses')->json('totalIQD'));
        $this->assertEqualsCanonicalizing(['expense.create', 'expense.update', 'expense.delete'], AuditLog::where('entity_id', $gen['id'])->pluck('action')->all());

        $this->api('POST', 'expenses', ['category' => 'party', 'amount' => 5, 'currency' => 'IQD'])->assertStatus(422);
        $this->api('POST', 'expenses', ['category' => 'rent', 'amount' => 0, 'currency' => 'IQD'])->assertStatus(422);
        $this->api('DELETE', 'expenses/'.Str::uuid())->assertNotFound();
    }

    public function test_only_people_allowed_see_or_change_expenses(): void
    {
        $this->shop(false);
        $role = $this->api('POST', 'roles', ['name' => 'Accountant', 'description' => '', 'permissions' => ['expenses.view', 'reports.view'], 'apps' => ['admin']])->assertCreated()->json('role.id');
        $acc = $this->makeUser('Dara', 'dara', 'cashier', '4646', ['roleId' => $role]);
        $this->asUser($acc, '4646');
        $this->api('GET', 'expenses')->assertOk();
        $this->api('POST', 'expenses', ['category' => 'rent', 'amount' => 5, 'currency' => 'IQD'])->assertStatus(403)->assertJsonPath('error.params.permission', 'expenses.manage');
        $this->assertNull($this->api('GET', 'dashboard')->json('suppliers')); // no purchasing permission

        $this->asOwner();
        $this->cashierWithShift();
        $this->api('GET', 'expenses')->assertStatus(403);
    }
}
