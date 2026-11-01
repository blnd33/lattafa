<?php

namespace App\Services;

use App\Exceptions\AppException;
use App\Models\StockCount;
use App\Models\StockMovement;
use App\Models\User;
use App\Models\Variant;
use App\Support\Time;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * StockService — the ONLY code allowed to change stock quantities (brief §10).
 * Every change writes a `stock_movements` row so a balance can always be explained.
 * `applyMovement` must run inside a DB transaction (callers open one); it takes a row lock so two
 * tills selling the last bottle at the same moment can't both succeed.
 */
class StockService
{
    public const LOCATION = 'loc-store';

    public function __construct(private AuditService $audit) {}

    /**
     * @param array{refType?: string, refId?: string, note?: string, locationId?: string, allowNegative?: bool, deviceId?: string|null, occurredAt?: int, id?: string} $opts
     */
    public function applyMovement(string $variantId, int $delta, string $type, ?User $user, array $opts = []): StockMovement
    {
        $location = $opts['locationId'] ?? self::LOCATION;
        $row = DB::table('stock')->where('variant_id', $variantId)->where('location_id', $location)->lockForUpdate()->first();
        $before = (int) ($row->qty ?? 0);
        $after = $before + $delta;

        if ($after < 0 && ! ($opts['allowNegative'] ?? false)) {
            $sku = Variant::whereKey($variantId)->value('sku') ?? $variantId;
            throw new AppException('insufficient_stock', ['sku' => $sku, 'available' => $before]);
        }

        $now = now();
        if ($row) {
            DB::table('stock')->where('variant_id', $variantId)->where('location_id', $location)->update(['qty' => $after, 'updated_at' => $now]);
        } else {
            DB::table('stock')->insert(['variant_id' => $variantId, 'location_id' => $location, 'qty' => $after, 'created_at' => $now, 'updated_at' => $now]);
        }

        return StockMovement::create([
            'id' => $opts['id'] ?? (string) Str::uuid7(),
            'variant_id' => $variantId,
            'location_id' => $location,
            'type' => $type,
            'qty' => $delta,
            'balance_after' => $after,
            'ref_type' => $opts['refType'] ?? null,
            'ref_id' => $opts['refId'] ?? null,
            'note' => $opts['note'] ?? '',
            'user_id' => $user?->id,
            'device_id' => $opts['deviceId'] ?? null,
            'occurred_at' => $opts['occurredAt'] ?? Time::nowMs(),
        ]);
    }

    /** @return array<string, int> variantId → quantity at the shop location */
    public function map(string $location = self::LOCATION): array
    {
        return DB::table('stock')->where('location_id', $location)->pluck('qty', 'variant_id')->map(fn ($q) => (int) $q)->all();
    }

    public function quantity(string $variantId, string $location = self::LOCATION): int
    {
        return (int) (DB::table('stock')->where('variant_id', $variantId)->where('location_id', $location)->value('qty') ?? 0);
    }

    /** Set an absolute quantity (correction / damage). */
    public function adjust(User $actor, string $variantId, int $newQty, string $reason, string $note): void
    {
        $this->need($actor, 'inventory.adjust');
        if ($newQty < 0 || ! in_array($reason, ['adjustment', 'damage'], true)) {
            throw new AppException('invalid_quantity');
        }
        DB::transaction(function () use ($actor, $variantId, $newQty, $reason, $note) {
            $cur = $this->quantity($variantId);
            $delta = $newQty - $cur;
            if ($delta === 0) {
                return;
            }
            $this->applyMovement($variantId, $delta, $reason, $actor, ['note' => $note]);
            $this->audit->log($actor, 'stock.adjust', 'variant', $variantId, ['from' => $cur, 'to' => $newQty, 'reason' => $reason]);
        });
    }

    /** @param array<int, array{variantId: string, qty: int, costIQD?: int|null}> $items */
    public function receive(User $actor, array $items, string $note): void
    {
        $this->need($actor, 'inventory.receive');
        if (! $items) {
            throw new AppException('invalid_quantity');
        }
        $ref = (string) Str::uuid7();
        DB::transaction(function () use ($actor, $items, $note, $ref) {
            foreach ($items as $it) {
                if (($it['qty'] ?? 0) <= 0) {
                    throw new AppException('invalid_quantity');
                }
                $this->applyMovement($it['variantId'], (int) $it['qty'], 'purchase', $actor, ['refType' => 'receipt', 'refId' => $ref, 'note' => $note]);
                if (! empty($it['costIQD']) && $it['costIQD'] > 0 && $actor->can('prices.edit')) {
                    Variant::whereKey($it['variantId'])->update(['cost_iqd' => (int) $it['costIQD']]);
                }
            }
            $this->audit->log($actor, 'stock.receive', 'receipt', $ref, ['lines' => count($items), 'units' => array_sum(array_column($items, 'qty'))]);
        });
    }

    /** Open a bottle as a tester: it leaves sellable stock. */
    public function tester(User $actor, string $variantId, int $qty, string $note = ''): void
    {
        if (! $actor->can('pos.tester') && ! $actor->can('inventory.adjust')) {
            throw AppException::forbidden('pos.tester');
        }
        if ($qty <= 0) {
            throw new AppException('invalid_quantity');
        }
        DB::transaction(function () use ($actor, $variantId, $qty, $note) {
            $this->applyMovement($variantId, -$qty, 'tester', $actor, ['note' => $note]);
            $this->audit->log($actor, 'stock.tester', 'variant', $variantId, ['qty' => $qty]);
        });
    }

    /**
     * Apply a physical stock count: stock is corrected to what was counted.
     *
     * @param array<int, array{variantId: string, counted: int}> $lines
     * @return array{changed: int}
     */
    public function applyCount(User $actor, array $lines, string $note): array
    {
        $this->need($actor, 'inventory.count');
        $changed = 0;
        DB::transaction(function () use ($actor, $lines, $note, &$changed) {
            $count = StockCount::create(['id' => (string) Str::uuid7(), 'location_id' => self::LOCATION, 'lines' => [], 'note' => $note, 'user_id' => $actor->id, 'occurred_at' => Time::nowMs()]);
            $stored = [];
            foreach ($lines as $l) {
                if (($l['counted'] ?? -1) < 0) {
                    throw new AppException('invalid_quantity');
                }
                $cur = $this->quantity($l['variantId']);
                $stored[] = ['variantId' => $l['variantId'], 'expected' => $cur, 'counted' => (int) $l['counted']];
                if ($cur !== (int) $l['counted']) {
                    $this->applyMovement($l['variantId'], (int) $l['counted'] - $cur, 'count', $actor, ['refType' => 'count', 'refId' => $count->id, 'note' => $note]);
                    $changed++;
                }
            }
            $count->update(['lines' => $stored]);
            $this->audit->log($actor, 'stock.count', 'count', $count->id, ['lines' => count($lines), 'changed' => $changed]);
        });

        return ['changed' => $changed];
    }

    /** @return \Illuminate\Support\Collection<int, StockMovement> */
    public function movements(User $actor, ?string $variantId = null, int $limit = 200)
    {
        $this->need($actor, 'inventory.movements');

        return StockMovement::query()
            ->when($variantId, fn ($q) => $q->where('variant_id', $variantId))
            ->orderByDesc('occurred_at')->limit(min($limit, 1000))->get();
    }

    /** @return array<int, array{variantId: string, productName: string, label: string, sku: string, qty: int, minStock: int}> */
    public function lowStock(User $actor): array
    {
        $this->need($actor, 'inventory.view');
        $stock = $this->map();

        return Variant::with('product')->where('active', true)->get()
            ->filter(fn (Variant $v) => ($stock[$v->id] ?? 0) <= $v->min_stock)
            ->map(fn (Variant $v) => ['variantId' => $v->id, 'productName' => $v->product->name['en'] ?? $v->sku, 'label' => $v->label, 'sku' => $v->sku, 'qty' => $stock[$v->id] ?? 0, 'minStock' => $v->min_stock])
            ->sortBy('qty')->values()->all();
    }

    private function need(User $actor, string $perm): void
    {
        if (! $actor->can($perm)) {
            throw AppException::forbidden($perm);
        }
    }
}
