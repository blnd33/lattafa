<?php

namespace App\Services\Catalogue;

use App\Models\WholesaleReservation;
use App\Services\StockService;
use Illuminate\Support\Facades\DB;

/**
 * The one door between the wholesale catalogue and the shop's stock.
 *
 * The catalogue is not a separate system: it runs on the same database as the tills and the delegates, so there is
 * nothing to synchronise and no second copy of a quantity anywhere. `StockService` stays the only thing that ever
 * writes stock, and every catalogue read goes through here rather than touching the `stock` table itself.
 *
 * ## Why "available" is not what is on the shelf
 *
 * An order waiting for approval has bottles held for it. They are still on the shelf — nothing has been deducted —
 * but they are promised, so a second buyer must not be able to order them. `available()` is therefore
 *
 *     what the shop has  −  what orders waiting for approval are holding
 *
 * and that subtraction happens **here and nowhere else**. That is what makes it impossible to hold the same bottle
 * twice or to forget to count a hold: there is exactly one answer to the question in the whole system.
 *
 * Approving an order deducts the stock through `StockService::applyMovement` and marks the reservation consumed in
 * the same transaction, so the figure never flickers: the shelf goes down by the same amount the hold goes away.
 *
 * To be plain about what this is: same-database access, not an integration with a remote POS.
 */
class Inventory
{
    public function __construct(private StockService $stock) {}

    /** Bottles on the shop's shelf, before anything a pending wholesale order is holding. */
    public function onHand(string $variantId): int
    {
        return $this->stock->quantity($variantId);
    }

    /** What orders waiting for approval are holding of one size. */
    public function held(string $variantId): int
    {
        return (int) DB::table('wholesale_reservation_items as i')
            ->join('wholesale_reservations as r', 'r.id', '=', 'i.reservation_id')
            ->where('r.status', WholesaleReservation::ACTIVE)
            ->where('i.variant_id', $variantId)
            ->sum('i.qty');
    }

    /**
     * What a wholesale buyer may actually order: the shelf, less what is already promised to someone else.
     *
     * Never below zero. A till selling the last bottle over the counter while an order holds it is possible — the
     * shop is one shop — and the answer to "how many may I order" is then simply none.
     */
    public function available(string $variantId): int
    {
        return max(0, $this->onHand($variantId) - $this->held($variantId));
    }

    /**
     * The same figure for every variant at once, as `[variantId => qty]`, for listing a whole catalogue page
     * without a query per perfume.
     *
     * @return array<string, int>
     */
    public function availableMap(): array
    {
        $onHand = $this->stock->map();
        foreach ($this->heldMap() as $variantId => $held) {
            $onHand[$variantId] = max(0, ($onHand[$variantId] ?? 0) - $held);
        }

        return $onHand;
    }

    /**
     * Everything orders waiting for approval are holding, as `[variantId => qty]`.
     *
     * @return array<string, int>
     */
    public function heldMap(): array
    {
        return DB::table('wholesale_reservation_items as i')
            ->join('wholesale_reservations as r', 'r.id', '=', 'i.reservation_id')
            ->where('r.status', WholesaleReservation::ACTIVE)
            ->groupBy('i.variant_id')
            ->selectRaw('i.variant_id, SUM(i.qty) as qty')
            ->pluck('qty', 'variant_id')
            ->map(fn ($q) => (int) $q)
            ->all();
    }

    /**
     * All a buyer is ever told: in stock, or not. Exact quantities stay inside the shop — the catalogue must not
     * let a competitor read the shelf.
     */
    public function inStock(string $variantId): bool
    {
        return $this->available($variantId) > 0;
    }
}
