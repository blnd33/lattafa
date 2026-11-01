<?php

namespace App\Services;

use App\Exceptions\AppException;
use App\Http\Resources\Present;
use App\Models\Expense;
use App\Models\User;
use App\Services\Concerns\RequiresPermission;
use App\Support\Money;
use App\Support\Time;
use Illuminate\Support\Facades\DB;

/**
 * What the shop spends to run: rent, salaries, the generator… In dinars or dollars (with the day's rate), each kept with
 * its value in dinars so a period adds up in one currency.
 *
 * Delegates' road expenses are not entered here: they come with their daily closing. The period summary shows the
 * approved ones beside the shop's, so nothing is counted twice.
 */
class ExpenseService
{
    use RequiresPermission;

    public const CATEGORIES = ['rent', 'salaries', 'electricity', 'internet', 'transport', 'marketing', 'packaging', 'maintenance', 'food', 'fees', 'other'];

    public const METHODS = ['cash', 'bank', 'other'];

    public function __construct(private AuditService $audit, private SettingsService $settings) {}

    /** @return array<string, mixed> the expenses between two moments, their total and each category's share */
    public function list(User $actor, int $from, int $to, ?string $category = null): array
    {
        $this->need($actor, 'expenses.view');
        $rows = Expense::whereBetween('spent_at', [$from, $to])->when($category, fn ($q) => $q->where('category', $category))
            ->orderByDesc('spent_at')->orderByDesc('created_at')->limit(2000)->get();
        $by = [];
        foreach ($rows as $e) {
            $by[$e->category] = ['category' => $e->category, 'amountIQD' => ($by[$e->category]['amountIQD'] ?? 0) + $e->amount_iqd, 'count' => ($by[$e->category]['count'] ?? 0) + 1];
        }
        usort($by, fn ($a, $b) => $b['amountIQD'] <=> $a['amountIQD']);

        return [
            'from' => $from, 'to' => $to,
            'expenses' => $rows->map(fn (Expense $e) => Present::expense($e))->values()->all(),
            'totalIQD' => (int) $rows->sum('amount_iqd'),
            'byCategory' => array_values($by),
            'delegateIQD' => $category ? 0 : $this->delegateExpenses($from, $to),
        ];
    }

    /** Spent in a window, in dinars (the dashboard). */
    public function totalIQD(int $from, int $to): int
    {
        return (int) Expense::whereBetween('spent_at', [$from, $to])->sum('amount_iqd');
    }

    /** Road expenses from delegates' approved daily closings in the window. */
    public function delegateExpenses(int $from, int $to): int
    {
        return (int) DB::table('delegate_closings')->where('status', 'approved')
            ->whereBetween('day', [Time::at($from)->format('Y-m-d'), Time::at($to)->format('Y-m-d')])->sum('expenses_iqd');
    }

    /** @param array<string, mixed> $in {id?, category, amount, currency, rate?, method?, note?, spentAt?} */
    public function save(User $actor, array $in): Expense
    {
        $this->need($actor, 'expenses.manage');
        $category = (string) ($in['category'] ?? '');
        $currency = (string) ($in['currency'] ?? 'IQD');
        $method = (string) ($in['method'] ?? 'cash');
        if (! in_array($category, self::CATEGORIES, true) || ! in_array($currency, Money::CURRENCIES, true) || ! in_array($method, self::METHODS, true)) {
            throw new AppException('validation');
        }
        $cents = Money::cents($in['amount'] ?? 0, $currency);
        if ($cents <= 0) {
            throw new AppException('invalid_amount');
        }
        $rate = $currency === 'USD' && ! empty($in['rate']) ? (int) $in['rate'] : (int) $this->settings->get()['currency']['rate'];
        if ($rate < 1) {
            throw new AppException('validation');
        }
        $data = [
            'category' => $category, 'amount' => Money::decimal($cents), 'currency' => $currency, 'rate' => $rate,
            'amount_iqd' => Money::iqd($cents, $currency, $rate), 'method' => $method, 'note' => trim((string) ($in['note'] ?? '')),
            'spent_at' => (int) ($in['spentAt'] ?? Time::nowMs()),
        ];
        if (! empty($in['id'])) {
            $e = Expense::find($in['id']) ?? throw AppException::notFound();
            $before = ['amountIQD' => $e->amount_iqd, 'category' => $e->category];
            $e->update($data);
            $this->audit->log($actor, 'expense.update', 'expense', $e->id, ['before' => $before, 'amountIQD' => $e->amount_iqd, 'category' => $category]);

            return $e;
        }
        $e = Expense::create($data + ['user_id' => $actor->id, 'user_name' => $actor->name]);
        $this->audit->log($actor, 'expense.create', 'expense', $e->id, ['category' => $category, 'amount' => Money::out($e->amount), 'currency' => $currency, 'amountIQD' => $e->amount_iqd]);

        return $e;
    }

    /** Entered by mistake. The activity log keeps what it was. */
    public function delete(User $actor, string $id): void
    {
        $this->need($actor, 'expenses.manage');
        $e = Expense::find($id) ?? throw AppException::notFound();
        $e->delete();
        $this->audit->log($actor, 'expense.delete', 'expense', $e->id, ['category' => $e->category, 'amount' => Money::out($e->amount), 'currency' => $e->currency, 'spentAt' => $e->spent_at]);
    }
}
