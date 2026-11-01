<?php

namespace App\Services;

use App\Exceptions\AppException;
use App\Http\Resources\Present;
use App\Models\CashMovement;
use App\Models\Customer;
use App\Models\Device;
use App\Models\Product;
use App\Models\Role;
use App\Models\Shift;
use App\Models\StockMovement;
use App\Models\User;
use App\Models\Variant;
use App\Support\Time;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Throwable;

/**
 * Till ⇄ server synchronisation.
 *
 * PUSH  (`POST /sync/push`)  — a till uploads what happened while it was offline: sales, returns, shifts,
 *                              collections, new customers, non-sale stock movements. Every item carries a
 *                              client-generated UUID, so re-sending the same batch can never create duplicates.
 *                              Sales are NEVER rejected for business reasons (the customer already paid) —
 *                              oddities become review flags instead.
 * PULL  (`GET /sync/pull`)   — the till downloads what changed on the server since its last sync (catalogue,
 *                              prices, stock, customers, accounts, settings). The server is the source of truth
 *                              for prices and stock; a till should push first, then pull.
 */
class SyncService
{
    private const RECORDABLE_MOVEMENTS = ['purchase', 'adjustment', 'damage', 'tester', 'count', 'opening'];

    private const PULL_OVERLAP_MS = 3000;

    public function __construct(
        private SaleService $sales,
        private ReturnService $returns,
        private CustomerService $customers,
        private ShiftService $shifts,
        private StockService $stock,
        private SettingsService $settings,
        private DelegateService $delegates,
        private AuditService $audit,
    ) {}

    /**
     * @param array<int, array{entity: string, id: string, data: array<string, mixed>}> $items
     * @return array<int, array<string, mixed>>
     */
    public function push(User $tokenUser, ?Device $device, array $items): array
    {
        $device?->update(['last_seen_at' => Time::nowMs()]);
        $results = [];
        foreach ($items as $it) {
            $base = ['entity' => $it['entity'] ?? '', 'id' => $it['id'] ?? ''];
            try {
                $data = $it['data'] ?? [];
                $r = match ($it['entity'] ?? '') {
                    'sale' => $this->sales->recordFromClient($tokenUser, $data, $device),
                    'return' => $this->returns->recordFromClient($tokenUser, $data),
                    'shift' => $this->syncShift($tokenUser, $device, $data),
                    'collection' => $this->syncCollection($tokenUser, $data),
                    'customer' => $this->syncCustomer($tokenUser, $data),
                    'stock_movement' => $this->syncMovement($tokenUser, $device, $data),
                    // delegate app
                    'visit' => $this->asOk(fn () => $this->delegates->recordVisit($this->author($tokenUser, $data), $data, $device?->id)),
                    'stock_request' => $this->asOk(fn () => $this->delegates->createRequest($this->author($tokenUser, $data), $data['items'] ?? [], (string) ($data['note'] ?? ''), $data['id'] ?? null, isset($data['createdAt']) ? (int) $data['createdAt'] : null)),
                    'closing' => $this->asOk(fn () => $this->delegates->submitClosing($this->author($tokenUser, $data), $data)),
                    default => throw new AppException('unknown_entity', ['entity' => (string) ($it['entity'] ?? '')]),
                };
                $results[] = $base + ['status' => $r['status'], 'flags' => $r['flags'] ?? []];
            } catch (AppException $e) {
                // 409 "not yet" conditions (return before its sale) are worth retrying; everything else is final
                $results[] = $base + ['status' => $e->status === 409 && $e->errorCode === 'sale_not_synced' ? 'retry' : 'rejected', 'code' => $e->errorCode, 'params' => $e->params];
            } catch (QueryException $e) {
                // PostgreSQL SQLSTATE 22P02: a malformed uuid inside the record. Resending can never fix it, so don't retry forever.
                if ($e->getCode() === '22P02') {
                    $results[] = $base + ['status' => 'rejected', 'code' => 'invalid_id', 'params' => []];
                    continue;
                }
                report($e);
                $results[] = $base + ['status' => 'error', 'code' => 'server_error'];
            } catch (Throwable $e) {
                report($e);
                $results[] = $base + ['status' => 'error', 'code' => 'server_error'];
            }
        }

        return $results;
    }

    /** Who recorded it: the person named in the record if they exist, else whoever is signed in on the device. */
    private function author(User $tokenUser, array $data): User
    {
        return self::user($data['userId'] ?? null) ?? $tokenUser;
    }

    /** The person behind a record, by id — a missing or malformed id is nobody (PostgreSQL refuses to compare it to a uuid). */
    private static function user(mixed $id): ?User
    {
        return is_string($id) && Str::isUuid($id) ? User::with('role')->find($id) : null;
    }

    private function asOk(callable $fn): array
    {
        $fn();

        return ['status' => 'ok'];
    }

    /** @param array<string, mixed> $c */
    private function syncCustomer(User $by, array $c): array
    {
        return DB::transaction(function () use ($by, $c) {
            $by = $this->author($by, $c);
            $existing = Customer::find($c['id']);
            $attrs = [
                'name' => trim((string) ($c['name'] ?? '')), 'phone' => trim((string) ($c['phone'] ?? '')), 'type' => in_array($c['type'] ?? '', ['retail', 'shop', 'wholesale'], true) ? $c['type'] : 'retail',
                'city' => trim((string) ($c['city'] ?? '')), 'notes' => trim((string) ($c['notes'] ?? '')), 'credit_limit_iqd' => max(0, (int) ($c['creditLimitIQD'] ?? 0)),
            ];
            // a delegate adding a shop on the road pins it on the map
            if (isset($c['lat'], $c['lng']) && is_numeric($c['lat']) && is_numeric($c['lng']) && abs((float) $c['lat']) <= 90 && abs((float) $c['lng']) <= 180) {
                $attrs += ['lat' => (float) $c['lat'], 'lng' => (float) $c['lng']];
            }
            if ($attrs['name'] === '') {
                throw new AppException('required_fields');
            }
            if (! $existing) {
                Customer::create($attrs + ['id' => $c['id'], 'balance_iqd' => 0, 'points' => 0, 'active' => (bool) ($c['active'] ?? true)]);
                $this->audit->log($by, 'customer.create', 'customer', $c['id'], ['name' => $attrs['name']], null, isset($c['createdAt']) ? (int) $c['createdAt'] : null);

                return ['status' => 'ok'];
            }
            // last-writer-wins on the descriptive fields; balance and points stay server-authoritative
            if ((int) ($c['updatedAt'] ?? 0) >= (int) $existing->updated_at?->getTimestampMs()) {
                $before = $existing->only(['name', 'phone', 'type', 'city', 'credit_limit_iqd', 'active']);
                $existing->update($attrs + ['active' => (bool) ($c['active'] ?? $existing->active)]);
                $changed = array_keys(array_diff_assoc(array_map('strval', $existing->only(array_keys($before))), array_map('strval', $before)));
                if ($changed) {
                    $this->audit->log($by, 'customer.update', 'customer', $existing->id, ['name' => $existing->name, 'changed' => $changed]
                        + (in_array('credit_limit_iqd', $changed, true) ? ['creditLimit' => [(int) $before['credit_limit_iqd'], (int) $existing->credit_limit_iqd]] : []), null, isset($c['updatedAt']) ? (int) $c['updatedAt'] : null);
                }

                return ['status' => 'ok'];
            }

            return ['status' => 'duplicate'];
        });
    }

    /** @param array<string, mixed> $s */
    private function syncShift(User $tokenUser, ?Device $device, array $s): array
    {
        return DB::transaction(function () use ($tokenUser, $device, $s) {
            $owner = User::find($s['userId'] ?? '') ?? $tokenUser;
            $shift = Shift::find($s['id']);
            $created = false;
            if (! $shift) {
                $shift = Shift::create([
                    'id' => $s['id'], 'user_id' => $owner->id, 'user_name' => $s['userName'] ?? $owner->name, 'device_id' => $device?->id ?? ($s['deviceId'] ?? null), 'status' => 'open',
                    'opened_at' => (int) $s['openedAt'], 'opening_iqd' => (int) ($s['openingIQD'] ?? 0), 'opening_usd' => (float) ($s['openingUSD'] ?? 0), 'note' => '',
                ]);
                $created = true;
                $this->audit->log($owner, 'shift.open', 'shift', $shift->id, ['openingIQD' => (int) ($s['openingIQD'] ?? 0), 'openingUSD' => (float) ($s['openingUSD'] ?? 0)], $shift->device_id, (int) $s['openedAt']);
            }
            if ($shift->status === 'closed') {
                return ['status' => 'duplicate'];
            }
            foreach ($s['movements'] ?? [] as $m) {
                if (! CashMovement::whereKey($m['id'])->exists()) {
                    CashMovement::create(['id' => $m['id'], 'shift_id' => $shift->id, 'type' => $m['type'], 'amount_iqd' => (int) $m['amountIQD'], 'reason' => (string) $m['reason'], 'user_id' => $m['userId'] ?? $owner->id, 'occurred_at' => (int) $m['createdAt']]);
                    $this->audit->log(self::user($m['userId'] ?? null) ?? $owner, 'shift.cash_movement', 'shift', $shift->id, ['type' => $m['type'], 'amount' => (int) $m['amountIQD'], 'reason' => (string) $m['reason']], $shift->device_id, (int) $m['createdAt']);
                }
            }
            if (($s['status'] ?? 'open') === 'closed') {
                $shift->update([
                    'status' => 'closed', 'closed_at' => (int) ($s['closedAt'] ?? Time::nowMs()), 'counted_iqd' => (int) ($s['countedIQD'] ?? 0), 'counted_usd' => (float) ($s['countedUSD'] ?? 0),
                    'variance_iqd' => (int) ($s['varianceIQD'] ?? 0), 'totals' => $s['totals'] ?? null, 'note' => (string) ($s['note'] ?? ''),
                ]);
                $this->audit->log($owner, 'shift.close', 'shift', $shift->id, ['expectedIQD' => (int) ($s['totals']['expectedIQD'] ?? 0), 'countedIQD' => (int) ($s['countedIQD'] ?? 0), 'variance' => (int) ($s['varianceIQD'] ?? 0)], $shift->device_id, (int) ($s['closedAt'] ?? Time::nowMs()));

                return ['status' => 'ok'];
            }

            return ['status' => $created ? 'ok' : 'duplicate'];
        });
    }

    /** @param array<string, mixed> $c */
    private function syncCollection(User $tokenUser, array $c): array
    {
        $by = User::find($c['userId'] ?? '') ?? $tokenUser;
        if (\App\Models\Collection::whereKey($c['id'])->exists()) {
            return ['status' => 'duplicate'];
        }
        // dollars: the phone sends the notes handed over (`tendered`, currency USD) and the rate it used
        $usd = ($c['method'] ?? '') === 'cash_usd';
        $this->customers->collect($by, $c['customerId'], (int) $c['amountIQD'], (string) $c['method'], (string) ($c['note'] ?? ''), $c['id'], (int) ($c['createdAt'] ?? Time::nowMs()), $c['shiftId'] ?? null, enforce: false,
            tenderedUSD: $usd ? (float) ($c['tendered'] ?? 0) : null, rate: $usd && isset($c['rate']) ? (int) $c['rate'] : null);

        return ['status' => 'ok'];
    }

    /** @param array<string, mixed> $m */
    private function syncMovement(User $tokenUser, ?Device $device, array $m): array
    {
        if (! in_array($m['type'] ?? '', self::RECORDABLE_MOVEMENTS, true)) {
            throw new AppException('invalid_quantity');
        }

        return DB::transaction(function () use ($tokenUser, $device, $m) {
            if (StockMovement::whereKey($m['id'])->exists()) {
                return ['status' => 'duplicate'];
            }
            if (! Variant::whereKey($m['variantId'])->exists()) {
                throw new AppException('product_unavailable');
            }
            $by = self::user($m['userId'] ?? null) ?? $tokenUser;
            $mv = $this->stock->applyMovement($m['variantId'], (int) $m['qty'], $m['type'], $by, [
                'id' => $m['id'], 'note' => (string) ($m['note'] ?? ''), 'refType' => $m['refType'] ?? null, 'refId' => $m['refId'] ?? null,
                'allowNegative' => true, 'deviceId' => $device?->id, 'occurredAt' => (int) ($m['createdAt'] ?? Time::nowMs()),
            ]);

            $action = ['purchase' => 'stock.receive', 'tester' => 'stock.tester', 'count' => 'stock.count', 'opening' => 'stock.opening'][$m['type']] ?? 'stock.adjust';
            $this->audit->log($by, $action, 'variant', $m['variantId'], ['type' => $m['type'], 'qty' => (int) $m['qty'], 'balance' => $mv->balance_after, 'note' => (string) ($m['note'] ?? '')], $device?->id, (int) ($m['createdAt'] ?? Time::nowMs()));

            return ['status' => 'ok', 'flags' => $mv->balance_after < 0 ? ['negative_stock'] : []];
        });
    }

    /**
     * Highest sale / return sequence already used by a device code (ST1-000123 → 123, ST1-R00007 → 7).
     *
     * @return array{sale: int, return: int}
     */
    public static function deviceCounters(string $code): array
    {
        $seq = fn (?string $number, string $prefix) => $number && preg_match('/^'.preg_quote($prefix, '/').'(\d+)$/', $number, $m) ? (int) $m[1] : 0;
        $sale = \App\Models\Sale::where('number', 'like', $code.'-%')->pluck('number')->map(fn ($n) => $seq($n, $code.'-'))->max() ?? 0;
        $ret = \App\Models\SaleReturn::where('number', 'like', $code.'-R%')->pluck('number')->map(fn ($n) => $seq($n, $code.'-R'))->max() ?? 0;

        return ['sale' => (int) $sale, 'return' => (int) $ret];
    }

    /**
     * Everything that changed since `$since` (epoch ms; 0 = full snapshot).
     *
     * @return array<string, mixed>
     */
    public function pull(User $actor, int $since, ?Device $device = null): array
    {
        $now = Time::nowMs();
        // `updated_at` has whole-second precision, so a row edited in the same second as the till's previous pull would
        // otherwise be missed for good. Re-sending a few seconds of overlap is harmless: tills apply changes idempotently.
        $overlap = $since > 0 ? self::PULL_OVERLAP_MS : 0;
        $after = Time::at(max(0, $since - $overlap)); // in the app timezone, like the stored updated_at values it is compared with
        $showCost = $actor->can('prices.edit') || $actor->can('reports.financial');
        $stockMap = $this->stock->map();

        $changedProductIds = Product::where('updated_at', '>', $after)->pluck('id')
            ->merge(Variant::where('updated_at', '>', $after)->pluck('product_id'))
            ->merge(DB::table('stock')->where('stock.updated_at', '>', $after)->join('variants', 'variants.id', '=', 'stock.variant_id')->pluck('variants.product_id'))
            ->unique()->values();
        $products = Product::with('variants')->whereIn('id', $changedProductIds)->get();
        foreach ($products as $p) {
            foreach ($p->variants as $v) {
                $v->setAttribute('stock_qty', $stockMap[$v->id] ?? 0);
            }
        }

        $tomb = DB::table('tombstones')->where('deleted_at', '>', max(0, $since - $overlap))->get()->groupBy('entity')->map(fn ($rows) => $rows->pluck('entity_id')->values()->all());

        return [
            'serverTime' => $now,
            'since' => $since,
            'settings' => $this->settings->get(),
            'roles' => Role::all()->map(fn (Role $r) => Present::role($r))->values()->all(),
            'users' => User::with('role')->get()->map(fn (User $u) => Present::user($u))->values()->all(),
            'products' => $products->map(fn (Product $p) => Present::product($p, $showCost))->values()->all(),
            'customers' => Customer::where('updated_at', '>', $after)->get()->map(fn (Customer $c) => Present::customer($c))->values()->all(),
            'deleted' => ['products' => $tomb['product'] ?? [], 'users' => $tomb['user'] ?? [], 'roles' => $tomb['role'] ?? []],
            // this till's identity (its code prefixes receipt numbers) and the highest receipt numbers the server already
            // holds for it — a till whose browser storage was wiped must not reuse ST1-000001
            'device' => $device ? Present::device($device) : null,
            'counters' => $device ? self::deviceCounters($device->code) : null,
            // a delegate's own van, requests and today's closing (so the phone knows what it can sell offline)
            'van' => DelegateService::isDelegate($actor) ? [
                'locationId' => DelegateService::van($actor->id),
                'stock' => (object) $this->stock->map(DelegateService::van($actor->id)),
                'requests' => $this->delegates->requests($actor)->take(50)->map(fn ($x) => Present::stockRequest($x))->values()->all(),
                'closings' => $this->delegates->closings($actor)->take(14)->map(fn ($x) => Present::closing($x))->values()->all(),
            ] : null,
        ];
    }
}
