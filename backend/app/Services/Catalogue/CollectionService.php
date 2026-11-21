<?php

namespace App\Services\Catalogue;

use App\Models\CatalogueCollection;
use App\Models\CatalogueOrderRule;
use App\Models\Product;
use App\Models\Variant;
use Illuminate\Support\Facades\Storage;

/**
 * The collection as a visitor meets it: every perfume, in their language, with nothing they are not entitled to.
 *
 * **There is no price in anything this class returns, ever.** Not hidden, not nulled — the fields are not built.
 * A buyer's own prices come from `GET /wholesale/prices`, which lives behind the `wholesale` middleware, so the
 * two can never be confused and no filter can be forgotten. Availability is a yes or no for the same reason: the
 * number on the shop's shelf is nobody else's business.
 */
class CollectionService
{
    public function __construct(private TranslationService $translations, private Inventory $inventory) {}

    /**
     * The whole collection in one language.
     *
     * The smallest quantity and the step shown here are the shop's general rules; a buyer who has been let off one
     * of them sees their own figures in their price list, which is worked out per business.
     *
     * @return array{products: array<int, array<string, mixed>>, categories: array<int, array{key: string, count: int}>, brands: array<int, string>}
     */
    public function all(string $language): array
    {
        $stock = $this->inventory->availableMap();
        [$minQty, $step] = $this->ruleColumns();

        $products = Product::with(['variants', 'catalogueTranslations', 'catalogueImages', 'catalogueSetting'])
            ->where('active', true)
            ->get()
            // a perfume the owner has hidden from this channel: still the shop's, just not shown here
            ->reject(fn (Product $p) => (bool) ($p->catalogueSetting?->hidden ?? false))
            ->map(function (Product $p) use ($language, $stock, $minQty, $step) {
                $sizes = $p->variants
                    ->filter(fn (Variant $v) => $v->active && ! $v->is_tester)
                    ->sortBy('ml')
                    ->map(fn (Variant $v) => [
                        'variantId' => $v->id,
                        'sku' => $v->sku,
                        'label' => $v->label,
                        'size' => (float) $v->size,
                        'unit' => $v->unit,
                        'ml' => $v->ml,
                        // the only thing a buyer is told about the shelf
                        'inStock' => ($stock[$v->id] ?? 0) > 0,
                        'minQty' => $minQty[$p->category] ?? $minQty[''] ?? 0,
                        'step' => $step[$p->category] ?? $step[''] ?? 0,
                    ])->values();

                if ($sizes->isEmpty()) {
                    return null;   // a perfume with nothing to sell is not in the catalogue
                }

                $text = $this->translations->productText($p, $language);

                return [
                    'id' => $p->id,
                    'name' => $text['name'],
                    'description' => $text['description'],
                    'notes' => $text['notes'],
                    'brand' => $p->brand,
                    'category' => $p->category,
                    'gender' => $p->gender,
                    'concentration' => $p->concentration,
                    'scentFamilies' => $p->scent_families,
                    'season' => $p->season,
                    'longevity' => $p->longevity,
                    'sillage' => $p->sillage,
                    // the product's own photograph first, then whatever the catalogue has added
                    'image' => $p->image_path ? Storage::disk('public')->url($p->image_path) : null,
                    'images' => array_values(array_filter([
                        $p->image_path ? Storage::disk('public')->url($p->image_path) : null,
                        ...$p->catalogueImages->sortBy('sort')->map(fn ($i) => Storage::disk('public')->url($i->path))->all(),
                    ])),
                    'art' => $p->art,
                    // the catalogue's own view of it where there is one, else what the shop marked on the product
                    'featured' => $p->catalogueSetting?->featured ?? $p->featured,
                    'isNew' => $p->is_new,
                    'inStock' => $sizes->contains(fn (array $s) => $s['inStock']),
                    'sizes' => $sizes->all(),
                ];
            })
            ->filter()
            ->sortBy([['featured', 'desc'], ['name', 'asc']])
            ->values();

        $categories = $products->groupBy('category')
            ->map(fn ($group, $key) => ['key' => (string) $key, 'count' => $group->count()])
            ->sortByDesc('count')->values()->all();

        return [
            'products' => $products->all(),
            'categories' => $categories,
            'brands' => $products->pluck('brand')->unique()->filter()->sort()->values()->all(),
            'collections' => $this->collections($language, $products->pluck('id')->all()),
        ];
    }

    /**
     * The editorial collections a visitor can browse — the owner's own groupings, not the POS categories.
     *
     * A collection only lists perfumes that are actually in the catalogue, so hiding one empties it out of every
     * collection at once rather than leaving a card that leads nowhere.
     *
     * @param  string[]  $shown  the perfumes this catalogue is showing
     * @return array<int, array<string, mixed>>
     */
    private function collections(string $language, array $shown): array
    {
        $visible = array_flip($shown);

        return CatalogueCollection::with('items')
            ->where('enabled', true)->orderBy('sort')->orderBy('slug')->get()
            ->map(function (CatalogueCollection $c) use ($language, $visible) {
                $products = $c->items->sortBy('sort')->pluck('product_id')
                    ->filter(fn (string $id) => isset($visible[$id]))->values()->all();

                return $products === [] ? null : [
                    'id' => $c->id,
                    'slug' => $c->slug,
                    'name' => $c->nameIn($language),
                    'description' => (string) ($c->description[$language] ?? $c->description['en'] ?? ''),
                    'image' => $c->image_path ? Storage::disk('public')->url($c->image_path) : null,
                    'featured' => $c->featured,
                    'products' => $products,
                ];
            })
            ->filter()->values()->all();
    }

    /**
     * The shop's general smallest-quantity and step, per category, as `['' => general, 'oud' => …]`.
     *
     * @return array{0: array<string, int>, 1: array<string, int>}
     */
    private function ruleColumns(): array
    {
        $minQty = [];
        $step = [];
        foreach (CatalogueOrderRule::where('enabled', true)->get() as $rule) {
            $key = $rule->scope === 'global' ? '' : $rule->scope_id;
            $minQty[$key] = $rule->min_qty;
            $step[$key] = $rule->qty_increment;
        }

        return [$minQty, $step];
    }
}
