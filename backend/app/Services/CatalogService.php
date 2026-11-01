<?php

namespace App\Services;

use App\Exceptions\AppException;
use App\Models\Product;
use App\Models\Sale;
use App\Models\User;
use App\Models\Variant;
use App\Services\Concerns\RequiresPermission;
use App\Support\Size;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/** Products and their sizes (variants), barcodes, prices and photos. */
class CatalogService
{
    use RequiresPermission;

    public function __construct(private StockService $stock, private AuditService $audit, private Counters $counters) {}

    /** @return \Illuminate\Support\Collection<int, Product> products with `variants` (each carrying `stock_qty`) */
    public function list(User $actor, bool $includeInactive = false)
    {
        $this->need($actor, 'products.view');
        $stock = $this->stock->map();

        $products = Product::with(['variants' => fn ($q) => $includeInactive ? $q : $q->where('active', true)])
            ->when(! $includeInactive, fn ($q) => $q->where('active', true))
            ->get();
        foreach ($products as $p) {
            foreach ($p->variants as $v) {
                $v->setAttribute('stock_qty', $stock[$v->id] ?? 0);
            }
        }

        return $products->filter(fn (Product $p) => $includeInactive || $p->variants->isNotEmpty())
            ->sortBy(fn (Product $p) => Str::lower($p->name['en'] ?? ''))->values();
    }

    /** @return array{product: Product, variant: Variant}|null */
    public function findByCode(User $actor, string $code): ?array
    {
        $this->need($actor, 'products.view');
        $code = trim($code);
        if ($code === '') {
            return null;
        }
        $variant = Variant::with('product')->where('active', true)->where(fn ($q) => $q->where('barcode', $code)->orWhere('sku', $code))->first();
        if (! $variant || ! $variant->product->active) {
            return null;
        }
        $variant->setAttribute('stock_qty', $this->stock->quantity($variant->id));

        return ['product' => $variant->product, 'variant' => $variant];
    }

    public function brands(User $actor): array
    {
        $this->need($actor, 'products.view');

        return Product::query()->distinct()->orderBy('brand')->pluck('brand')->filter()->values()->all();
    }

    /**
     * @param array<string, mixed> $product
     * @param array<int, array<string, mixed>> $variants
     */
    public function save(User $actor, array $product, array $variants): Product
    {
        $id = $product['id'] ?? null;
        $isNew = ! $id;
        $this->need($actor, $isNew ? 'products.create' : 'products.edit');

        $name = $product['name'] ?? [];
        if (! trim(($name['en'] ?? '').($name['ar'] ?? '').($name['ku'] ?? ''))) {
            throw new AppException('required_fields');
        }
        if (! $variants) {
            throw new AppException('variant_required');
        }
        $seen = [];
        foreach ($variants as $v) {
            $sku = trim($v['sku'] ?? '');
            if ($sku === '') {
                throw new AppException('sku_required');
            }
            if (isset($seen[Str::lower($sku)])) {
                throw new AppException('sku_taken', ['sku' => $sku]);
            }
            $seen[Str::lower($sku)] = true;
            $code = trim($v['barcode'] ?? '');
            if ($code !== '') {
                if (isset($seen['barcode:'.$code])) {
                    throw new AppException('barcode_taken', ['barcode' => $code]);
                }
                $seen['barcode:'.$code] = true;
            }
            foreach (['costIQD', 'retailIQD', 'wholesaleIQD'] as $k) {
                if (($v[$k] ?? 0) < 0) {
                    throw new AppException('invalid_price');
                }
            }
        }

        return DB::transaction(function () use ($actor, $product, $variants, $id, $isNew, $name) {
            $existing = $isNew ? null : (Product::find($id) ?? throw AppException::notFound());
            $model = $existing ?? new Product(['id' => $id ?: (string) Str::uuid7()]);
            $attrs = [
                'name' => $name + ['en' => '', 'ar' => '', 'ku' => ''],
                'description' => ($product['description'] ?? []) + ['en' => '', 'ar' => '', 'ku' => ''],
                'brand' => trim($product['brand'] ?? ''),
                'category' => $product['category'] ?? 'perfume',
                'gender' => $product['gender'] ?? 'unisex',
                'concentration' => $product['concentration'] ?? 'EDP',
                'scent_families' => array_values($product['scentFamilies'] ?? []),
                'notes' => ($product['notes'] ?? []) + ['top' => [], 'heart' => [], 'base' => []],
                'season' => $product['season'] ?? 'all',
                'longevity' => (int) min(5, max(1, $product['longevity'] ?? 3)),
                'sillage' => (int) min(5, max(1, $product['sillage'] ?? 3)),
                'art' => ($product['art'] ?? []) + ['c1' => '#8B4A2B', 'c2' => '#1A1714', 'shape' => 'rect'],
                'show_on_menu' => (bool) ($product['showOnMenu'] ?? true),
                'featured' => (bool) ($product['featured'] ?? false),
                'is_new' => (bool) ($product['isNew'] ?? false),
                'active' => (bool) ($product['active'] ?? true),
            ];
            $model->fill($attrs);
            if (array_key_exists('image', $product)) {
                $model->image_path = $this->storeImage($model->id, $product['image'], $existing?->image_path);
            }
            $model->save();

            $old = Variant::where('product_id', $model->id)->get()->keyBy('id');
            $keep = [];
            $priceChanges = []; // for the activity log: [size, what, from, to]
            foreach ($variants as $vin) {
                $vid = $vin['id'] ?? (string) Str::uuid7();
                $keep[] = $vid;
                $sku = trim($vin['sku']);
                if (Variant::where('sku', $sku)->where('id', '!=', $vid)->exists()) {
                    throw new AppException('sku_taken', ['sku' => $sku]);
                }
                $prev = $old->get($vid);
                $retail = (int) ($vin['retailIQD'] ?? 0);
                $wholesale = (int) ($vin['wholesaleIQD'] ?? $retail);
                $cost = (int) ($vin['costIQD'] ?? 0);
                if ($prev && ($prev->retail_iqd !== $retail || $prev->wholesale_iqd !== $wholesale || $prev->cost_iqd !== $cost) && ! $actor->can('prices.edit')) {
                    throw AppException::forbidden('prices.edit');
                }
                if ($prev) {
                    foreach (['retail' => [$prev->retail_iqd, $retail], 'wholesale' => [$prev->wholesale_iqd, $wholesale], 'cost' => [$prev->cost_iqd, $cost]] as $what => [$from, $to]) {
                        if ($from !== $to) {
                            $priceChanges[] = ['size' => $prev->label, 'price' => $what, 'from' => $from, 'to' => $to];
                        }
                    }
                }
                $barcode = trim($vin['barcode'] ?? '');
                if ($barcode !== '' && Variant::where('barcode', $barcode)->where('id', '!=', $vid)->exists()) {
                    throw new AppException('barcode_taken', ['barcode' => $barcode]); // two products on one barcode would make scanning ambiguous
                }
                $barcode = $barcode ?: $this->nextBarcode();
                // size as printed on the bottle (ml or oz); `ml` is always derived so the two can't disagree
                [$size, $unit] = array_key_exists('size', $vin) ? [Size::clean($vin['size']), $vin['unit'] ?? 'ml'] : [Size::clean($vin['ml'] ?? 0), 'ml'];
                if (! in_array($unit, Size::UNITS, true)) {
                    throw new AppException('invalid_size');
                }
                $variant = $prev ?? new Variant(['id' => $vid]);
                $variant->fill([
                    'product_id' => $model->id, 'label' => trim($vin['label'] ?? '') ?: Size::label($size, $unit), 'size' => $size, 'unit' => $unit,
                    'ml' => Size::toMl($size, $unit), 'sku' => $sku, 'barcode' => $barcode,
                    'cost_iqd' => $cost, 'retail_iqd' => $retail, 'wholesale_iqd' => $wholesale, 'min_stock' => (int) ($vin['minStock'] ?? 5),
                    'is_tester' => (bool) ($vin['isTester'] ?? false), 'active' => (bool) ($vin['active'] ?? true),
                ])->save();
                if (! $prev && ($vin['openingStock'] ?? 0) > 0) {
                    $this->stock->applyMovement($variant->id, (int) $vin['openingStock'], 'opening', $actor, ['note' => 'Opening stock']);
                }
            }
            // sizes removed in the editor are deactivated (never hard-deleted: sales reference them)
            foreach ($old as $vid => $v) {
                if (! in_array($vid, $keep, true) && $v->active) {
                    $v->update(['active' => false]);
                }
            }
            $this->audit->log($actor, $isNew ? 'product.create' : 'product.update', 'product', $model->id, ['name' => $name['en'] ?: ($name['ar'] ?? ''), 'variants' => count($variants)] + ($priceChanges ? ['prices' => $priceChanges] : []));

            $model->load('variants');
            foreach ($model->variants as $v) {
                $v->setAttribute('stock_qty', $this->stock->quantity($v->id));
            }

            return $model;
        });
    }

    public function setActive(User $actor, string $id, bool $active): void
    {
        $this->need($actor, 'products.edit');
        (Product::find($id) ?? throw AppException::notFound())->update(['active' => $active]);
        $this->audit->log($actor, $active ? 'product.activate' : 'product.deactivate', 'product', $id);
    }

    /** @return 'deleted'|'deactivated' */
    public function delete(User $actor, string $id): string
    {
        $this->need($actor, 'products.delete');
        $product = Product::find($id) ?? throw AppException::notFound();
        $sold = DB::table('sale_items')->where('product_id', $id)->exists();
        if ($sold) {
            $product->update(['active' => false]);
            $this->audit->log($actor, 'product.deactivate', 'product', $id, ['reason' => 'has sales history']);

            return 'deactivated';
        }
        DB::transaction(function () use ($product, $actor, $id) {
            if ($product->image_path) {
                Storage::disk('public')->delete($product->image_path);
            }
            $product->delete(); // variants, stock and movements cascade
            DB::table('tombstones')->insert(['entity' => 'product', 'entity_id' => $id, 'deleted_at' => \App\Support\Time::nowMs()]);
            $this->audit->log($actor, 'product.delete', 'product', $id);
        });

        return 'deleted';
    }

    /** Raise/lower prices for many products at once (by % or a fixed IQD amount). Returns how many variants changed. */
    public function bulkPrice(User $actor, string $mode, float $value, string $target, ?array $productIds = null, int $step = 250): int
    {
        $this->need($actor, 'prices.edit');
        if ($value == 0.0 || ! in_array($mode, ['pct', 'fixed'], true) || ! in_array($target, ['retail', 'wholesale', 'both'], true)) {
            throw new AppException('invalid_price');
        }
        $adj = function (int $n) use ($mode, $value, $step): int {
            $raw = $mode === 'pct' ? $n * (1 + $value / 100) : $n + $value;
            $raw = max(0, $raw);

            return $step > 0 ? (int) (floor($raw / $step + 0.5) * $step) : (int) floor($raw + 0.5);
        };
        $count = 0;
        DB::transaction(function () use ($actor, $productIds, $target, $adj, $mode, $value, &$count) {
            $q = Variant::query()->when($productIds !== null, fn ($q) => $q->whereIn('product_id', $productIds));
            foreach ($q->get() as $v) {
                $patch = [];
                if ($target !== 'wholesale') {
                    $patch['retail_iqd'] = $adj($v->retail_iqd);
                }
                if ($target !== 'retail') {
                    $patch['wholesale_iqd'] = $adj($v->wholesale_iqd);
                }
                $v->update($patch);
                $count++;
            }
            $this->audit->log($actor, 'prices.bulk', 'variant', '*', ['mode' => $mode, 'value' => $value, 'target' => $target, 'count' => $count]);
        });

        return $count;
    }

    /**
     * Upsert from CSV rows the POS already parsed. Existing SKU → prices/barcode/min-stock updated;
     * new SKU → creates a variant (and a product when the product name is new).
     *
     * @param array<int, array<string, mixed>> $rows keys: sku, barcode, name_en, name_ar, name_ku, brand, category, gender, concentration, size_label, size, unit (ml|oz), cost_iqd, retail_iqd, wholesale_iqd, min_stock, stock — or legacy `ml` instead of size + unit
     * @return array{created: int, updated: int, skipped: int}
     */
    public function import(User $actor, array $rows): array
    {
        $this->need($actor, 'products.import');
        if (! $rows) {
            throw new AppException('nothing_to_import');
        }
        $created = $updated = $skipped = 0;
        $blank = ['sku' => '', 'barcode' => '', 'name_en' => '', 'name_ar' => '', 'name_ku' => '', 'brand' => '', 'category' => '', 'gender' => '', 'concentration' => '', 'size_label' => '', 'size' => '', 'unit' => '', 'ml' => '', 'wholesale_iqd' => '', 'min_stock' => null, 'stock' => 0];
        DB::transaction(function () use ($actor, $rows, $blank, &$created, &$updated, &$skipped) {
            // two sizes on one barcode would make scanning ambiguous
            $barcodeFree = fn (string $code, ?string $exceptId = null) => $code === '' || ! Variant::where('barcode', $code)->when($exceptId, fn ($q) => $q->where('id', '!=', $exceptId))->exists();
            // one product per name + brand; the name is whichever language was filled in (an Arabic-only or Kurdish-only
            // name is still a name), and an empty brand means the default brand — the same rule the product gets created with
            $key = fn (?string $en, ?string $ar, ?string $ku, ?string $brand) => Str::lower(trim((string) ($en ?: $ar ?: $ku)).'|'.(trim((string) $brand) ?: 'Lattafa'));
            $byKey = Product::all()->keyBy(fn (Product $p) => $key($p->name['en'] ?? '', $p->name['ar'] ?? '', $p->name['ku'] ?? '', $p->brand));
            $n = $byKey->count();
            foreach ($rows as $r) {
                $r += $blank; // a partial row (missing columns) must not blow up the whole import
                $sku = trim((string) $r['sku']);
                if ($sku === '') {
                    $skipped++;
                    continue;
                }
                $retail = (int) ($r['retail_iqd'] ?? 0);
                $cost = (int) ($r['cost_iqd'] ?? 0);
                $wholesale = (int) (($r['wholesale_iqd'] ?? '') !== '' ? $r['wholesale_iqd'] : $retail);
                $existing = Variant::where('sku', $sku)->first();
                $barcode = trim((string) ($r['barcode'] ?? ''));
                if (! $barcodeFree($barcode, $existing?->id)) {
                    throw new AppException('barcode_taken', ['barcode' => $barcode, 'sku' => $sku]);
                }
                if ($existing) {
                    $existing->update(['retail_iqd' => $retail, 'cost_iqd' => $cost, 'wholesale_iqd' => $wholesale, 'min_stock' => ($r['min_stock'] ?? '') !== '' ? (int) $r['min_stock'] : $existing->min_stock] + (! empty($r['barcode']) ? ['barcode' => $r['barcode']] : []));
                    $updated++;
                    continue;
                }
                $productKey = $key($r['name_en'], $r['name_ar'], $r['name_ku'], $r['brand']);
                $product = $byKey->get($productKey);
                if (! $product) {
                    if (trim((string) $r['name_en']) === '' && trim((string) $r['name_ar']) === '' && trim((string) $r['name_ku']) === '') {
                        $skipped++; // a brand-new SKU with no name at all can't become a product
                        continue;
                    }
                    $product = Product::create([
                        'id' => (string) Str::uuid7(),
                        'name' => ['en' => $r['name_en'] ?? '', 'ar' => $r['name_ar'] ?? '', 'ku' => $r['name_ku'] ?? ''],
                        'description' => ['en' => '', 'ar' => '', 'ku' => ''],
                        'brand' => trim((string) $r['brand']) ?: 'Lattafa', 'category' => $r['category'] ?: 'perfume',
                        'gender' => in_array($r['gender'] ?? '', ['men', 'women', 'unisex'], true) ? $r['gender'] : 'unisex',
                        'concentration' => $r['concentration'] ?: 'EDP', 'scent_families' => [], 'notes' => ['top' => [], 'heart' => [], 'base' => []],
                        'season' => 'all', 'longevity' => 3, 'sillage' => 3,
                        'art' => ['c1' => ['#8B4A2B', '#27365C', '#6A2F42', '#3E6B4F', '#B5442F', '#7A4FA0'][$n++ % 6], 'c2' => '#1A1714', 'shape' => 'rect'],
                    ]);
                    $byKey->put($productKey, $product);
                }
                // `size` + `unit` (ml | oz); files made before units existed only have an `ml` column
                $unit = Str::lower(trim((string) $r['unit'])) === 'oz' ? 'oz' : 'ml';
                $size = Size::clean($r['size'] !== '' && $r['size'] !== null ? $r['size'] : $r['ml']);
                $variant = Variant::create([
                    'id' => (string) Str::uuid7(), 'product_id' => $product->id,
                    'label' => trim((string) $r['size_label']) ?: Size::label($size, $unit), 'size' => $size, 'unit' => $unit, 'ml' => Size::toMl($size, $unit), 'sku' => $sku,
                    'barcode' => $barcode !== '' ? $barcode : $this->nextBarcode(), 'cost_iqd' => $cost, 'retail_iqd' => $retail,
                    'wholesale_iqd' => $wholesale, 'min_stock' => ($r['min_stock'] ?? '') !== '' ? (int) $r['min_stock'] : 5,
                ]);
                if (($r['stock'] ?? 0) > 0) {
                    $this->stock->applyMovement($variant->id, (int) $r['stock'], 'opening', $actor, ['note' => 'CSV import']);
                }
                $created++;
            }
            $this->audit->log($actor, 'products.import', 'product', '*', ['created' => $created, 'updated' => $updated]);
        });

        return ['created' => $created, 'updated' => $updated, 'skipped' => $skipped];
    }

    /** Internal EAN-13 (prefix 200 = in-store range) that nobody else is using. */
    public function nextBarcode(): string
    {
        for ($i = 0; $i < 50; $i++) {
            $body = substr('200'.str_pad((string) $this->counters->next('barcode'), 9, '0', STR_PAD_LEFT), 0, 12);
            $code = $body.self::ean13CheckDigit($body);
            if (! Variant::where('barcode', $code)->exists()) {
                return $code;
            }
        }
        throw new AppException('barcode_generation_failed');
    }

    public static function ean13CheckDigit(string $body12): int
    {
        $sum = 0;
        for ($i = 0; $i < 12; $i++) {
            $sum += (int) $body12[$i] * ($i % 2 === 0 ? 1 : 3);
        }

        return (10 - ($sum % 10)) % 10;
    }

    /** Stores a data-URL photo on the public disk; null removes it; an existing URL leaves it untouched. */
    private function storeImage(string $productId, ?string $image, ?string $currentPath): ?string
    {
        if ($image === null || $image === '') {
            if ($currentPath) {
                Storage::disk('public')->delete($currentPath);
            }

            return null;
        }
        if (! str_starts_with($image, 'data:image/')) {
            return $currentPath; // unchanged (client sent back the URL it already had)
        }
        if (! preg_match('#^data:image/(png|jpe?g|webp|gif);base64,(.+)$#s', $image, $m)) {
            throw new AppException('image_invalid');
        }
        $bytes = base64_decode($m[2], true);
        if ($bytes === false || strlen($bytes) > 3 * 1024 * 1024) {
            throw new AppException('image_invalid');
        }
        // trust the bytes, not the label: it must really be one of the allowed image types (nothing script-like ends up in public storage)
        $mime = @getimagesizefromstring($bytes)['mime'] ?? null;
        $ext = ['image/png' => 'png', 'image/jpeg' => 'jpg', 'image/webp' => 'webp', 'image/gif' => 'gif'][$mime] ?? throw new AppException('image_invalid');
        $path = 'products/'.$productId.'-'.Str::lower(Str::random(6)).'.'.$ext;
        Storage::disk('public')->put($path, $bytes);
        if ($currentPath) {
            Storage::disk('public')->delete($currentPath);
        }

        return $path;
    }

    /** Has this product been sold? (used by the admin UI to warn before delete) */
    public function hasSales(string $productId): bool
    {
        return Sale::query()->whereHas('items', fn ($q) => $q->where('product_id', $productId))->exists();
    }
}
