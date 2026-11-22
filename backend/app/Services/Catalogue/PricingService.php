<?php

namespace App\Services\Catalogue;

use App\Exceptions\AppException;
use App\Models\CatalogueCountry;
use App\Models\CatalogueCountryPrice;
use App\Models\CatalogueCustomerDiscount;
use App\Models\CatalogueCustomerPrice;
use App\Models\CataloguePriceHistory;
use App\Models\User;
use App\Models\Variant;
use App\Models\WholesaleCustomer;
use App\Services\AuditService;
use App\Services\Concerns\RequiresPermission;
use App\Support\CataloguePricing;
use App\Support\Time;
use Illuminate\Support\Facades\DB;

/**
 * Wholesale prices: what each country pays, what a particular business has been promised, and the trail of who
 * changed which figure.
 *
 * The arithmetic itself is not here — it is in `App\Support\CataloguePricing`, with no database behind it, so the
 * order of priority is decided in one place and tested on its own. This service's job is to fetch the right
 * figures, write them down safely, and never let a price reach anyone who has not unlocked the catalogue.
 */
class PricingService
{
    use RequiresPermission;

    public function __construct(private AuditService $audit) {}

    // ───────────────────────── what one buyer pays ─────────────────────────

    /**
     * Every price this business sees, as `[variantId => ['cents', 'baseCents', 'source', 'percentBp']]`.
     *
     * Four queries however many perfumes there are: the sizes, the country's prices, what this business has been
     * promised, and whether it has a discount across the board.
     *
     * @param  string[]|null  $variantIds  a subset, or null for everything on sale
     * @return array<string, array{cents: int|null, baseCents: int|null, source: string, percentBp: int|null}>
     */
    public function forCustomer(?WholesaleCustomer $customer, ?CatalogueCountry $country, ?array $variantIds = null): array
    {
        $now = Time::nowMs();

        $variants = Variant::query()
            ->when($variantIds !== null, fn ($q) => $q->whereIn('id', $variantIds))
            ->where('active', true)->where('is_tester', false)
            ->pluck('wholesale_usd_cents', 'id');

        $countryPrices = $country
            ? CatalogueCountryPrice::where('country_id', $country->id)
                ->when($variantIds !== null, fn ($q) => $q->whereIn('variant_id', $variantIds))
                ->pluck('price_cents', 'variant_id')
            : collect();

        $customerPrices = collect();
        $widePercent = null;

        if ($customer) {
            $customerPrices = CatalogueCustomerPrice::where('customer_id', $customer->id)
                ->when($variantIds !== null, fn ($q) => $q->whereIn('variant_id', $variantIds))
                ->get()
                ->filter(fn (CatalogueCustomerPrice $p) => $p->inForce($now))
                ->keyBy('variant_id');

            // several can be on file with different dates; the one that started most recently and is still in
            // date is the one in force, so a seasonal agreement can be set up ahead of time
            $widePercent = CatalogueCustomerDiscount::where('customer_id', $customer->id)
                ->orderByRaw('COALESCE(valid_from, 0) DESC')->orderByDesc('created_at')->get()
                ->first(fn (CatalogueCustomerDiscount $d) => $d->inForce($now))?->percent_off_bp;
        }

        $out = [];
        foreach ($variants as $variantId => $listCents) {
            $own = $customerPrices->get($variantId);
            $out[$variantId] = CataloguePricing::unit(
                (int) $listCents,
                $countryPrices->get($variantId) !== null ? (int) $countryPrices->get($variantId) : null,
                $own?->price_cents,
                $own?->percent_off_bp,
                $widePercent,
            );
        }

        return $out;
    }

    // ───────────────────────── one country's price list ─────────────────────────

    /**
     * The price grid for one country: every size on sale, what the delegate's dollar list says, and what this
     * country charges (empty where it has not been set and falls back to the list).
     *
     * @param  array{q?: string, missing?: bool}  $filters
     * @return array<int, array<string, mixed>>
     */
    public function countryGrid(User $actor, string $countryId, array $filters = []): array
    {
        $this->need($actor, 'catalogue.prices');
        $country = CatalogueCountry::findOrFail($countryId);

        $prices = CatalogueCountryPrice::where('country_id', $country->id)->pluck('price_cents', 'variant_id');
        $q = trim($filters['q'] ?? '');

        $rows = Variant::with('product')->where('active', true)->where('is_tester', false)
            ->when($q !== '', function ($b) use ($q) {
                $like = '%'.str_replace(['%', '_'], ['\%', '\_'], $q).'%';
                $b->where(fn ($w) => $w->where('sku', 'like', $like)->orWhere('barcode', 'like', $like)
                    ->orWhereHas('product', fn ($p) => $p->where('name', 'like', $like)->orWhere('brand', 'like', $like)));
            })
            ->get()
            ->map(function (Variant $v) use ($prices) {
                $own = $prices->get($v->id);

                return [
                    'variantId' => $v->id,
                    'productId' => $v->product_id,
                    'name' => self::productName($v->product),
                    'brand' => $v->product?->brand ?? '',
                    'category' => $v->product?->category ?? '',
                    'sku' => $v->sku,
                    'label' => $v->label,
                    'ml' => $v->ml,
                    'listCents' => (int) $v->wholesale_usd_cents,        // the delegate's dollar list, the fallback
                    'priceCents' => $own === null ? null : (int) $own,   // this country's own price, if it has one
                    'effectiveCents' => $own !== null ? (int) $own : ((int) $v->wholesale_usd_cents ?: null),
                ];
            });

        if ($filters['missing'] ?? false) {
            $rows = $rows->filter(fn (array $r) => $r['effectiveCents'] === null);
        }

        // 'asc' spelled out: a bare `false` here is Laravel's way of saying *descending*, which put the grid in
        // reverse alphabetical order
        return $rows->sortBy([['name', 'asc'], ['ml', 'asc']])->values()->all();
    }

    /**
     * Writes one country's prices. `null` takes a price away, so the size falls back to the dollar list again.
     *
     * @param  array<string, int|null>  $prices  variantId => cents
     */
    public function saveCountryPrices(User $actor, string $countryId, array $prices): int
    {
        $this->need($actor, 'catalogue.prices');
        $country = CatalogueCountry::findOrFail($countryId);

        $known = Variant::whereIn('id', array_keys($prices))->pluck('id')->flip();
        $changed = 0;

        DB::transaction(function () use ($actor, $country, $prices, $known, &$changed) {
            $existing = CatalogueCountryPrice::where('country_id', $country->id)
                ->whereIn('variant_id', array_keys($prices))->get()->keyBy('variant_id');

            foreach ($prices as $variantId => $cents) {
                if (! $known->has($variantId)) {
                    continue;   // a size that is not on file is ignored, never created
                }
                $row = $existing->get($variantId);
                $was = $row?->price_cents;
                $now = $cents === null ? null : max(0, (int) $cents);

                if ($was === $now) {
                    continue;
                }
                if ($now === null) {
                    $row?->delete();
                } elseif ($row) {
                    $row->update(['price_cents' => $now]);
                } else {
                    CatalogueCountryPrice::create(['country_id' => $country->id, 'variant_id' => $variantId, 'price_cents' => $now]);
                }

                $this->remember($actor, 'country', $country->id, $variantId, $was, $now);
                $changed++;
            }
        });

        if ($changed) {
            $this->audit->log($actor, 'catalogue.prices_country', 'catalogue_country', $country->id, [
                'iso2' => $country->iso2, 'changed' => $changed,
            ]);
        }

        return $changed;
    }

    // ───────────────────────── one business's own terms ─────────────────────────

    /**
     * What this business has been promised: the sizes with a price or a percentage of their own, and the
     * discount across its whole order if it has one.
     *
     * @return array{prices: array<int, array<string, mixed>>, discount: array<string, mixed>|null}
     */
    public function customerTerms(User $actor, string $customerId): array
    {
        $this->need($actor, 'catalogue.prices');
        $customer = WholesaleCustomer::findOrFail($customerId);
        $now = Time::nowMs();

        $rows = CatalogueCustomerPrice::with('variant.product')->where('customer_id', $customer->id)->get()
            ->map(fn (CatalogueCustomerPrice $p) => [
                'variantId' => $p->variant_id,
                'name' => self::productName($p->variant?->product),
                'sku' => $p->variant?->sku ?? '',
                'label' => $p->variant?->label ?? '',
                'priceCents' => $p->price_cents,
                'percentBp' => $p->percent_off_bp,
                'validFrom' => $p->valid_from,
                'validTo' => $p->valid_to,
                'inForce' => $p->inForce($now),
            ])->sortBy('name')->values()->all();

        $discount = CatalogueCustomerDiscount::where('customer_id', $customer->id)
            ->orderByRaw('COALESCE(valid_from, 0) DESC')->orderByDesc('created_at')->get()
            ->first(fn (CatalogueCustomerDiscount $d) => $d->inForce($now));

        return [
            'prices' => $rows,
            'discount' => $discount ? [
                'id' => $discount->id, 'percentBp' => $discount->percent_off_bp,
                'validFrom' => $discount->valid_from, 'validTo' => $discount->valid_to,
            ] : null,
        ];
    }

    /**
     * Agrees prices with one business. Each entry is `{price}` **or** `{percentBp}`, never both; `null` for both
     * withdraws the agreement and the buyer goes back to the country's price.
     *
     * @param  array<string, array{priceCents?: int|null, percentBp?: int|null, validFrom?: int|null, validTo?: int|null}>  $terms
     */
    public function saveCustomerPrices(User $actor, string $customerId, array $terms): int
    {
        $this->need($actor, 'catalogue.prices');
        $customer = WholesaleCustomer::findOrFail($customerId);
        $known = Variant::whereIn('id', array_keys($terms))->pluck('id')->flip();
        $changed = 0;

        DB::transaction(function () use ($actor, $customer, $terms, $known, &$changed) {
            $existing = CatalogueCustomerPrice::where('customer_id', $customer->id)
                ->whereIn('variant_id', array_keys($terms))->get()->keyBy('variant_id');

            foreach ($terms as $variantId => $term) {
                if (! $known->has($variantId)) {
                    continue;
                }
                $cents = isset($term['priceCents']) && $term['priceCents'] !== null ? max(0, (int) $term['priceCents']) : null;
                $bp = isset($term['percentBp']) && $term['percentBp'] !== null ? CataloguePricing::clampBp((int) $term['percentBp']) : null;

                if ($cents !== null && $bp !== null) {
                    throw new AppException('price_or_percent', ['sku' => Variant::whereKey($variantId)->value('sku') ?? '']);
                }

                $row = $existing->get($variantId);
                $wasCents = $row?->price_cents;
                $wasBp = $row?->percent_off_bp;

                if ($cents === null && $bp === null) {
                    if ($row) {
                        $row->delete();
                        $this->remember($actor, 'customer', $customer->id, $variantId, $wasCents, null, $wasBp, null);
                        $changed++;
                    }

                    continue;
                }

                $attrs = [
                    'price_cents' => $cents, 'percent_off_bp' => $bp,
                    'valid_from' => $term['validFrom'] ?? null, 'valid_to' => $term['validTo'] ?? null,
                ];
                if ($row) {
                    if ($wasCents === $cents && $wasBp === $bp && $row->valid_from === ($attrs['valid_from'] ?? null) && $row->valid_to === ($attrs['valid_to'] ?? null)) {
                        continue;
                    }
                    $row->update($attrs);
                } else {
                    CatalogueCustomerPrice::create($attrs + ['customer_id' => $customer->id, 'variant_id' => $variantId]);
                }

                $this->remember($actor, 'customer', $customer->id, $variantId, $wasCents, $cents, $wasBp, $bp);
                $changed++;
            }
        });

        if ($changed) {
            $this->audit->log($actor, 'catalogue.prices_customer', 'wholesale_customer', $customer->id, [
                'business' => $customer->business_name, 'changed' => $changed,
            ]);
        }

        return $changed;
    }

    /** A percentage off everything this business buys. `null` withdraws it. */
    public function setCustomerDiscount(User $actor, string $customerId, ?int $percentBp, ?int $from = null, ?int $to = null): ?CatalogueCustomerDiscount
    {
        $this->need($actor, 'catalogue.prices');
        $customer = WholesaleCustomer::findOrFail($customerId);
        $now = Time::nowMs();

        $live = CatalogueCustomerDiscount::where('customer_id', $customer->id)
            ->orderByRaw('COALESCE(valid_from, 0) DESC')->orderByDesc('created_at')->get()
            ->first(fn (CatalogueCustomerDiscount $d) => $d->inForce($now));

        return DB::transaction(function () use ($actor, $customer, $percentBp, $from, $to, $live, $now) {
            if ($percentBp === null) {
                if (! $live) {
                    return null;
                }
                // ended today rather than deleted, so the trail of what was agreed when survives
                $live->update(['valid_to' => $now]);
                $this->remember($actor, 'customer_wide', $customer->id, null, null, null, $live->percent_off_bp, null);
                $this->audit->log($actor, 'catalogue.discount_set', 'wholesale_customer', $customer->id, [
                    'business' => $customer->business_name, 'percent' => [$live->percent_off_bp / 100, null],
                ]);

                return null;
            }

            $bp = CataloguePricing::clampBp($percentBp);
            $live?->update(['valid_to' => $from ?? $now]);
            $discount = CatalogueCustomerDiscount::create([
                'customer_id' => $customer->id, 'percent_off_bp' => $bp, 'valid_from' => $from, 'valid_to' => $to,
            ]);

            $this->remember($actor, 'customer_wide', $customer->id, null, null, null, $live?->percent_off_bp, $bp);
            $this->audit->log($actor, 'catalogue.discount_set', 'wholesale_customer', $customer->id, [
                'business' => $customer->business_name, 'percent' => [$live ? $live->percent_off_bp / 100 : null, $bp / 100],
            ]);

            return $discount;
        });
    }

    // ───────────────────────── the trail ─────────────────────────

    /**
     * @param  array{scope?: string, scopeId?: string, variantId?: string, limit?: int}  $filters
     * @return \Illuminate\Database\Eloquent\Collection<int, CataloguePriceHistory>
     */
    public function history(User $actor, array $filters = [])
    {
        $this->need($actor, 'catalogue.prices');

        return CataloguePriceHistory::query()
            ->when($filters['scope'] ?? null, fn ($b, $s) => $b->where('scope', $s))
            ->when($filters['scopeId'] ?? null, fn ($b, $s) => $b->where('scope_id', $s))
            ->when($filters['variantId'] ?? null, fn ($b, $v) => $b->where('variant_id', $v))
            ->orderByDesc('occurred_at')
            ->limit(min(500, max(1, (int) ($filters['limit'] ?? 200))))
            ->get();
    }

    private function remember(User $actor, string $scope, string $scopeId, ?string $variantId, ?int $fromCents, ?int $toCents, ?int $fromBp = null, ?int $toBp = null): void
    {
        CataloguePriceHistory::create([
            'scope' => $scope, 'scope_id' => $scopeId, 'variant_id' => $variantId,
            'from_cents' => $fromCents, 'to_cents' => $toCents,
            'from_percent_bp' => $fromBp, 'to_percent_bp' => $toBp,
            'user_id' => $actor->id, 'user_name' => $actor->name, 'occurred_at' => Time::nowMs(),
        ]);
    }

    /**
     * A perfume's name in whichever language it has one, for an admin grid. Every language is stored as text, empty
     * where the perfume was never named in it, so an empty English name must fall through to Arabic and Kurdish —
     * `??` alone stops at the empty string and the grid showed nothing but the brand.
     */
    public static function productName(mixed $product): string
    {
        $name = $product?->name ?? [];
        foreach (['en', 'ar', 'ku'] as $language) {
            $text = trim((string) ($name[$language] ?? ''));
            if ($text !== '') {
                return $text;
            }
        }

        return '';
    }
}
