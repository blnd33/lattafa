<?php

namespace App\Services;

use App\Exceptions\AppException;
use App\Models\Customer;
use App\Models\Order;
use App\Models\Product;
use App\Models\User;
use App\Models\Variant;
use App\Services\Concerns\RequiresPermission;
use App\Support\Size;
use App\Support\Time;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Orders shops send from the customer menu.
 *
 * Anyone who opens the menu may send one — it is a request, not a sale: items, how many, and who is asking. Every
 * delegate sees the new ones and the first to accept takes it; the money is settled in the delegate app when the
 * goods are handed over. Nothing here touches stock, prices or balances.
 */
class OrderService
{
    use RequiresPermission;

    /** The most lines one order may hold, and the most bottles of any one line. */
    public const MAX_LINES = 60;
    public const MAX_QTY = 500;

    public function __construct(private AuditService $audit, private PushService $push) {}

    /**
     * A shop's order from the menu. Public: the sender is whoever opened the menu, so everything is checked here —
     * the sizes must exist and be on sale, the quantities must be sane, and the text is kept short.
     *
     * @param array{shopName: string, phone: string, note?: string, items: array<int, array{variantId: string, qty: int}>} $in
     */
    public function place(array $in): Order
    {
        $lines = [];
        foreach (array_slice($in['items'], 0, self::MAX_LINES) as $it) {
            $qty = (int) ($it['qty'] ?? 0);
            if ($qty < 1) {
                continue;
            }
            $v = Variant::with('product')->find($it['variantId'] ?? '');
            if (! $v || ! $v->active || ! $v->product || ! $v->product->active) {
                throw new AppException('product_unavailable', ['variantId' => (string) ($it['variantId'] ?? '')]);
            }
            $lines[] = [
                'variantId' => $v->id, 'productId' => $v->product_id, 'name' => $v->product->name,
                'brand' => $v->product->brand, 'label' => $v->label, 'sku' => $v->sku, 'qty' => min($qty, self::MAX_QTY),
            ];
        }
        if (! $lines) {
            throw new AppException('nothing_to_order');
        }
        $phone = trim($in['phone']);

        return DB::transaction(function () use ($in, $phone, $lines) {
            $order = Order::create([
                'id' => (string) Str::uuid7(),
                'number' => (int) (Order::max('number') ?? 0) + 1,
                'shop_name' => trim($in['shopName']),
                'phone' => $phone,
                'note' => mb_substr(trim($in['note'] ?? ''), 0, 500),
                // a shop already on file is recognised by its phone, so the delegate sees who it is
                'customer_id' => $phone === '' ? null : Customer::where('phone', $phone)->value('id'),
                'items' => $lines,
                'units' => array_sum(array_column($lines, 'qty')),
                'placed_at' => Time::nowMs(),
            ]);
            $this->audit->log(null, 'order.placed', 'order', $order->id, ['number' => $order->number, 'shop' => $order->shop_name, 'units' => $order->units]);

            return $order;
        });
    }

    /**
     * Wakes the phones of everyone who asked to be told. Called after the order is safely saved, never inside the
     * transaction — a push service being slow or down must not lose the shop's order.
     */
    public function announce(Order $order): void
    {
        $this->push->notify([
            'title' => $order->shop_name,
            'body' => $order->units === 1 ? '1 bottle ordered' : "{$order->units} bottles ordered",
            'url' => '/delegate/#/orders',
            'tag' => 'order-'.$order->id,
        ]);
    }

    /** New orders first, then the handled ones. Delegates and managers see the same list. */
    public function list(User $actor, ?string $status = null, int $limit = 100): array
    {
        $this->needOrders($actor);

        return Order::when($status, fn ($q) => $q->where('status', $status))
            ->orderByRaw("CASE WHEN status = 'new' THEN 0 ELSE 1 END")
            ->orderByDesc('placed_at')->limit(min($limit, 300))->get()->all();
    }

    /** How many are still waiting — the number on the bell. */
    public function waiting(User $actor): int
    {
        $this->needOrders($actor);

        return Order::where('status', 'new')->count();
    }

    /** Taking an order: the first delegate to accept gets it, the others are told it is gone. */
    public function accept(User $actor, string $id): Order
    {
        return $this->handle($actor, $id, 'accepted', '');
    }

    public function refuse(User $actor, string $id, string $reason = ''): Order
    {
        return $this->handle($actor, $id, 'refused', mb_substr(trim($reason), 0, 200));
    }

    private function handle(User $actor, string $id, string $status, string $reason): Order
    {
        $this->needOrders($actor);

        return DB::transaction(function () use ($actor, $id, $status, $reason) {
            $order = Order::whereKey($id)->lockForUpdate()->first();
            if (! $order) {
                throw AppException::notFound();
            }
            if ($order->status !== 'new') {
                // someone got there first: say who, so the phone can show it instead of failing silently
                throw new AppException('order_taken', ['by' => User::whereKey($order->handled_by)->value('name') ?? '', 'status' => $order->status], 409);
            }
            $order->update(['status' => $status, 'handled_by' => $actor->id, 'handled_at' => Time::nowMs(), 'refuse_reason' => $reason]);
            $this->audit->log($actor, "order.{$status}", 'order', $order->id, ['number' => $order->number, 'shop' => $order->shop_name] + ($reason ? ['reason' => $reason] : []));

            return $order;
        });
    }

    /* ───────── the delegate's dollar price list ───────── */

    /**
     * Every size the delegate can sell, with the dollar price he sells it for. The perfumes are the shop's own — one
     * list, one stock — but the dollar price belongs to the delegate side and is set only there.
     *
     * @return array<int, array<string, mixed>>
     */
    public function prices(User $actor): array
    {
        $this->needOrders($actor);

        return Variant::with('product')->where('active', true)->get()
            ->filter(fn (Variant $v) => $v->product?->active)
            ->sortBy(fn (Variant $v) => [($v->product->name['en'] ?? '') ?: ($v->product->name['ar'] ?? ''), -$v->ml])
            ->map(fn (Variant $v) => [
                'variantId' => $v->id, 'sku' => $v->sku, 'name' => $v->product->name, 'brand' => $v->product->brand,
                'label' => $v->label, 'retailIQD' => $v->retail_iqd, 'usdCents' => $v->wholesale_usd_cents,
            ])->values()->all();
    }

    /**
     * Sets those dollar prices. Only the dollar price moves — the shop's own dinar prices are never touched here,
     * and the till cannot change these.
     *
     * @param array<int, array{variantId: string, usdCents: int}> $rows
     */
    public function setPrices(User $actor, array $rows): int
    {
        $this->needOrders($actor);
        $changed = 0;
        DB::transaction(function () use ($actor, $rows, &$changed) {
            foreach ($rows as $row) {
                $cents = max(0, (int) ($row['usdCents'] ?? 0));
                $v = Variant::whereKey($row['variantId'] ?? '')->first();
                if (! $v || $v->wholesale_usd_cents === $cents) {
                    continue;
                }
                $v->update(['wholesale_usd_cents' => $cents]);
                $changed++;
            }
            if ($changed) {
                $this->audit->log($actor, 'delegate.prices', 'variant', '*', ['changed' => $changed]);
            }
        });

        return $changed;
    }

    /**
     * A perfume the delegate adds himself, from his phone. It joins the shop's one list — that is what keeps stock a
     * single number for both sides — with the dollar price he sells it at. The shop's dinar price starts from that
     * dollar price at today's rate and is the shop's own from then on; changing it never touches his.
     *
     * @param array{nameEn?: string, nameAr?: string, brand?: string, size?: float, unit?: string, usdCents: int, openingStock?: int} $in
     */
    public function addProduct(User $actor, array $in, SettingsService $settings, CatalogService $catalog, StockService $stock): Variant
    {
        $this->needOrders($actor);
        $nameEn = trim($in['nameEn'] ?? '');
        $nameAr = trim($in['nameAr'] ?? '');
        if ($nameEn === '' && $nameAr === '') {
            throw new AppException('required_fields');
        }
        $cents = max(0, (int) $in['usdCents']);
        $rate = (int) (($settings->get()['currency']['rate'] ?? 0) ?: 1460);
        $size = (float) ($in['size'] ?? 0);
        $unit = ($in['unit'] ?? 'ml') === 'oz' ? 'oz' : 'ml';

        return DB::transaction(function () use ($actor, $in, $nameEn, $nameAr, $cents, $rate, $size, $unit, $catalog, $stock) {
            $brand = trim($in['brand'] ?? '') ?: 'Lattafa';
            $product = Product::create([
                'id' => (string) Str::uuid7(),
                'name' => ['en' => $nameEn, 'ar' => $nameAr, 'ku' => ''],
                'description' => ['en' => '', 'ar' => '', 'ku' => ''],
                'brand' => $brand, 'category' => 'perfume', 'gender' => 'unisex', 'concentration' => 'EDP',
                'scent_families' => [], 'notes' => ['top' => [], 'heart' => [], 'base' => []],
                'season' => 'all', 'longevity' => 3, 'sillage' => 3,
                'art' => ['c1' => '#8B4A2B', 'c2' => '#1A1714', 'shape' => 'rect'],
            ]);
            $variant = Variant::create([
                'id' => (string) Str::uuid7(), 'product_id' => $product->id,
                'label' => Size::label($size, $unit), 'size' => $size, 'unit' => $unit, 'ml' => Size::toMl($size, $unit),
                'sku' => $this->freeSku($nameEn ?: $nameAr, $size, $unit),
                'barcode' => $catalog->nextBarcode(),
                'cost_iqd' => 0,
                // a starting dinar price so the till can sell it too; the shop may change it, his dollar price stays
                'retail_iqd' => (int) round($cents / 100 * $rate),
                'wholesale_iqd' => (int) round($cents / 100 * $rate),
                'wholesale_usd_cents' => $cents,
                'min_stock' => 5,
            ]);
            $opening = max(0, (int) ($in['openingStock'] ?? 0));
            if ($opening > 0) {
                $stock->applyMovement($variant->id, $opening, 'opening', $actor, ['note' => 'Added by the delegate']);
            }
            $this->audit->log($actor, 'delegate.product_added', 'variant', $variant->id, [
                'name' => $nameEn ?: $nameAr, 'size' => $variant->label, 'usd' => $cents / 100, 'opening' => $opening,
            ]);

            return $variant;
        });
    }

    /** A SKU nobody is using: DLG-KHAMRAH-100ML, then -2, -3… */
    private function freeSku(string $name, float $size, string $unit): string
    {
        $part = Str::upper(preg_replace('/[^A-Za-z0-9]+/', '-', Str::ascii($name)) ?: 'ITEM');
        $base = trim('DLG-'.Str::limit(trim($part, '-'), 14, '').($size > 0 ? '-'.rtrim(rtrim(number_format($size, 2, '.', ''), '0'), '.').Str::upper($unit) : ''), '-');
        $sku = $base;
        for ($n = 2; Variant::where('sku', $sku)->exists(); $n++) {
            $sku = $base.'-'.$n;
        }

        return $sku;
    }

    /** Delegates work the orders; managers watch them. */
    private function needOrders(User $actor): void
    {
        if (! $actor->can('delegate.sell') && ! $actor->can('delegates.manage')) {
            throw AppException::forbidden('delegate.sell');
        }
    }
}
