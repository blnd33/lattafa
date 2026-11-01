<?php

namespace App\Services;

use App\Exceptions\AppException;
use App\Models\Collection;
use App\Models\Customer;
use App\Models\Sale;
use App\Models\SaleReturn;
use App\Models\Shift;
use App\Models\User;
use App\Services\Concerns\RequiresPermission;
use App\Support\Time;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/** Customers: shops, regulars and wholesale buyers — with balances (debt) and loyalty points. */
class CustomerService
{
    use RequiresPermission;

    public function __construct(private AuditService $audit, private SettingsService $settings) {}

    /** @return \Illuminate\Support\Collection<int, Customer> */
    public function list(User $actor)
    {
        $this->need($actor, 'customers.view');

        return Customer::where('active', true)->orderBy('name')->get();
    }

    public function find(User $actor, string $id): Customer
    {
        $this->need($actor, 'customers.view');

        return Customer::find($id) ?? throw AppException::notFound();
    }

    /** @param array{id?: string|null, name: string, phone?: string, type?: string, city?: string, notes?: string, creditLimitIQD?: int} $in */
    public function save(User $actor, array $in): Customer
    {
        $isNew = empty($in['id']);
        $this->need($actor, $isNew ? 'customers.create' : 'customers.edit');
        $name = trim($in['name']);
        if ($name === '') {
            throw new AppException('required_fields');
        }
        $phone = trim($in['phone'] ?? '');
        if ($phone !== '') {
            $dup = Customer::where('phone', $phone)->where('active', true)->when(! $isNew, fn ($q) => $q->where('id', '!=', $in['id']))->first();
            if ($dup) {
                throw new AppException('phone_taken', ['name' => $dup->name]);
            }
        }
        $type = in_array($in['type'] ?? 'retail', ['retail', 'shop', 'wholesale'], true) ? ($in['type'] ?? 'retail') : 'retail';

        if (! $isNew) {
            $c = Customer::find($in['id']) ?? throw AppException::notFound();
            $limit = $c->credit_limit_iqd;
            if (array_key_exists('creditLimitIQD', $in) && (int) $in['creditLimitIQD'] !== $c->credit_limit_iqd) {
                $this->need($actor, 'customers.credit');
                $limit = max(0, (int) $in['creditLimitIQD']);
            }
            $c->update(['name' => $name, 'phone' => $phone, 'type' => $type, 'city' => trim($in['city'] ?? ''), 'notes' => trim($in['notes'] ?? ''), 'credit_limit_iqd' => $limit]);
            $this->audit->log($actor, 'customer.update', 'customer', $c->id, ['name' => $name]);

            return $c;
        }

        $default = (int) $this->settings->get()['sales']['defaultCustomerCreditIQD'];
        $c = Customer::create([
            'id' => $in['clientId'] ?? (string) Str::uuid7(), 'name' => $name, 'phone' => $phone, 'type' => $type, 'city' => trim($in['city'] ?? ''), 'notes' => trim($in['notes'] ?? ''),
            'balance_iqd' => 0, 'credit_limit_iqd' => max(0, (int) ($in['creditLimitIQD'] ?? 0)) ?: $default, 'points' => 0, 'active' => true,
            'lat' => isset($in['lat']) ? (float) $in['lat'] : null, 'lng' => isset($in['lng']) ? (float) $in['lng'] : null,
        ]);
        $this->audit->log($actor, 'customer.create', 'customer', $c->id, ['name' => $name]);

        return $c;
    }

    public function delete(User $actor, string $id): void
    {
        $this->need($actor, 'customers.delete');
        $c = Customer::find($id) ?? throw AppException::notFound();
        if ($c->balance_iqd > 0) {
            throw new AppException('customer_has_debt');
        }
        $c->update(['active' => false]);
        $this->audit->log($actor, 'customer.delete', 'customer', $id, ['name' => $c->name]);
    }

    /** Money received against a customer's outstanding balance. */
    /**
     * Money against a customer's balance. `amountIQD` is what comes off the balance; for dollars (`cash_usd`) pass
     * `tenderedUSD` — the notes actually handed over — and the `rate` used, so the dollar cash can be counted later.
     */
    public function collect(User $actor, string $customerId, int $amountIQD, string $method, string $note, ?string $clientId = null, ?int $occurredAt = null, ?string $shiftId = null, bool $enforce = true, ?float $tenderedUSD = null, ?int $rate = null): Collection
    {
        if ($enforce) {
            $this->need($actor, 'customers.collect');
        }
        if ($amountIQD <= 0) {
            throw new AppException('invalid_amount');
        }

        $usd = $method === 'cash_usd';
        if ($usd && ! ($tenderedUSD > 0)) {
            throw new AppException('invalid_amount');
        }
        $rate = $usd ? ($rate ?: (int) $this->settings->get()['currency']['rate']) : null;

        return DB::transaction(function () use ($actor, $customerId, $amountIQD, $method, $note, $clientId, $occurredAt, $shiftId, $enforce, $usd, $tenderedUSD, $rate) {
            if ($clientId && ($existing = Collection::find($clientId))) {
                return $existing; // idempotent (offline retry)
            }
            $c = Customer::lockForUpdate()->find($customerId) ?? throw AppException::notFound();
            if ($enforce && $amountIQD > $c->balance_iqd) {
                throw new AppException('overpayment', ['balance' => $c->balance_iqd]);
            }
            $shift = $shiftId ? Shift::find($shiftId) : Shift::where('user_id', $actor->id)->where('status', 'open')->first();
            $row = Collection::create([
                'id' => $clientId ?? (string) Str::uuid7(), 'customer_id' => $c->id, 'amount_iqd' => $amountIQD, 'method' => $method,
                'shift_id' => $shift?->id, 'user_id' => $actor->id, 'note' => $note, 'occurred_at' => $occurredAt ?? Time::nowMs(),
                'tendered' => $usd ? round((float) $tenderedUSD, 2) : $amountIQD, 'currency' => $usd ? 'USD' : 'IQD', 'rate' => $rate,
            ]);
            $c->update(['balance_iqd' => max(0, $c->balance_iqd - $amountIQD)]);
            $this->audit->log($actor, 'customer.collect', 'customer', $c->id, ['amount' => $amountIQD, 'method' => $method] + ($usd ? ['usd' => round((float) $tenderedUSD, 2)] : []), null, $occurredAt);

            return $row;
        });
    }

    /**
     * @return array{rows: array<int, array{id: string, at: int, kind: string, ref: string, amountIQD: int, note: string}>, sales: \Illuminate\Support\Collection<int, Sale>}
     */
    public function statement(User $actor, string $customerId): array
    {
        $this->need($actor, 'customers.view');
        $sales = Sale::with(['items', 'payments'])->where('customer_id', $customerId)->orderByDesc('sold_at')->get();
        $saleIds = $sales->pluck('id');
        $rows = [];
        foreach ($sales->where('status', '!=', 'voided') as $s) {
            $rows[] = ['id' => $s->id, 'at' => $s->sold_at, 'kind' => 'sale', 'ref' => $s->number, 'amountIQD' => $s->due_iqd, 'note' => ''];
        }
        foreach (Collection::where('customer_id', $customerId)->get() as $c) {
            $rows[] = ['id' => $c->id, 'at' => $c->occurred_at, 'kind' => 'payment', 'ref' => '', 'amountIQD' => -$c->amount_iqd, 'note' => $c->note];
        }
        foreach (SaleReturn::whereIn('sale_id', $saleIds)->where('refund_method', 'debt_reduction')->get() as $r) {
            $rows[] = ['id' => $r->id, 'at' => $r->occurred_at, 'kind' => 'return', 'ref' => $r->number, 'amountIQD' => -$r->refund_iqd, 'note' => ''];
        }
        usort($rows, fn ($a, $b) => $b['at'] <=> $a['at']);

        return ['rows' => $rows, 'sales' => $sales];
    }
}
