<?php

namespace App\Services\Catalogue;

use App\Exceptions\AppException;
use App\Models\CatalogueCollection;
use App\Models\CatalogueCollectionProduct;
use App\Models\CatalogueProductImage;
use App\Models\CatalogueProductSetting;
use App\Models\CatalogueProductTranslation;
use App\Models\Product;
use App\Models\User;
use App\Services\AuditService;
use App\Services\Concerns\RequiresPermission;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * What the catalogue adds to a perfume the POS owns.
 *
 * The line is the one the brief draws in §8 and it is not crossed anywhere here: the POS owns the perfume — its
 * identity, SKU, barcode, category, stock — and the catalogue owns how it is *presented*. So nothing in this file
 * writes to `products` or `variants`. Extra photographs, editorial collections, per-language copy and whether a
 * perfume appears in this channel at all live in the catalogue's own tables, and a shop that never opens these
 * screens still gets a sensible catalogue from what the POS already knows.
 */
class EnrichmentService
{
    use RequiresPermission;

    public function __construct(private AuditService $audit, private AppearanceService $files) {}

    // ───────────────────────── collections ─────────────────────────

    /** @return \Illuminate\Database\Eloquent\Collection<int, CatalogueCollection> */
    public function collections(User $actor)
    {
        $this->need($actor, 'catalogue.view');

        return CatalogueCollection::withCount('items')->with('items')->orderBy('sort')->orderBy('slug')->get();
    }

    /**
     * @param  array{id?: string|null, slug?: string, name: array<string, string>, description?: array<string, string>, enabled?: bool, featured?: bool, sort?: int, image?: string|null}  $in
     */
    public function saveCollection(User $actor, array $in): CatalogueCollection
    {
        $this->need($actor, 'catalogue.products');

        $names = array_filter(array_map('trim', $in['name'] ?? []), fn (string $v) => $v !== '');
        if (! $names) {
            throw new AppException('collection_name_required');
        }

        $slug = Str::slug($in['slug'] ?? '') ?: Str::slug($names['en'] ?? reset($names));
        if ($slug === '') {
            throw new AppException('collection_name_required');
        }
        if (CatalogueCollection::where('slug', $slug)->when($in['id'] ?? null, fn ($q, $id) => $q->whereKeyNot($id))->exists()) {
            throw new AppException('collection_exists', ['slug' => $slug]);
        }

        $collection = isset($in['id']) ? CatalogueCollection::findOrFail($in['id']) : new CatalogueCollection();
        $was = $collection->image_path;

        $collection->fill([
            'slug' => $slug,
            'name' => $names,
            'description' => array_filter(array_map('trim', $in['description'] ?? []), fn (string $v) => $v !== ''),
            'enabled' => (bool) ($in['enabled'] ?? true),
            'featured' => (bool) ($in['featured'] ?? false),
            'sort' => (int) ($in['sort'] ?? 0),
        ]);

        if (array_key_exists('image', $in)) {
            $image = $in['image'];
            if ($image === null || $image === '') {
                $collection->image_path = null;
            } elseif (str_starts_with((string) $image, 'data:image/')) {
                $collection->image_path = $this->files->store((string) $image, 'catalogue/collections');
            }
            // anything else is the URL it already had, left alone
        }

        $collection->save();
        if ($was && $was !== $collection->image_path) {
            $this->files->forget($was);
        }

        $this->audit->log($actor, 'catalogue.collection_saved', 'catalogue_collection', $collection->id, ['name' => $collection->nameIn('en')]);

        return $collection->fresh();
    }

    public function deleteCollection(User $actor, string $id): void
    {
        $this->need($actor, 'catalogue.products');
        $collection = CatalogueCollection::findOrFail($id);

        DB::transaction(function () use ($collection, $actor) {
            $image = $collection->image_path;
            $collection->delete();   // its places go with it (cascade); no perfume is touched
            $this->files->forget($image);
            $this->audit->log($actor, 'catalogue.collection_deleted', 'catalogue_collection', $collection->id, ['name' => $collection->nameIn('en')]);
        });
    }

    /**
     * Sets exactly which perfumes are in a collection, in this order.
     *
     * @param  string[]  $productIds
     */
    public function setCollectionProducts(User $actor, string $collectionId, array $productIds): int
    {
        $this->need($actor, 'catalogue.products');
        $collection = CatalogueCollection::findOrFail($collectionId);

        $known = Product::whereIn('id', $productIds)->pluck('id')->all();
        $ordered = array_values(array_filter($productIds, fn (string $id) => in_array($id, $known, true)));

        DB::transaction(function () use ($collection, $ordered) {
            CatalogueCollectionProduct::where('collection_id', $collection->id)->delete();
            foreach ($ordered as $i => $productId) {
                CatalogueCollectionProduct::create([
                    'collection_id' => $collection->id, 'product_id' => $productId, 'sort' => $i,
                ]);
            }
        });

        $this->audit->log($actor, 'catalogue.collection_filled', 'catalogue_collection', $collection->id, [
            'name' => $collection->nameIn('en'), 'perfumes' => count($ordered),
        ]);

        return count($ordered);
    }

    // ───────────────────────── one perfume, as the catalogue shows it ─────────────────────────

    /**
     * Everything the catalogue holds about one perfume, beside what the POS owns.
     *
     * @return array<string, mixed>
     */
    public function product(User $actor, string $productId): array
    {
        $this->need($actor, 'catalogue.view');
        $product = Product::with('variants')->findOrFail($productId);
        $settings = CatalogueProductSetting::find($productId);

        return [
            // the POS's, shown so the owner can see it — and never written from here
            'fromThePos' => [
                'id' => $product->id,
                'name' => $product->name,
                'description' => $product->description,
                'brand' => $product->brand,
                'category' => $product->category,
                'gender' => $product->gender,
                'concentration' => $product->concentration,
                'notes' => $product->notes,
                'image' => $product->image_path ? Storage::disk('public')->url($product->image_path) : null,
                'featured' => $product->featured,
                'isNew' => $product->is_new,
                'active' => $product->active,
            ],
            'hidden' => (bool) ($settings->hidden ?? false),
            'featured' => $settings?->featured,          // null = follow the POS flag
            'images' => CatalogueProductImage::where('product_id', $productId)->orderBy('sort')->get()
                ->map(fn (CatalogueProductImage $i) => ['id' => $i->id, 'url' => Storage::disk('public')->url($i->path), 'sort' => $i->sort])->all(),
            'translations' => CatalogueProductTranslation::where('product_id', $productId)->get()
                ->map(fn (CatalogueProductTranslation $t) => [
                    'language' => $t->language_code, 'name' => $t->display_name, 'description' => $t->description, 'notes' => $t->notes,
                ])->all(),
            'collections' => CatalogueCollectionProduct::where('product_id', $productId)->pluck('collection_id')->all(),
        ];
    }

    /** @param array{hidden?: bool, featured?: bool|null, sort?: int|null} $in */
    public function setProduct(User $actor, string $productId, array $in): void
    {
        $this->need($actor, 'catalogue.products');
        Product::findOrFail($productId);

        CatalogueProductSetting::updateOrCreate(['product_id' => $productId], array_filter([
            'hidden' => array_key_exists('hidden', $in) ? (bool) $in['hidden'] : null,
            'featured' => array_key_exists('featured', $in) ? ($in['featured'] === null ? null : (bool) $in['featured']) : null,
            'sort' => array_key_exists('sort', $in) ? $in['sort'] : null,
        ], fn ($v, $k) => array_key_exists($k, $in), ARRAY_FILTER_USE_BOTH));

        $this->audit->log($actor, 'catalogue.product_presented', 'product', $productId, array_intersect_key($in, array_flip(['hidden', 'featured'])));
    }

    /** What one language says differently about a perfume. Empty fields fall back to the shop's own words. */
    public function setProductText(User $actor, string $productId, string $language, array $in): void
    {
        $this->need($actor, 'catalogue.translations');
        Product::findOrFail($productId);

        $name = trim($in['name'] ?? '');
        $description = trim($in['description'] ?? '');
        $notes = $in['notes'] ?? null;

        if ($name === '' && $description === '' && ! $notes) {
            CatalogueProductTranslation::where('product_id', $productId)->where('language_code', $language)->delete();
        } else {
            CatalogueProductTranslation::updateOrCreate(
                ['product_id' => $productId, 'language_code' => $language],
                ['display_name' => $name ?: null, 'description' => $description ?: null, 'notes' => $notes ?: null],
            );
        }

        $this->audit->log($actor, 'catalogue.product_translated', 'product', $productId, ['language' => $language]);
    }

    /** Adds a photograph. The product's own stays the first one a buyer sees; these come after it. */
    public function addImage(User $actor, string $productId, string $dataUrl): CatalogueProductImage
    {
        $this->need($actor, 'catalogue.products');
        Product::findOrFail($productId);

        $last = (int) CatalogueProductImage::where('product_id', $productId)->max('sort');
        $image = CatalogueProductImage::create([
            'product_id' => $productId,
            'path' => $this->files->store($dataUrl, 'catalogue/products'),
            'sort' => $last + 1,
        ]);

        $this->audit->log($actor, 'catalogue.image_added', 'product', $productId, []);

        return $image;
    }

    public function deleteImage(User $actor, string $imageId): void
    {
        $this->need($actor, 'catalogue.products');
        $image = CatalogueProductImage::findOrFail($imageId);
        $image->delete();
        $this->files->forget($image->path);

        $this->audit->log($actor, 'catalogue.image_removed', 'product', $image->product_id, []);
    }
}
