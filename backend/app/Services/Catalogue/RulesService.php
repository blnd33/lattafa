<?php

namespace App\Services\Catalogue;

use App\Exceptions\AppException;
use App\Models\CatalogueCountry;
use App\Models\CatalogueOrderRule;
use App\Models\CatalogueRuleExemption;
use App\Models\User;
use App\Models\Variant;
use App\Models\WholesaleCustomer;
use App\Services\AuditService;
use App\Services\Concerns\RequiresPermission;
use App\Support\CatalogueRules;
use Illuminate\Support\Facades\DB;

/**
 * The smallest order the shop will take, and the steps it sells in.
 *
 * The arithmetic is in `App\Support\CatalogueRules`, with nothing behind it, so the catalogue can run exactly the
 * same check as the buyer types and the server can run it again before an order is created. **The server's answer
 * is the only one that counts** — the browser's is never read, so a basket edited in the console cannot get under
 * a minimum.
 */
class RulesService
{
    use RequiresPermission;

    public function __construct(private AuditService $audit, private PricingService $pricing, private Inventory $inventory) {}

    // ───────────────────────── the rules themselves ─────────────────────────

    /** @return \Illuminate\Database\Eloquent\Collection<int, CatalogueOrderRule> */
    public function rules(User $actor)
    {
        $this->need($actor, 'catalogue.view');

        return CatalogueOrderRule::orderBy('scope')->orderBy('scope_id')->get();
    }

    /**
     * @param  array{scope: string, scopeId?: string, minOrderCents?: int, minQty?: int, qtyIncrement?: int, enabled?: bool}  $in
     */
    public function saveRule(User $actor, array $in): CatalogueOrderRule
    {
        $this->need($actor, 'catalogue.rules');

        $scope = $in['scope'] ?? '';
        if (! in_array($scope, CatalogueOrderRule::SCOPES, true)) {
            throw new AppException('rule_scope_invalid');
        }
        $scopeId = $scope === 'global' ? '' : trim($in['scopeId'] ?? '');
        if ($scope === 'category' && $scopeId === '') {
            throw new AppException('rule_scope_required');
        }

        $step = max(0, (int) ($in['qtyIncrement'] ?? 0));
        $minQty = max(0, (int) ($in['minQty'] ?? 0));
        // "at least 6, in steps of 6" makes sense; "at least 7, in steps of 6" can never be satisfied at 7
        if ($step > 1 && $minQty > 0 && $minQty % $step !== 0) {
            throw new AppException('rule_min_not_a_step', ['qty' => $minQty, 'step' => $step]);
        }

        $rule = CatalogueOrderRule::updateOrCreate(['scope' => $scope, 'scope_id' => $scopeId], [
            // a country's own smallest order wins; this one only fills in where a country has not set one
            'min_order_cents' => $scope === 'global' ? max(0, (int) ($in['minOrderCents'] ?? 0)) : 0,
            'min_qty' => $minQty,
            'qty_increment' => $step,
            'enabled' => (bool) ($in['enabled'] ?? true),
        ]);

        $this->audit->log($actor, 'catalogue.rule_saved', 'catalogue_rule', $rule->id, [
            'scope' => $scope, 'for' => $scopeId, 'minOrder' => $rule->min_order_cents, 'minQty' => $rule->min_qty,
            'step' => $rule->qty_increment, 'enabled' => $rule->enabled,
        ]);

        return $rule;
    }

    public function deleteRule(User $actor, string $id): void
    {
        $this->need($actor, 'catalogue.rules');
        $rule = CatalogueOrderRule::findOrFail($id);
        $rule->delete();

        $this->audit->log($actor, 'catalogue.rule_deleted', 'catalogue_rule', $rule->id, ['scope' => $rule->scope, 'for' => $rule->scope_id]);
    }

    /** @return string[] the rules this business is let off */
    public function exemptions(User $actor, string $customerId): array
    {
        $this->need($actor, 'catalogue.customers');

        return CatalogueRuleExemption::where('customer_id', $customerId)->pluck('kind')->all();
    }

    /** @param string[] $kinds */
    public function setExemptions(User $actor, string $customerId, array $kinds): array
    {
        $this->need($actor, 'catalogue.rules');
        $customer = WholesaleCustomer::findOrFail($customerId);

        $wanted = array_values(array_intersect(CatalogueRules::KINDS, $kinds));
        $before = CatalogueRuleExemption::where('customer_id', $customer->id)->pluck('kind')->all();

        if (array_diff($wanted, $before) || array_diff($before, $wanted)) {
            DB::transaction(function () use ($customer, $wanted) {
                CatalogueRuleExemption::where('customer_id', $customer->id)->delete();
                foreach ($wanted as $kind) {
                    CatalogueRuleExemption::create(['customer_id' => $customer->id, 'kind' => $kind]);
                }
            });
            $this->audit->log($actor, 'catalogue.exemption_set', 'wholesale_customer', $customer->id, [
                'business' => $customer->business_name, 'letOff' => $wanted ?: ['—'],
            ]);
        }

        return $wanted;
    }

    // ───────────────────────── what one buyer is shown ─────────────────────────

    /**
     * The price list for one unlocked buyer: their own price for every size that has one, and the rules each line
     * is held to. A size with no price is left out of the list entirely rather than shown at zero.
     *
     * Availability is a yes or no — never a quantity. The shop's shelf is not a competitor's business.
     *
     * @return array{minOrderCents: int, lines: array<int, array<string, mixed>>}
     */
    public function priceList(?WholesaleCustomer $customer, ?CatalogueCountry $country): array
    {
        $prices = $this->pricing->forCustomer($customer, $country);
        $stock = $this->inventory->availableMap();
        $exempt = $customer ? CatalogueRuleExemption::where('customer_id', $customer->id)->pluck('kind')->all() : [];

        [$global, $byCategory] = $this->ruleShapes();
        $letOff = fn (string $kind) => in_array($kind, $exempt, true);
        $globalOn = ($global['enabled'] ?? false) === true;

        $lines = Variant::with('product')->whereIn('id', array_keys($prices))->get()
            ->map(function (Variant $v) use ($prices, $stock, $byCategory, $global, $globalOn, $letOff) {
                $price = $prices[$v->id];
                if ($price['cents'] === null) {
                    return null;    // no price agreed anywhere: not orderable, so not listed
                }
                $category = $v->product?->category ?? '';
                $rule = $byCategory[$category] ?? null;
                $useCategory = $rule !== null && ($rule['enabled'] ?? true) === true;

                return [
                    'variantId' => $v->id,
                    'productId' => $v->product_id,
                    'sku' => $v->sku,
                    'label' => $v->label,
                    'ml' => $v->ml,
                    'category' => $category,
                    'priceCents' => $price['cents'],
                    'source' => $price['source'],
                    'inStock' => ($stock[$v->id] ?? 0) > 0,
                    'minQty' => $letOff('min_qty') ? 0 : (int) ($useCategory ? ($rule['minQty'] ?? 0) : ($globalOn ? ($global['minQty'] ?? 0) : 0)),
                    'step' => $letOff('qty_increment') ? 0 : (int) ($useCategory ? ($rule['qtyIncrement'] ?? 0) : ($globalOn ? ($global['qtyIncrement'] ?? 0) : 0)),
                ];
            })
            ->filter()->sortBy('sku')->values()->all();

        $minOrder = $letOff('min_order') ? 0 : (($country?->min_order_cents ?? 0) > 0 ? $country->min_order_cents : ($globalOn ? (int) ($global['minOrderCents'] ?? 0) : 0));

        return ['minOrderCents' => $minOrder, 'lines' => $lines];
    }

    /** @return array{0: array<string, mixed>|null, 1: array<string, array<string, mixed>>} */
    private function ruleShapes(): array
    {
        $byCategory = [];
        $global = null;
        foreach (CatalogueOrderRule::all() as $rule) {
            $shape = ['minOrderCents' => $rule->min_order_cents, 'minQty' => $rule->min_qty, 'qtyIncrement' => $rule->qty_increment, 'enabled' => $rule->enabled];
            if ($rule->scope === 'global') {
                $global = $shape;
            } else {
                $byCategory[$rule->scope_id] = $shape;
            }
        }

        return [$global, $byCategory];
    }

    // ───────────────────────── checking a basket ─────────────────────────

    /**
     * Prices a basket and checks it against every rule that applies — the same answer the catalogue shows the
     * buyer, worked out again where it cannot be argued with.
     *
     * Phase 5 calls this inside the transaction that creates an order, so what the buyer was shown and what the
     * shop records can never drift apart.
     *
     * @param  array<int, array{variantId: string, qty: int}>  $lines
     * @return array<string, mixed>
     */
    public function check(?WholesaleCustomer $customer, ?CatalogueCountry $country, array $lines): array
    {
        $wanted = [];
        foreach ($lines as $line) {
            $id = (string) ($line['variantId'] ?? '');
            if ($id === '') {
                continue;
            }
            // the same size twice in one basket is one line of the two quantities added up
            $wanted[$id] = ($wanted[$id] ?? 0) + max(0, (int) ($line['qty'] ?? 0));
        }

        $variants = Variant::with('product')->whereIn('id', array_keys($wanted))
            ->where('active', true)->where('is_tester', false)->get()->keyBy('id');
        $prices = $this->pricing->forCustomer($customer, $country, array_keys($wanted));
        $stock = $this->inventory->availableMap();

        [$global, $byCategory] = $this->ruleShapes();

        $checkLines = [];
        foreach ($wanted as $variantId => $qty) {
            $variant = $variants->get($variantId);
            if (! $variant) {
                throw new AppException('product_unavailable');
            }
            $checkLines[] = [
                'variantId' => $variantId,
                'sku' => $variant->sku,
                'category' => $variant->product?->category ?? '',
                'qty' => $qty,
                'unitCents' => $prices[$variantId]['cents'] ?? null,
                'available' => $stock[$variantId] ?? 0,
            ];
        }

        $result = CatalogueRules::check(
            $checkLines,
            $global,
            $byCategory,
            $country?->min_order_cents ?? 0,
            $customer ? CatalogueRuleExemption::where('customer_id', $customer->id)->pluck('kind')->all() : [],
        );

        // the buyer sees their own prices and what is wrong, never a quantity on the shelf
        foreach ($result['lines'] as $i => $line) {
            $result['lines'][$i]['source'] = $prices[$line['variantId']]['source'] ?? null;
            $result['lines'][$i]['label'] = $variants->get($line['variantId'])?->label ?? '';
        }

        return $result;
    }
}
