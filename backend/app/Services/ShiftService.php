<?php

namespace App\Services;

use App\Exceptions\AppException;
use App\Models\CashMovement;
use App\Models\Collection;
use App\Models\Device;
use App\Models\Sale;
use App\Models\SaleReturn;
use App\Models\Shift;
use App\Models\User;
use App\Services\Concerns\RequiresPermission;
use App\Support\Pricing;
use App\Support\Time;
use Illuminate\Support\Str;

/** Cash-drawer shifts: open with a float, record cash in/out, X (live) and Z (closed) reports, count & variance. */
class ShiftService
{
    use RequiresPermission;

    public function __construct(private AuditService $audit, private SettingsService $settings) {}

    public function openFor(string $userId): ?Shift
    {
        return Shift::where('user_id', $userId)->where('status', 'open')->first();
    }

    public function open(User $actor, int $openingIQD, float $openingUSD, ?Device $device, ?string $clientId = null, ?int $openedAt = null): Shift
    {
        $this->need($actor, 'shifts.open');
        if ($this->openFor($actor->id)) {
            throw new AppException('shift_already_open');
        }
        if ($openingIQD < 0 || $openingUSD < 0) {
            throw new AppException('invalid_amount');
        }
        $shift = Shift::create([
            'id' => $clientId ?? (string) Str::uuid7(), 'user_id' => $actor->id, 'user_name' => $actor->name, 'device_id' => $device?->id, 'status' => 'open',
            'opened_at' => $openedAt ?? Time::nowMs(), 'opening_iqd' => $openingIQD, 'opening_usd' => round($openingUSD, 2), 'note' => '',
        ]);
        $this->audit->log($actor, 'shift.open', 'shift', $shift->id, ['openingIQD' => $openingIQD, 'openingUSD' => $openingUSD]);

        return $shift;
    }

    public function addCashMovement(User $actor, string $type, int $amountIQD, string $reason, ?string $clientId = null, ?int $at = null): Shift
    {
        $this->need($actor, 'shifts.cash_movement');
        $shift = $this->openFor($actor->id) ?? throw new AppException('shift_required');
        if ($amountIQD <= 0) {
            throw new AppException('invalid_amount');
        }
        if (! in_array($type, ['in', 'out'], true) || trim($reason) === '') {
            throw new AppException('required_fields');
        }
        CashMovement::create(['id' => $clientId ?? (string) Str::uuid7(), 'shift_id' => $shift->id, 'type' => $type, 'amount_iqd' => $amountIQD, 'reason' => trim($reason), 'user_id' => $actor->id, 'occurred_at' => $at ?? Time::nowMs()]);
        $this->audit->log($actor, 'shift.cash_movement', 'shift', $shift->id, ['type' => $type, 'amount' => $amountIQD, 'reason' => $reason]);

        return $shift->load('movements');
    }

    /** Everything that happened in a shift, and what should be in the drawer. @return array<string, mixed> */
    public function totals(Shift $shift): array
    {
        $sales = Sale::with('payments')->where('shift_id', $shift->id)->get();
        $returns = SaleReturn::where('shift_id', $shift->id)->get();
        $collections = Collection::where('shift_id', $shift->id)->get();
        $shift->loadMissing('movements');

        $sales = $sales->where('status', '!=', 'voided');
        $byMethod = [];
        $cashTendered = 0;
        $change = 0;
        $cashUSD = 0.0;
        foreach ($sales as $s) {
            $change += $s->change_iqd;
            foreach ($s->payments as $p) {
                $byMethod[$p->method] = ($byMethod[$p->method] ?? 0) + $p->amount_iqd;
                if ($p->method === 'cash_iqd') {
                    $cashTendered += (int) round($p->tendered);
                }
                if ($p->method === 'cash_usd') {
                    $cashUSD += $p->tendered;
                }
            }
        }
        $collectedCash = $collections->where('method', 'cash_iqd')->sum('amount_iqd');
        foreach ($collections as $c) {
            $byMethod['collection_'.$c->method] = ($byMethod['collection_'.$c->method] ?? 0) + $c->amount_iqd;
        }
        $refunds = $returns->reject(fn ($r) => in_array($r->refund_method, ['store_credit', 'debt_reduction'], true))->sum('refund_iqd');
        $refundsCash = $returns->where('refund_method', 'cash_iqd')->sum('refund_iqd');
        $cashIn = $shift->movements->where('type', 'in')->sum('amount_iqd');
        $cashOut = $shift->movements->where('type', 'out')->sum('amount_iqd');
        $cashIQD = $cashTendered - $change;

        return [
            'salesCount' => $sales->count(),
            'salesIQD' => $sales->sum('total_iqd'),
            'byMethod' => (object) $byMethod,
            'cashIQD' => $cashIQD,
            'cashUSD' => $cashUSD,
            'refundsIQD' => $refunds,
            'collectionsIQD' => $collections->sum('amount_iqd'),
            'cashInIQD' => $cashIn,
            'cashOutIQD' => $cashOut,
            'expectedIQD' => $shift->opening_iqd + $cashIQD + $collectedCash + $cashIn - $cashOut - $refundsCash,
            'expectedUSD' => round($shift->opening_usd + $cashUSD, 2),
        ];
    }

    public function close(User $actor, int $countedIQD, float $countedUSD, string $note, ?string $shiftId = null, ?int $closedAt = null): Shift
    {
        $this->need($actor, 'shifts.close');
        $shift = ($shiftId ? Shift::find($shiftId) : $this->openFor($actor->id)) ?? throw new AppException('shift_required');
        if ($shift->status !== 'open') {
            throw new AppException('shift_closed');
        }
        if ($countedIQD < 0 || $countedUSD < 0) {
            throw new AppException('invalid_amount');
        }
        $rate = (int) $this->settings->get()['currency']['rate'];
        $totals = $this->totals($shift);
        $variance = $countedIQD - $totals['expectedIQD'] + Pricing::round(($countedUSD - $totals['expectedUSD']) * $rate);
        $shift->update([
            'status' => 'closed', 'closed_at' => $closedAt ?? Time::nowMs(), 'counted_iqd' => $countedIQD, 'counted_usd' => round($countedUSD, 2),
            'variance_iqd' => $variance, 'totals' => $totals, 'note' => trim($note),
        ]);
        $this->audit->log($actor, 'shift.close', 'shift', $shift->id, ['expectedIQD' => $totals['expectedIQD'], 'countedIQD' => $countedIQD, 'variance' => $variance]);

        return $shift->load('movements');
    }

    public function find(User $actor, string $id): Shift
    {
        $shift = Shift::with('movements')->find($id) ?? throw AppException::notFound();
        if ($shift->user_id !== $actor->id && ! $actor->can('shifts.view_all')) {
            throw AppException::forbidden('shifts.view_all');
        }

        return $shift;
    }

    /** @return \Illuminate\Support\Collection<int, Shift> */
    public function list(User $actor, int $limit = 100)
    {
        return Shift::with('movements')->when(! $actor->can('shifts.view_all'), fn ($q) => $q->where('user_id', $actor->id))
            ->orderByDesc('opened_at')->limit($limit)->get();
    }
}
