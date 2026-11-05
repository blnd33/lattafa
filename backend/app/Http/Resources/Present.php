<?php

namespace App\Http\Resources;

use App\Models\AuditLog;
use App\Models\Collection;
use App\Models\Customer;
use App\Models\Device;
use App\Models\Order;
use App\Models\Product;
use App\Models\Role;
use App\Models\Sale;
use App\Models\SaleReturn;
use App\Models\Shift;
use App\Models\StockMovement;
use App\Models\User;
use App\Models\Variant;
use App\Support\Money;
use Illuminate\Support\Facades\Storage;

/**
 * JSON shapes of the API. Keys are camelCase and match `pos/src/data/types.ts` exactly, so a till can store
 * whatever the server sends without a mapping layer (and push its own records back the same way).
 */
final class Present
{
    private static function ms(mixed $carbon): int
    {
        return $carbon ? (int) $carbon->getTimestampMs() : 0;
    }

    /** What the signed-in client needs to know about itself (mirrors the POS `Actor`). */
    public static function actor(User $u): array
    {
        $u->loadMissing('role');

        return [
            'id' => $u->id, 'name' => $u->name, 'username' => $u->username, 'roleId' => $u->role_id, 'roleKey' => $u->role->key, 'roleName' => $u->role->name,
            'color' => $u->color, 'permissions' => $u->permissions(), 'limits' => ['maxDiscountPct' => $u->max_discount_pct, 'maxRefundIQD' => $u->max_refund_iqd],
            'isSuperAdmin' => $u->isSuperAdmin(),
        ];
    }

    /** An account as listed to admins / mirrored to tills. Never includes credentials. */
    public static function user(User $u): array
    {
        $u->loadMissing('role');

        return [
            'id' => $u->id, 'name' => $u->name, 'username' => $u->username, 'roleId' => $u->role_id, 'roleKey' => $u->role->key, 'active' => $u->active, 'color' => $u->color,
            'hasPassword' => $u->password !== null, 'grants' => $u->grants ?? [], 'denies' => $u->denies ?? [],
            'limits' => ['maxDiscountPct' => $u->max_discount_pct, 'maxRefundIQD' => $u->max_refund_iqd],
            'failedAttempts' => $u->failed_attempts, 'lockedUntil' => $u->locked_until, 'lastLoginAt' => $u->last_login_at,
            'createdAt' => self::ms($u->created_at), 'updatedAt' => self::ms($u->updated_at), 'createdBy' => $u->created_by,
        ];
    }

    public static function role(Role $r): array
    {
        return [
            'id' => $r->id, 'key' => $r->key, 'name' => $r->name, 'description' => $r->description, 'permissions' => $r->permissions, 'apps' => $r->apps,
            'isSystem' => $r->is_system, 'createdAt' => self::ms($r->created_at), 'updatedAt' => self::ms($r->updated_at),
        ] + (isset($r->users_count) ? ['userCount' => (int) $r->users_count] : []);
    }

    public static function device(Device $d): array
    {
        return ['id' => $d->id, 'name' => $d->name, 'code' => $d->code, 'registeredAt' => self::ms($d->created_at), 'revoked' => $d->revoked, 'lastSeenAt' => $d->last_seen_at];
    }

    /** A shop's order from the menu, as the delegate app and the admin panel show it. */
    public static function order(Order $o, string $handledByName = ''): array
    {
        return [
            'id' => $o->id, 'number' => $o->number, 'shopName' => $o->shop_name, 'phone' => $o->phone, 'note' => $o->note,
            'customerId' => $o->customer_id, 'items' => $o->items, 'units' => $o->units, 'status' => $o->status,
            'handledBy' => $o->handled_by, 'handledByName' => $handledByName, 'handledAt' => $o->handled_at,
            'refuseReason' => $o->refuse_reason, 'saleId' => $o->sale_id, 'placedAt' => $o->placed_at,
        ];
    }

    public static function variant(Variant $v, bool $showCost = true): array
    {
        return [
            'id' => $v->id, 'productId' => $v->product_id, 'label' => $v->label, 'size' => (float) $v->size, 'unit' => $v->unit, 'ml' => $v->ml, 'sku' => $v->sku, 'barcode' => $v->barcode,
            'costIQD' => $showCost ? $v->cost_iqd : 0, 'retailIQD' => $v->retail_iqd, 'wholesaleIQD' => $v->wholesale_iqd, 'wholesaleUSDCents' => $v->wholesale_usd_cents, 'costUSDCents' => $showCost ? $v->cost_usd_cents : 0, 'minStock' => $v->min_stock,
            'isTester' => $v->is_tester, 'active' => $v->active, 'stock' => (int) ($v->getAttribute('stock_qty') ?? 0),
        ];
    }

    /** @param Product $p with `variants` loaded (each optionally carrying `stock_qty`) */
    public static function product(Product $p, bool $showCost = true): array
    {
        return [
            'id' => $p->id, 'name' => $p->name, 'description' => $p->description, 'brand' => $p->brand, 'category' => $p->category, 'gender' => $p->gender,
            'concentration' => $p->concentration, 'scentFamilies' => $p->scent_families, 'notes' => $p->notes, 'season' => $p->season, 'longevity' => $p->longevity,
            'sillage' => $p->sillage, 'image' => $p->image_path ? Storage::disk('public')->url($p->image_path) : null, 'art' => $p->art,
            'showOnMenu' => $p->show_on_menu, 'featured' => $p->featured, 'isNew' => $p->is_new, 'active' => $p->active,
            'createdAt' => self::ms($p->created_at), 'updatedAt' => self::ms($p->updated_at),
            'variants' => $p->relationLoaded('variants') ? $p->variants->map(fn (Variant $v) => self::variant($v, $showCost))->values()->all() : [],
        ];
    }

    public static function customer(Customer $c): array
    {
        return [
            'id' => $c->id, 'name' => $c->name, 'phone' => $c->phone, 'type' => $c->type, 'city' => $c->city, 'notes' => $c->notes, 'balanceIQD' => $c->balance_iqd, 'lat' => $c->lat === null ? null : (float) $c->lat, 'lng' => $c->lng === null ? null : (float) $c->lng,
            'creditLimitIQD' => $c->credit_limit_iqd, 'points' => $c->points, 'active' => $c->active, 'createdAt' => self::ms($c->created_at), 'updatedAt' => self::ms($c->updated_at),
        ];
    }

    public static function collection(Collection $c): array
    {
        return [
            'id' => $c->id, 'customerId' => $c->customer_id, 'amountIQD' => $c->amount_iqd, 'method' => $c->method, 'shiftId' => $c->shift_id, 'userId' => $c->user_id, 'note' => $c->note,
            'tendered' => $c->tendered ?? $c->amount_iqd, 'currency' => $c->currency ?? 'IQD', 'rate' => $c->rate, 'createdAt' => $c->occurred_at,
        ];
    }

    public static function movement(StockMovement $m): array
    {
        return [
            'id' => $m->id, 'variantId' => $m->variant_id, 'locationId' => $m->location_id, 'type' => $m->type, 'qty' => $m->qty, 'balanceAfter' => $m->balance_after,
            'refType' => $m->ref_type, 'refId' => $m->ref_id, 'note' => $m->note, 'userId' => $m->user_id, 'createdAt' => $m->occurred_at,
        ];
    }

    public static function sale(Sale $s, bool $showCost = true): array
    {
        $s->loadMissing(['items', 'payments']);

        return [
            'id' => $s->id, 'number' => $s->number, 'shiftId' => $s->shift_id, 'userId' => $s->user_id, 'userName' => $s->user_name, 'customerId' => $s->customer_id,
            'customerName' => $s->customer_name, 'channel' => $s->channel, 'locationId' => $s->location_id, 'status' => $s->status,
            'items' => $s->items->map(fn ($i) => [
                'variantId' => $i->variant_id, 'productId' => $i->product_id, 'name' => $i->name, 'brand' => $i->brand, 'label' => $i->label, 'sku' => $i->sku,
                'barcode' => $i->barcode, 'qty' => $i->qty, 'unitPriceIQD' => $i->unit_price_iqd, 'unitCostIQD' => $showCost ? $i->unit_cost_iqd : 0,
                'discountPct' => $i->discount_pct, 'discountIQD' => $i->discount_iqd, 'lineTotalIQD' => $i->line_total_iqd, 'returnedQty' => $i->returned_qty,
            ])->values()->all(),
            'subtotalIQD' => $s->subtotal_iqd, 'itemDiscountIQD' => $s->item_discount_iqd, 'orderDiscountIQD' => $s->order_discount_iqd, 'orderDiscount' => $s->order_discount,
            'giftWrapIQD' => $s->gift_wrap_iqd, 'taxIQD' => $s->tax_iqd, 'roundingIQD' => $s->rounding_iqd, 'pointsRedeemedIQD' => $s->points_redeemed_iqd, 'totalIQD' => $s->total_iqd,
            'payments' => $s->payments->map(fn ($p) => ['method' => $p->method, 'amountIQD' => $p->amount_iqd, 'tendered' => $p->tendered, 'currency' => $p->currency, 'rate' => $p->rate, 'reference' => $p->reference])->values()->all(),
            'paidIQD' => $s->paid_iqd, 'changeIQD' => $s->change_iqd, 'dueIQD' => $s->due_iqd, 'pointsEarned' => $s->points_earned, 'pointsRedeemed' => $s->points_redeemed,
            'exchangeRate' => $s->exchange_rate, 'note' => $s->note, 'approvedBy' => $s->approved_by, 'deviceId' => $s->device_id, 'createdAt' => $s->sold_at,
            'voidedAt' => $s->voided_at, 'voidReason' => $s->void_reason, 'flags' => $s->flags ?? [], 'needsReview' => $s->needs_review,
            'reviewedAt' => $s->reviewed_at, 'reviewedBy' => $s->reviewed_by, 'reviewNote' => $s->review_note ?? '',
            'correctsSaleId' => $s->corrects_sale_id, 'correctedBySaleId' => $s->corrected_by_sale_id, 'currency' => $s->currency ?? 'IQD', 'lat' => $s->lat !== null ? (float) $s->lat : null, 'lng' => $s->lng !== null ? (float) $s->lng : null,
            'accuracyM' => $s->accuracy_m !== null ? (int) $s->accuracy_m : null,
        ];
    }

    public static function saleReturn(SaleReturn $r): array
    {
        $r->loadMissing('items');

        return [
            'id' => $r->id, 'number' => $r->number, 'saleId' => $r->sale_id, 'saleNumber' => $r->sale_number, 'shiftId' => $r->shift_id, 'userId' => $r->user_id, 'userName' => $r->user_name,
            'items' => $r->items->map(fn ($i) => [
                'saleItemIndex' => $i->sale_item_index, 'variantId' => $i->variant_id, 'productId' => $i->product_id, 'name' => $i->name, 'label' => $i->label,
                'qty' => $i->qty, 'unitNetIQD' => $i->unit_net_iqd, 'restock' => $i->restock, 'reason' => $i->reason,
            ])->values()->all(),
            'refundIQD' => $r->refund_iqd, 'refundMethod' => $r->refund_method, 'note' => $r->note, 'approvedBy' => $r->approved_by, 'createdAt' => $r->occurred_at,
        ];
    }

    public static function shift(Shift $s): array
    {
        $s->loadMissing('movements');

        return [
            'id' => $s->id, 'userId' => $s->user_id, 'userName' => $s->user_name, 'deviceId' => $s->device_id, 'status' => $s->status, 'openedAt' => $s->opened_at,
            'closedAt' => $s->closed_at, 'openingIQD' => $s->opening_iqd, 'openingUSD' => $s->opening_usd,
            'movements' => $s->movements->map(fn ($m) => ['id' => $m->id, 'type' => $m->type, 'amountIQD' => $m->amount_iqd, 'reason' => $m->reason, 'userId' => $m->user_id, 'createdAt' => $m->occurred_at])->values()->all(),
            'countedIQD' => $s->counted_iqd, 'countedUSD' => $s->counted_usd, 'varianceIQD' => $s->variance_iqd, 'totals' => $s->totals, 'note' => $s->note,
        ];
    }

    public static function visit(\App\Models\Visit $v): array
    {
        return [
            'id' => $v->id, 'userId' => $v->user_id, 'userName' => $v->user_name, 'customerId' => $v->customer_id, 'customerName' => $v->customer_name,
            'lat' => $v->lat, 'lng' => $v->lng, 'accuracyM' => $v->accuracy_m, 'outcome' => $v->outcome, 'note' => $v->note, 'createdAt' => $v->occurred_at,
        ];
    }

    public static function stockRequest(\App\Models\StockRequest $r): array
    {
        return [
            'id' => $r->id, 'userId' => $r->user_id, 'userName' => $r->user_name, 'items' => $r->items, 'note' => $r->note, 'status' => $r->status,
            'handledBy' => $r->handled_by, 'handledAt' => $r->handled_at, 'createdAt' => $r->occurred_at,
        ];
    }

    public static function closing(\App\Models\DelegateClosing $c): array
    {
        return [
            'id' => $c->id, 'userId' => $c->user_id, 'userName' => $c->user_name, 'day' => $c->day, 'salesCount' => $c->sales_count, 'salesIQD' => $c->sales_iqd,
            'cashSalesIQD' => $c->cash_sales_iqd, 'creditSalesIQD' => $c->credit_sales_iqd, 'collectionsIQD' => $c->collections_iqd, 'expensesIQD' => $c->expenses_iqd,
            'expectedCashIQD' => $c->expected_cash_iqd, 'countedCashIQD' => $c->counted_cash_iqd, 'varianceIQD' => $c->variance_iqd, 'vanUnits' => $c->van_units,
            'cashSalesUSD' => $c->cash_sales_usd, 'collectionsUSD' => $c->collections_usd, 'expectedCashUSD' => $c->expected_cash_usd, 'countedCashUSD' => $c->counted_cash_usd, 'varianceUSD' => $c->variance_usd,
            'visits' => $c->visits, 'note' => $c->note, 'status' => $c->status, 'reviewedBy' => $c->reviewed_by, 'reviewedAt' => $c->reviewed_at,
            'reviewNote' => $c->review_note, 'createdAt' => $c->occurred_at,
        ];
    }

    public static function audit(AuditLog $a): array
    {
        return ['id' => $a->id, 'userId' => $a->user_id, 'userName' => $a->user_name, 'action' => $a->action, 'entity' => $a->entity, 'entityId' => $a->entity_id, 'meta' => $a->meta, 'createdAt' => $a->occurred_at];
    }

    /* ───────── buying and spending: amounts are numbers in their own currency (`currency`), 2 decimals ───────── */

    /** @param int $balanceCents what the shop owes them, in cents of their currency */
    public static function supplier(\App\Models\Supplier $s, int $balanceCents = 0, int $openOrders = 0): array
    {
        return [
            'id' => $s->id, 'name' => $s->name, 'phone' => $s->phone, 'contact' => $s->contact, 'city' => $s->city, 'currency' => $s->currency,
            'notes' => $s->notes, 'active' => $s->active, 'balance' => round($balanceCents / 100, 2), 'openOrders' => $openOrders,
            'createdAt' => self::ms($s->created_at),
        ];
    }

    public static function purchaseOrder(\App\Models\PurchaseOrder $o, bool $detail = false): array
    {
        $items = $o->items->map(fn ($it) => [
            'id' => $it->id, 'variantId' => $it->variant_id, 'productId' => $it->product_id, 'name' => $it->name, 'label' => $it->label, 'sku' => $it->sku,
            'qty' => $it->qty, 'receivedQty' => $it->received_qty, 'unitCost' => Money::out($it->unit_cost), 'lineTotal' => round($it->qty * (float) $it->unit_cost, 2),
        ])->values()->all();
        $out = [
            'id' => $o->id, 'number' => $o->number, 'status' => $o->status, 'currency' => $o->currency, 'rate' => $o->rate,
            'supplier' => $o->supplier ? ['id' => $o->supplier->id, 'name' => $o->supplier->name, 'currency' => $o->supplier->currency] : null,
            'total' => Money::out($o->total), 'receivedTotal' => Money::out($o->received_total), 'note' => $o->note,
            'orderedAt' => $o->ordered_at, 'expectedAt' => $o->expected_at, 'closedAt' => $o->closed_at, 'createdByName' => $o->created_by_name,
            'units' => array_sum(array_column($items, 'qty')), 'receivedUnits' => array_sum(array_column($items, 'receivedQty')),
            'items' => $items,
        ];
        if ($detail) {
            $out['receipts'] = $o->receipts->map(fn ($r) => [
                'id' => $r->id, 'receivedAt' => $r->received_at, 'userName' => $r->user_name, 'rate' => $r->rate, 'total' => Money::out($r->total),
                'totalIQD' => $r->total_iqd, 'note' => $r->note, 'units' => (int) $r->items->sum('qty'),
            ])->values()->all();
        }

        return $out;
    }

    public static function supplierPayment(\App\Models\SupplierPayment $p): array
    {
        return [
            'id' => $p->id, 'supplierId' => $p->supplier_id, 'purchaseOrderId' => $p->purchase_order_id, 'amount' => Money::out($p->amount), 'currency' => $p->currency,
            'rate' => $p->rate, 'amountIQD' => $p->amount_iqd, 'method' => $p->method, 'note' => $p->note, 'paidAt' => $p->paid_at, 'userName' => $p->user_name,
        ];
    }

    public static function expense(\App\Models\Expense $e): array
    {
        return [
            'id' => $e->id, 'category' => $e->category, 'amount' => Money::out($e->amount), 'currency' => $e->currency, 'rate' => $e->rate,
            'amountIQD' => $e->amount_iqd, 'method' => $e->method, 'note' => $e->note, 'spentAt' => $e->spent_at, 'userId' => $e->user_id, 'userName' => $e->user_name,
        ];
    }
}
