<?php

namespace App\Services;

use App\Exceptions\AppException;
use App\Models\Collection;
use App\Models\Customer;
use App\Models\DelegateClosing;
use App\Models\DelegateLocation;
use App\Models\Sale;
use App\Models\SaleItem;
use App\Models\SalePayment;
use App\Models\SaleReturn;
use App\Models\StockRequest;
use App\Models\User;
use App\Models\Variant;
use App\Models\Visit;
use App\Services\Concerns\RequiresPermission;
use App\Support\Time;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Field sales. A delegate sells from their own van — a stock location `van:<user id>` — which a manager loads from
 * the shop's stock. Delegates also log visits, ask for more stock, and hand over a daily closing that a manager approves.
 */
class DelegateService
{
    use RequiresPermission;

    public function __construct(private StockService $stock, private AuditService $audit) {}

    public static function van(string $userId): string
    {
        return 'van:'.$userId;
    }

    /** Someone who works a van: their role opens the delegate app and lets them sell from it (the Super Admin can do anything but has no van). */
    public static function isDelegate(User $u): bool
    {
        $u->loadMissing('role');

        return ! $u->isSuperAdmin() && in_array('delegate', $u->role->apps ?? [], true) && $u->can('delegate.sell');
    }

    private function delegateOrFail(string $id): User
    {
        $u = User::with('role')->find($id);
        if (! $u || ! self::isDelegate($u)) {
            throw AppException::notFound();
        }

        return $u;
    }

    /** The delegate themself, or a manager. */
    private function canSee(User $actor, string $delegateId): void
    {
        if ($actor->id !== $delegateId) {
            $this->need($actor, 'delegates.manage');
        }
    }

    /* ───────────────────────── overview & van stock ───────────────────────── */

    /** @return array<int, array<string, mixed>> one row per delegate, for the manager's screen */
    public function overview(User $actor): array
    {
        $this->need($actor, 'delegates.manage');
        [$from, $to] = [Time::startOfDayMs(), Time::endOfDayMs()];

        return User::with('role')->orderBy('name')->get()->filter(fn (User $u) => self::isDelegate($u))->map(function (User $u) use ($from, $to) {
            $van = $this->vanRows($u->id);
            $sales = Sale::where('user_id', $u->id)->where('channel', 'delegate')->where('status', '!=', 'voided')->whereBetween('sold_at', [$from, $to]);

            return [
                'id' => $u->id, 'name' => $u->name, 'color' => $u->color, 'active' => $u->active, 'lastLoginAt' => $u->last_login_at,
                'vanUnits' => array_sum(array_column($van, 'qty')),
                'vanValueIQD' => array_sum(array_map(fn ($r) => $r['qty'] * $r['wholesaleIQD'], $van)),
                'todaySalesIQD' => (int) (clone $sales)->sum('total_iqd'), 'todaySalesCount' => (clone $sales)->count(),
                'todayCollectionsIQD' => (int) Collection::where('user_id', $u->id)->whereBetween('occurred_at', [$from, $to])->sum('amount_iqd'),
                'todayVisits' => Visit::where('user_id', $u->id)->whereBetween('occurred_at', [$from, $to])->count(),
                'openRequests' => StockRequest::where('user_id', $u->id)->where('status', 'open')->count(),
                'pendingClosings' => DelegateClosing::where('user_id', $u->id)->where('status', 'submitted')->count(),
                'lastLocation' => $this->lastLocation($u->id),
            ];
        })->values()->all();
    }

    /** @return array<int, array<string, mixed>> */
    public function vanStock(User $actor, string $delegateId): array
    {
        $this->canSee($actor, $delegateId);
        $this->delegateOrFail($delegateId);

        return $this->vanRows($delegateId);
    }

    /** @return array<int, array{variantId: string, productId: string, name: mixed, brand: string, label: string, sku: string, qty: int, wholesaleIQD: int, retailIQD: int}> */
    private function vanRows(string $delegateId): array
    {
        $qty = $this->stock->map(self::van($delegateId));
        if (! $qty) {
            return [];
        }

        return Variant::with('product')->whereIn('id', array_keys($qty))->get()
            ->map(fn (Variant $v) => [
                'variantId' => $v->id, 'productId' => $v->product_id, 'name' => $v->product->name, 'brand' => $v->product->brand,
                'label' => $v->label, 'sku' => $v->sku, 'qty' => $qty[$v->id] ?? 0, 'wholesaleIQD' => $v->wholesale_iqd, 'retailIQD' => $v->retail_iqd,
            ])
            ->filter(fn ($r) => $r['qty'] !== 0)
            ->sortBy(fn ($r) => Str::lower($r['name']['en'] ?? ''))->values()->all();
    }

    /**
     * Shop → van. Each line is two movements (`transfer_out` at the shop, `transfer_in` in the van) so both balances explain themselves.
     *
     * @param array<int, array{variantId: string, qty: int}> $items
     */
    public function load(User $actor, string $delegateId, array $items, string $note = '', ?string $requestId = null): array
    {
        $this->need($actor, 'delegates.manage');
        $d = $this->delegateOrFail($delegateId);

        return $this->transfer($actor, $items, StockService::LOCATION, self::van($d->id), 'van_load', $note, function () use ($requestId, $actor, $d) {
            if ($requestId && ($r = StockRequest::where('user_id', $d->id)->find($requestId)) && $r->status === 'open') {
                $r->update(['status' => 'fulfilled', 'handled_by' => $actor->id, 'handled_at' => Time::nowMs()]);
            }
        });
    }

    /** Van → shop (unsold stock brought back). @param array<int, array{variantId: string, qty: int}> $items */
    public function unload(User $actor, string $delegateId, array $items, string $note = ''): array
    {
        $this->need($actor, 'delegates.manage');
        $d = $this->delegateOrFail($delegateId);

        return $this->transfer($actor, $items, self::van($d->id), StockService::LOCATION, 'van_unload', $note);
    }

    private function transfer(User $actor, array $items, string $from, string $to, string $kind, string $note, ?callable $after = null): array
    {
        $items = array_values(array_filter($items, fn ($i) => (int) ($i['qty'] ?? 0) > 0));
        if (! $items) {
            throw new AppException('invalid_quantity');
        }

        return DB::transaction(function () use ($actor, $items, $from, $to, $kind, $note, $after) {
            $ref = (string) Str::uuid7();
            foreach ($items as $it) {
                if (! Variant::whereKey($it['variantId'])->exists()) {
                    throw new AppException('product_unavailable');
                }
                $q = (int) $it['qty'];
                $this->stock->applyMovement($it['variantId'], -$q, 'transfer_out', $actor, ['refType' => $kind, 'refId' => $ref, 'note' => $note, 'locationId' => $from]);
                $this->stock->applyMovement($it['variantId'], $q, 'transfer_in', $actor, ['refType' => $kind, 'refId' => $ref, 'note' => $note, 'locationId' => $to]);
            }
            if ($after) {
                $after();
            }
            $this->audit->log($actor, 'delegate.'.$kind, 'location', $kind === 'van_load' ? $to : $from, ['lines' => count($items), 'units' => array_sum(array_column($items, 'qty'))]);

            return ['ref' => $ref, 'lines' => count($items), 'units' => (int) array_sum(array_column($items, 'qty'))];
        });
    }

    /* ───────────────────────── stock requests ───────────────────────── */

    /** @param array<int, array{variantId: string, qty: int}> $items */
    public function createRequest(User $actor, array $items, string $note = '', ?string $id = null, ?int $at = null): StockRequest
    {
        $this->need($actor, 'delegate.request_stock');
        if ($id && ($existing = StockRequest::find($id))) {
            return $existing; // offline retry
        }
        $items = array_values(array_map(fn ($i) => ['variantId' => (string) $i['variantId'], 'qty' => (int) $i['qty']], array_filter($items, fn ($i) => (int) ($i['qty'] ?? 0) > 0)));
        if (! $items) {
            throw new AppException('invalid_quantity');
        }
        $r = StockRequest::create([
            'id' => $id ?? (string) Str::uuid7(), 'user_id' => $actor->id, 'user_name' => $actor->name, 'items' => $items,
            'note' => trim($note), 'status' => 'open', 'occurred_at' => $at ?? Time::nowMs(),
        ]);
        $this->audit->log($actor, 'delegate.request_stock', 'stock_request', $r->id, ['lines' => count($items)]);

        return $r;
    }

    public function requests(User $actor, ?string $status = null)
    {
        $all = $actor->can('delegates.manage');
        if (! $all) {
            $this->need($actor, 'delegate.request_stock');
        }

        return StockRequest::query()->when(! $all, fn ($q) => $q->where('user_id', $actor->id))
            ->when($status, fn ($q) => $q->where('status', $status))->orderByDesc('occurred_at')->limit(200)->get();
    }

    /** A manager cancels a request (e.g. stock not available); a delegate can withdraw their own open request. */
    public function cancelRequest(User $actor, string $id): StockRequest
    {
        $r = StockRequest::find($id) ?? throw AppException::notFound();
        if ($r->user_id !== $actor->id) {
            $this->need($actor, 'delegates.manage');
        }
        if ($r->status !== 'open') {
            throw new AppException('request_closed');
        }
        $r->update(['status' => 'cancelled', 'handled_by' => $actor->id, 'handled_at' => Time::nowMs()]);
        $this->audit->log($actor, 'delegate.request_cancel', 'stock_request', $r->id);

        return $r;
    }

    /* ───────────────────────── visits ───────────────────────── */

    /** @param array<string, mixed> $v {id?, customerId?, lat?, lng?, accuracyM?, outcome?, note?, createdAt?} */
    public function recordVisit(User $actor, array $v, ?string $deviceId = null): Visit
    {
        $this->need($actor, 'delegate.visit');
        if (! empty($v['id']) && ($existing = Visit::find($v['id']))) {
            return $existing;
        }
        $customer = ! empty($v['customerId']) ? Customer::find($v['customerId']) : null;
        $lat = isset($v['lat']) && is_numeric($v['lat']) && abs((float) $v['lat']) <= 90 ? (float) $v['lat'] : null;
        $lng = isset($v['lng']) && is_numeric($v['lng']) && abs((float) $v['lng']) <= 180 ? (float) $v['lng'] : null;
        $outcome = in_array($v['outcome'] ?? 'visit', ['visit', 'sale', 'collection', 'no_sale', 'closed'], true) ? ($v['outcome'] ?? 'visit') : 'visit';

        return DB::transaction(function () use ($actor, $v, $customer, $lat, $lng, $outcome, $deviceId) {
            $visit = Visit::create([
                'id' => $v['id'] ?? (string) Str::uuid7(), 'user_id' => $actor->id, 'user_name' => $actor->name,
                'customer_id' => $customer?->id, 'customer_name' => $customer?->name ?? '', 'lat' => $lat, 'lng' => $lng,
                'accuracy_m' => isset($v['accuracyM']) ? (int) $v['accuracyM'] : null, 'outcome' => $outcome, 'note' => trim((string) ($v['note'] ?? '')),
                'device_id' => $deviceId, 'occurred_at' => (int) ($v['createdAt'] ?? Time::nowMs()),
            ]);
            // the first good GPS fix at a shop becomes its pin on the map
            if ($customer && $customer->lat === null && $lat !== null && $lng !== null && (int) ($v['accuracyM'] ?? 9999) <= 100) {
                $customer->update(['lat' => $lat, 'lng' => $lng]);
            }

            return $visit;
        });
    }

    public function visits(User $actor, ?string $delegateId, int $from, int $to)
    {
        $uid = $delegateId ?? $actor->id;
        $this->canSee($actor, $uid);

        return Visit::where('user_id', $uid)->whereBetween('occurred_at', [$from, $to])->orderByDesc('occurred_at')->limit(500)->get();
    }

    /* ───────────────────────── live location ───────────────────────── */

    /** How many days of location points are kept. */
    public const LOCATION_DAYS = 60;

    /**
     * Points from a delegate's phone while they are signed in (sent in batches; points recorded with no signal arrive
     * later). Impossible points — bad coordinates, the 0,0 a phone reports with no fix, older than a week, from the
     * future — are skipped, and a point already stored is not stored twice.
     *
     * @param array<int, mixed> $points [{lat, lng, accuracyM?, at}]
     */
    public function recordLocations(User $actor, array $points, ?string $deviceId = null): int
    {
        $this->need($actor, 'delegate.visit');
        if (! self::isDelegate($actor)) {
            throw new AppException('not_a_delegate', [], 403);
        }
        $now = Time::nowMs();
        $rows = [];
        foreach (array_slice($points, 0, 500) as $p) {
            if (! is_array($p) || ! is_numeric($p['lat'] ?? null) || ! is_numeric($p['lng'] ?? null) || ! is_numeric($p['at'] ?? null)) {
                continue;
            }
            [$lat, $lng, $at] = [(float) $p['lat'], (float) $p['lng'], (int) $p['at']];
            if (abs($lat) > 90 || abs($lng) > 180 || ($lat === 0.0 && $lng === 0.0) || $at < $now - 7 * 86_400_000 || $at > $now + 300_000) {
                continue;
            }
            $rows[$at] = [
                'user_id' => $actor->id, 'device_id' => $deviceId, 'lat' => round($lat, 7), 'lng' => round($lng, 7),
                'accuracy_m' => is_numeric($p['accuracyM'] ?? null) ? max(0, min(100_000, (int) $p['accuracyM'])) : null,
                'recorded_at' => $at, 'created_at' => now(),
            ];
        }
        if (! $rows) {
            return 0;
        }
        $saved = DB::table('delegate_locations')->insertOrIgnore(array_values($rows));
        // the table stays small: this delegate's points older than LOCATION_DAYS go
        DelegateLocation::where('user_id', $actor->id)->where('recorded_at', '<', $now - self::LOCATION_DAYS * 86_400_000)->delete();

        return $saved;
    }

    /** @return array{lat: float, lng: float, accuracyM: ?int, at: int} */
    private static function point(DelegateLocation $p): array
    {
        return ['lat' => $p->lat, 'lng' => $p->lng, 'accuracyM' => $p->accuracy_m, 'at' => $p->recorded_at];
    }

    /** Where the delegate's phone was last seen (null: never). */
    public function lastLocation(string $delegateId): ?array
    {
        $p = DelegateLocation::where('user_id', $delegateId)->orderByDesc('recorded_at')->first();

        return $p ? self::point($p) : null;
    }

    /** A delegate's points on one day (shop timezone), oldest first — the route they took. */
    public function locations(User $actor, string $delegateId, string $day): array
    {
        $this->need($actor, 'delegates.manage');
        $this->delegateOrFail($delegateId);
        [$from, $to] = self::dayRange($day);

        return DelegateLocation::where('user_id', $delegateId)->whereBetween('recorded_at', [$from, $to])->orderBy('recorded_at')
            ->limit(3000)->get()->map(fn (DelegateLocation $p) => self::point($p))->all();
    }

    /* ───────────────────────── daily closing ───────────────────────── */

    /** @return array{0: int, 1: int} the day's start/end (epoch ms) in the shop's timezone */
    private static function dayRange(string $day): array
    {
        $d = Carbon::createFromFormat('Y-m-d', $day, config('app.timezone'));
        if (! $d) {
            throw new AppException('invalid_day');
        }

        return [(int) $d->copy()->startOfDay()->getTimestampMs(), (int) $d->copy()->startOfDay()->addDay()->getTimestampMs() - 1];
    }

    /** What the server knows about a delegate's day (only synced records count — sync before closing). */
    public function figures(User $delegate, string $day): array
    {
        [$from, $to] = self::dayRange($day);
        $sales = Sale::where('user_id', $delegate->id)->where('channel', 'delegate')->where('status', '!=', 'voided')->whereBetween('sold_at', [$from, $to]);
        $saleIds = (clone $sales)->pluck('id');
        $pay = SalePayment::whereIn('sale_id', $saleIds);
        $cashSales = (int) (clone $pay)->whereIn('method', ['cash_iqd', 'cash_usd'])->sum('amount_iqd'); // their value, in IQD
        // dinars and dollars are counted separately: a dollar note is never "expected" as dinars
        $cashSalesIQD = (int) (clone $pay)->where('method', 'cash_iqd')->sum('amount_iqd');
        $cashSalesUSD = round((float) (clone $pay)->where('method', 'cash_usd')->sum('tendered'), 2);
        $col = Collection::where('user_id', $delegate->id)->whereBetween('occurred_at', [$from, $to]);
        $cashCollections = (int) (clone $col)->where('method', 'cash_iqd')->sum('amount_iqd');
        $collectionsUSD = round((float) (clone $col)->where('method', 'cash_usd')->sum('tendered'), 2);
        $cashRefunds = (int) SaleReturn::where('user_id', $delegate->id)->where('refund_method', 'cash_iqd')->whereBetween('occurred_at', [$from, $to])->sum('refund_iqd');

        return [
            'day' => $day,
            'salesCount' => (clone $sales)->count(),
            'salesIQD' => (int) (clone $sales)->sum('total_iqd'),
            'cashSalesIQD' => $cashSales,
            'creditSalesIQD' => (int) (clone $sales)->sum('due_iqd'),
            'collectionsIQD' => (int) (clone $col)->sum('amount_iqd'),
            'cashRefundsIQD' => $cashRefunds,
            'expectedCashBeforeExpensesIQD' => $cashSalesIQD + $cashCollections - $cashRefunds,
            'cashSalesUSD' => $cashSalesUSD,
            'collectionsUSD' => $collectionsUSD,
            'expectedCashUSD' => round($cashSalesUSD + $collectionsUSD, 2),
            'visits' => Visit::where('user_id', $delegate->id)->whereBetween('occurred_at', [$from, $to])->count(),
            // bottles sold that day (delegates sell the shop's stock; the name is from when they carried a van)
            'vanUnits' => (int) SaleItem::whereIn('sale_id', $saleIds)->sum('qty'),
        ];
    }

    /** @param array<string, mixed> $in {id?, day?, countedCashIQD, countedCashUSD?, expensesIQD?, note?, createdAt?} — expenses are paid in dinars */
    public function submitClosing(User $actor, array $in): DelegateClosing
    {
        $this->need($actor, 'delegate.close');
        $day = (string) ($in['day'] ?? Time::at(Time::nowMs())->format('Y-m-d'));
        $f = $this->figures($actor, $day);
        $expenses = max(0, (int) ($in['expensesIQD'] ?? 0));
        $counted = max(0, (int) ($in['countedCashIQD'] ?? 0));
        $expected = $f['expectedCashBeforeExpensesIQD'] - $expenses;
        $countedUSD = max(0, round((float) ($in['countedCashUSD'] ?? 0), 2));

        return DB::transaction(function () use ($actor, $in, $day, $f, $expenses, $counted, $expected, $countedUSD) {
            $existing = DelegateClosing::where('user_id', $actor->id)->where('day', $day)->lockForUpdate()->first();
            if ($existing?->status === 'approved') {
                throw new AppException('closing_already_approved');
            }
            $attrs = [
                'user_name' => $actor->name, 'sales_count' => $f['salesCount'], 'sales_iqd' => $f['salesIQD'], 'cash_sales_iqd' => $f['cashSalesIQD'],
                'credit_sales_iqd' => $f['creditSalesIQD'], 'collections_iqd' => $f['collectionsIQD'], 'expenses_iqd' => $expenses,
                'expected_cash_iqd' => $expected, 'counted_cash_iqd' => $counted, 'variance_iqd' => $counted - $expected, 'van_units' => $f['vanUnits'],
                'cash_sales_usd' => $f['cashSalesUSD'], 'collections_usd' => $f['collectionsUSD'], 'expected_cash_usd' => $f['expectedCashUSD'],
                'counted_cash_usd' => $countedUSD, 'variance_usd' => round($countedUSD - $f['expectedCashUSD'], 2),
                'visits' => $f['visits'], 'note' => trim((string) ($in['note'] ?? '')), 'status' => 'submitted', 'reviewed_by' => null, 'reviewed_at' => null,
                'review_note' => '', 'occurred_at' => (int) ($in['createdAt'] ?? Time::nowMs()),
            ];
            $c = $existing ? tap($existing)->update($attrs) : DelegateClosing::create($attrs + ['id' => $in['id'] ?? (string) Str::uuid7(), 'user_id' => $actor->id, 'day' => $day]);
            $this->audit->log($actor, 'delegate.closing_submit', 'delegate_closing', $c->id, ['day' => $day, 'expected' => $expected, 'counted' => $counted, 'expectedUSD' => $f['expectedCashUSD'], 'countedUSD' => $countedUSD]);

            return $c->fresh();
        });
    }

    public function closings(User $actor, ?string $status = null, ?string $delegateId = null)
    {
        $all = $actor->can('delegates.manage');
        if (! $all) {
            $this->need($actor, 'delegate.close');
        }

        return DelegateClosing::query()
            ->when(! $all, fn ($q) => $q->where('user_id', $actor->id))
            ->when($all && $delegateId, fn ($q) => $q->where('user_id', $delegateId))
            ->when($status, fn ($q) => $q->where('status', $status))
            ->orderByDesc('day')->limit(200)->get();
    }

    public function reviewClosing(User $actor, string $id, bool $approve, string $note = ''): DelegateClosing
    {
        $this->need($actor, 'delegates.manage');
        $c = DelegateClosing::find($id) ?? throw AppException::notFound();
        if ($c->status !== 'submitted') {
            throw new AppException('closing_not_pending');
        }
        $c->update(['status' => $approve ? 'approved' : 'rejected', 'reviewed_by' => $actor->id, 'reviewed_at' => Time::nowMs(), 'review_note' => trim($note)]);
        $this->audit->log($actor, $approve ? 'delegate.closing_approve' : 'delegate.closing_reject', 'delegate_closing', $c->id, ['day' => $c->day, 'delegate' => $c->user_name]);

        return $c;
    }
}
