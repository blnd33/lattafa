<?php

namespace App\Services;

use App\Exceptions\AppException;
use App\Models\Product;
use App\Models\User;
use App\Models\Variant;
use App\Services\Concerns\RequiresPermission;
use App\Support\Time;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/**
 * The customer menu (the QR code in the shop): what it lists, in which order, and how it looks (prices shown, sold-out
 * perfumes hidden, the WhatsApp number orders go to). Admin panel → Customer menu arranges it and previews it live.
 */
class MenuService
{
    use RequiresPermission;

    public function __construct(private SettingsService $settings, private StockService $stock, private AuditService $audit, private MenuMedia $media) {}

    /**
     * The menu's own settings. `heroDim` = how much the photos/videos behind the top of the menu are darkened (0–85 %),
     * so the title stays readable on a bright picture.
     *
     * @return array{showPrices: bool, hideSoldOut: bool, whatsapp: string, heroDim: int}
     */
    public function settings(): array
    {
        $m = $this->settings->get()['menu'] ?? [];

        return [
            'showPrices' => (bool) ($m['showPrices'] ?? true), 'hideSoldOut' => (bool) ($m['hideSoldOut'] ?? false), 'whatsapp' => (string) ($m['whatsapp'] ?? ''),
            'heroDim' => (int) min(85, max(0, $m['heroDim'] ?? 45)),
        ];
    }

    /** What a guest sees: only perfumes on the menu, and only what a customer may know — never cost, wholesale price or stock counts. */
    public function public(): array
    {
        $menu = $this->settings();
        $products = $this->products(false)
            ->reject(fn (array $p) => $menu['hideSoldOut'] && collect($p['sizes'])->every(fn ($s) => ! $s['available']))
            ->map(function (array $p) use ($menu) {
                if (! $menu['showPrices']) { // the shop prefers guests to ask: the prices don't leave the server at all
                    $p['sizes'] = array_map(fn ($s) => ['priceIQD' => null] + $s, $p['sizes']);
                }

                return $p;
            })
            ->values();

        return $this->envelope($menu, $products);
    }

    /** Admin panel → Customer menu: every perfume that has a size for sale (hidden ones too), with its menu switches and place. */
    public function manage(User $actor): array
    {
        $this->need($actor, 'products.view');

        return $this->envelope($this->settings(), $this->products(true)->values()) + ['canEditSettings' => $actor->can('settings.edit')];
    }

    /**
     * Saves the menu as arranged in the admin panel.
     *
     * @param array<int, array{id: string, showOnMenu: bool, featured: bool, isNew: bool}> $products switches per perfume
     * @param array<int, string>|null $order every perfume in its new place; `null` = leave the order as it is
     * @param bool $autoOrder forget the arranged order (back to: featured first, then A–Z)
     * @param array{showPrices?: bool, hideSoldOut?: bool, whatsapp?: string|null, heroDim?: int}|null $settings
     */
    public function arrange(User $actor, array $products, ?array $order, bool $autoOrder, ?array $settings): array
    {
        $this->need($actor, 'products.edit');
        if ($settings !== null) {
            $this->need($actor, 'settings.edit');
        }
        $ids = array_values(array_unique(array_merge(array_column($products, 'id'), $order ?? [])));
        $found = Product::whereIn('id', $ids)->get()->keyBy('id');
        if ($found->count() !== count($ids)) {
            throw AppException::notFound();
        }

        DB::transaction(function () use ($actor, $products, $order, $autoOrder, $settings, $found) {
            $changed = 0;
            $place = $order === null ? [] : array_flip(array_values($order));
            foreach ($found as $id => $p) {
                $in = collect($products)->firstWhere('id', $id);
                if ($in) {
                    $p->fill(['show_on_menu' => (bool) $in['showOnMenu'], 'featured' => (bool) $in['featured'], 'is_new' => (bool) $in['isNew']]);
                }
                if (isset($place[$id])) {
                    $p->menu_order = $place[$id] + 1;
                }
                if ($p->isDirty()) { // only what really changed is touched, so the tills don't re-download the whole catalogue
                    $p->save();
                    $changed++;
                }
            }
            if ($autoOrder) {
                $changed += Product::whereNotNull('menu_order')->update(['menu_order' => null]);
            }
            $settingsChanged = [];
            if ($settings !== null) {
                $now = $this->settings();
                $next = [
                    'showPrices' => (bool) ($settings['showPrices'] ?? $now['showPrices']),
                    'hideSoldOut' => (bool) ($settings['hideSoldOut'] ?? $now['hideSoldOut']),
                    // an emptied box arrives as null (Laravel turns '' into null): back to the shop's own phone
                    'whatsapp' => array_key_exists('whatsapp', $settings) ? trim((string) $settings['whatsapp']) : $now['whatsapp'],
                    'heroDim' => (int) min(85, max(0, $settings['heroDim'] ?? $now['heroDim'])),
                ];
                if ($next !== $now) {
                    $this->settings->update($actor, ['menu' => $next], log: false); // one entry: this one, with the changes
                    $settingsChanged = SettingsService::changes($now, $next);
                }
            }
            $this->audit->log($actor, 'menu.update', 'menu', 'menu', ['products' => $changed, 'order' => $autoOrder ? 'automatic' : ($order === null ? 'unchanged' : 'arranged')]
                + ($settingsChanged ? ['changes' => $settingsChanged] : []));
        });

        return $this->manage($actor);
    }

    /** A–Z by the English name; a perfume named only in Arabic or Kurdish sorts by that name (after the Latin ones), not first. */
    private static function sortName(Product $p): string
    {
        return mb_strtolower(($p->name['en'] ?? '') ?: (($p->name['ar'] ?? '') ?: ($p->name['ku'] ?? '')));
    }

    /** @param Collection<int, array<string, mixed>> $products */
    private function envelope(array $menu, Collection $products): array
    {
        $s = $this->settings->get();

        return [
            'store' => [
                'name' => $s['store']['name'], 'tagline' => $s['store']['tagline'] ?? '', 'phone' => $s['store']['phone'] ?? '',
                'address' => $s['store']['address'] ?? '', 'city' => $s['store']['city'] ?? '',
            ],
            'currency' => ['rate' => $s['currency']['rate'], 'usdEnabled' => (bool) $s['currency']['usdEnabled']],
            'menu' => $menu + ['hero' => $this->media->items()],
            'products' => $products,
            'updatedAt' => Time::nowMs(),
        ];
    }

    /**
     * Active perfumes with at least one size for sale, in menu order: the arranged ones by their place, then the rest
     * featured first and A–Z. With `$all`, hidden ones too, plus their switches and place (for the admin panel).
     *
     * @return Collection<int, array<string, mixed>>
     */
    private function products(bool $all): Collection
    {
        $qty = $this->stock->map();

        return Product::query()
            ->with(['variants' => fn ($q) => $q->where('active', true)->where('is_tester', false)->orderByDesc('ml')])
            ->where('active', true)
            ->when(! $all, fn ($q) => $q->where('show_on_menu', true))
            ->get()
            ->filter(fn (Product $p) => $p->variants->isNotEmpty())
            ->sortBy(fn (Product $p) => [$p->menu_order === null ? 1 : 0, $p->menu_order ?? 0, $p->featured ? 0 : 1, self::sortName($p)])
            ->map(fn (Product $p) => [
                'id' => $p->id, 'name' => $p->name, 'description' => $p->description, 'brand' => $p->brand, 'category' => $p->category,
                'gender' => $p->gender, 'concentration' => $p->concentration, 'scentFamilies' => $p->scent_families, 'notes' => $p->notes,
                'season' => $p->season, 'longevity' => $p->longevity, 'sillage' => $p->sillage,
                'image' => $p->image_path ? Storage::disk('public')->url($p->image_path) : null, 'art' => $p->art,
                'featured' => $p->featured, 'isNew' => $p->is_new,
                'sizes' => $p->variants->map(fn (Variant $v) => [
                    'id' => $v->id, 'label' => $v->label, 'size' => (float) $v->size, 'unit' => $v->unit, 'ml' => $v->ml,
                    'priceIQD' => $v->retail_iqd, 'available' => ($qty[$v->id] ?? 0) > 0,
                ])->values()->all(),
            ] + ($all ? ['showOnMenu' => $p->show_on_menu, 'order' => $p->menu_order] : []));
    }
}
