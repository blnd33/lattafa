<?php

namespace App\Support;

/**
 * How little the shop is willing to sell, worked out for one basket.
 *
 * Pure arithmetic, like `CataloguePricing` beside it — the catalogue runs this as the buyer types, for instant
 * feedback, and the server runs the very same code again before an order is ever created. The server's answer is
 * the one that counts: a basket edited in the browser cannot slip under a minimum, because the browser's answer is
 * never trusted or even read.
 *
 * Rules narrow rather than add up: a rule set for one kind of perfume replaces the general one for those lines, it
 * does not stack on top of it. A business the shop has agreed to let off a rule is simply not held to it.
 *
 * Every problem comes back as a code and its figures, never as a sentence — the catalogue says it in the buyer's
 * own language (`cat.min_order`, `cat.min_qty`, `cat.qty_step`).
 */
final class CatalogueRules
{
    public const KINDS = ['min_order', 'min_qty', 'qty_increment'];

    /**
     * Checks a basket and says what, if anything, is wrong with it.
     *
     * @param  array<int, array{variantId: string, sku: string, category: string, qty: int, unitCents: int|null}>  $lines
     * @param  array{minOrderCents?: int, minQty?: int, qtyIncrement?: int, enabled?: bool}|null  $global
     * @param  array<string, array{minQty?: int, qtyIncrement?: int, enabled?: bool}>  $byCategory
     * @param  string[]  $exempt  which of KINDS this business is let off
     * @return array{ok: bool, lines: array<int, array<string, mixed>>, subtotalCents: int, units: int, minOrderCents: int, shortfallCents: int, problems: array<int, array{code: string, params: array<string, mixed>}>}
     */
    public static function check(
        array $lines,
        ?array $global = null,
        array $byCategory = [],
        int $countryMinOrderCents = 0,
        array $exempt = [],
    ): array {
        $globalOn = ($global['enabled'] ?? false) === true;
        $letOff = fn (string $kind) => in_array($kind, $exempt, true);

        $checked = [];
        $problems = [];
        $subtotal = 0;
        $units = 0;

        foreach ($lines as $line) {
            $qty = max(0, (int) $line['qty']);
            $category = (string) ($line['category'] ?? '');
            $rule = $byCategory[$category] ?? null;
            $useCategory = $rule !== null && ($rule['enabled'] ?? true) === true;

            // the narrower rule replaces the general one for this line; it is not added to it
            $minQty = $letOff('min_qty') ? 0 : (int) ($useCategory ? ($rule['minQty'] ?? 0) : ($globalOn ? ($global['minQty'] ?? 0) : 0));
            $step = $letOff('qty_increment') ? 0 : (int) ($useCategory ? ($rule['qtyIncrement'] ?? 0) : ($globalOn ? ($global['qtyIncrement'] ?? 0) : 0));

            $lineProblems = [];
            $unit = $line['unitCents'];

            if ($unit === null) {
                $lineProblems[] = ['code' => 'unpriced', 'params' => ['sku' => $line['sku']]];
            }
            if ($qty < 1) {
                $lineProblems[] = ['code' => 'invalid_quantity', 'params' => ['sku' => $line['sku']]];
            }
            if ($minQty > 0 && $qty > 0 && $qty < $minQty) {
                $lineProblems[] = ['code' => 'min_qty', 'params' => ['sku' => $line['sku'], 'qty' => $minQty]];
            }
            if ($step > 1 && $qty > 0 && $qty % $step !== 0) {
                $lineProblems[] = ['code' => 'qty_step', 'params' => ['sku' => $line['sku'], 'step' => $step]];
            }
            // Nothing here refuses an order for want of stock. The catalogue sells with no limit: a shop abroad
            // orders what it wants and the shop here decides when the order arrives, so the shelf is not part of
            // the arithmetic and no quantity on it is ever implied by a refusal.

            $lineCents = $unit === null ? 0 : CataloguePricing::line($unit, $qty);
            $subtotal += $lineCents;
            $units += $qty;

            $checked[] = [
                'variantId' => $line['variantId'],
                'sku' => $line['sku'],
                'qty' => $qty,
                'unitCents' => $unit,
                'lineCents' => $lineCents,
                'minQty' => $minQty,
                'step' => $step,
                'problems' => $lineProblems,
            ];
            $problems = [...$problems, ...$lineProblems];
        }

        if (! $lines) {
            $problems[] = ['code' => 'cart_empty', 'params' => []];
        }

        // the country's own minimum is the one that counts; the general rule only fills in where a country has none
        $minOrder = $letOff('min_order') ? 0 : ($countryMinOrderCents > 0 ? $countryMinOrderCents : ($globalOn ? (int) ($global['minOrderCents'] ?? 0) : 0));
        $shortfall = max(0, $minOrder - $subtotal);
        if ($shortfall > 0) {
            $problems[] = ['code' => 'min_order', 'params' => ['minimum' => $minOrder, 'add' => $shortfall]];
        }

        return [
            'ok' => $problems === [],
            'lines' => $checked,
            'subtotalCents' => $subtotal,
            'units' => $units,
            'minOrderCents' => $minOrder,
            'shortfallCents' => $shortfall,
            'problems' => $problems,
        ];
    }
}
