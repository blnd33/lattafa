<?php

namespace App\Http\Resources;

use App\Models\CatalogueCollection;
use App\Models\CatalogueCountry;
use App\Models\CatalogueLanguage;
use App\Models\CatalogueOrderRule;
use App\Models\CataloguePriceHistory;
use App\Models\WholesaleAccessCode;
use App\Models\WholesaleCustomer;
use App\Models\WholesaleOrder;
use App\Models\WholesaleOrderItem;
use App\Models\WholesaleOrderStatus;
use App\Models\WholesalePayment;
use App\Models\WholesaleSession;
use App\Support\Time;
use Illuminate\Support\Facades\Storage;

/**
 * JSON shapes of the wholesale catalogue, camelCase like the rest of the API (`Present` holds the shop's own).
 *
 * The rule that matters here: a secret never appears. An access code's fingerprint and bcrypt hash are not in any
 * shape below, and neither is a session token — the only time a code leaves the server in full is the moment it is
 * generated, straight back to the person who pressed the button.
 */
final class PresentCatalogue
{
    public static function country(CatalogueCountry $c): array
    {
        return [
            'id' => $c->id,
            'iso2' => $c->iso2,
            'name' => $c->name,
            'language' => $c->language_code,
            'enabled' => $c->enabled,
            'isDefault' => $c->is_default,
            'sort' => $c->sort,
            'minOrderCents' => $c->min_order_cents,
            'customers' => $c->customers_count ?? null,
        ];
    }

    public static function language(CatalogueLanguage $l): array
    {
        return [
            'code' => $l->code,
            'name' => $l->name,
            'native' => $l->native,
            'rtl' => $l->rtl,
            'enabled' => $l->enabled,
            'sort' => $l->sort,
        ];
    }

    public static function customer(WholesaleCustomer $w): array
    {
        return [
            'id' => $w->id,
            'businessName' => $w->business_name,
            'contactPerson' => $w->contact_person,
            'email' => $w->email,
            'phone' => $w->phone,
            'whatsapp' => $w->whatsapp,
            'countryId' => $w->country_id,
            'country' => $w->relationLoaded('country') && $w->country ? self::country($w->country) : null,
            'address' => $w->address,
            'status' => $w->status,
            'notes' => $w->notes,
            'posCustomerId' => $w->pos_customer_id,
            'ordersCount' => $w->orders_count,
            'ordersValueCents' => $w->orders_value_cents,
            'liveCodes' => $w->live_codes_count ?? null,
            'codes' => $w->relationLoaded('codes') ? $w->codes->map(fn (WholesaleAccessCode $c) => self::code($c))->all() : null,
            'createdAt' => (int) ($w->created_at?->getTimestampMs() ?? 0),
        ];
    }

    /** Everything about a code except the code. */
    public static function code(WholesaleAccessCode $c): array
    {
        return [
            'id' => $c->id,
            'customerId' => $c->customer_id,
            'display' => $c->display,
            'countryId' => $c->country_id,
            'active' => $c->active,
            'revoked' => $c->revoked_at !== null,
            'expiresAt' => $c->expires_at,
            'revokedAt' => $c->revoked_at,
            'uses' => $c->uses,
            'lastUsedAt' => $c->last_used_at,
            'createdAt' => (int) ($c->created_at?->getTimestampMs() ?? 0),
        ];
    }

    public static function collection(CatalogueCollection $c): array
    {
        return [
            'id' => $c->id,
            'slug' => $c->slug,
            'name' => $c->name,
            'description' => $c->description,
            'image' => $c->image_path ? Storage::disk('public')->url($c->image_path) : null,
            'enabled' => $c->enabled,
            'featured' => $c->featured,
            'sort' => $c->sort,
            'perfumes' => $c->items_count ?? null,
            // the admin screen replaces the whole list when it saves, so it has to start from what is in there
            'productIds' => $c->relationLoaded('items')
                ? $c->items->sortBy('sort')->pluck('product_id')->values()->all()
                : null,
        ];
    }

    public static function rule(CatalogueOrderRule $r): array
    {
        return [
            'id' => $r->id,
            'scope' => $r->scope,
            'scopeId' => $r->scope_id,
            'minOrderCents' => $r->min_order_cents,
            'minQty' => $r->min_qty,
            'qtyIncrement' => $r->qty_increment,
            'enabled' => $r->enabled,
        ];
    }

    /** One line of the price trail: what changed, from what to what, and who did it. */
    public static function priceChange(CataloguePriceHistory $h): array
    {
        return [
            'id' => $h->id,
            'scope' => $h->scope,
            'scopeId' => $h->scope_id,
            'variantId' => $h->variant_id,
            'fromCents' => $h->from_cents,
            'toCents' => $h->to_cents,
            'fromPercentBp' => $h->from_percent_bp,
            'toPercentBp' => $h->to_percent_bp,
            'byName' => $h->user_name,
            'at' => $h->occurred_at,
        ];
    }

    /**
     * An order as the shop sees it. `forBuyer` leaves out everything that is the shop's own business — who
     * decided it, what they wrote in the margin, how long the stock has been held.
     */
    public static function order(WholesaleOrder $o, bool $forBuyer = false): array
    {
        $o->loadMissing(['items']);

        $base = [
            'id' => $o->id,
            'number' => $o->reading(),
            'reference' => $o->reference,
            'status' => $o->status,
            'method' => $o->method,
            'businessName' => $o->business_name,
            'contactPerson' => $o->contact_person,
            'phone' => $o->phone,
            'whatsapp' => $o->whatsapp,
            'email' => $o->email,
            'address' => $o->address,
            'note' => $o->note,
            'subtotalCents' => $o->subtotal_cents,
            'units' => $o->units,
            'minOrderCents' => $o->min_order_cents,
            'currency' => $o->currency,
            'paymentStatus' => $o->payment_status,
            'paidCents' => $o->paid_cents,
            'placedAt' => $o->placed_at,
            'decidedAt' => $o->decided_at,
            'whatsappOpenedAt' => $o->whatsapp_opened_at,
            'rejectReason' => $o->reject_reason,
            'items' => $o->items->map(fn (WholesaleOrderItem $i) => [
                'variantId' => $i->variant_id,
                'productId' => $i->product_id,
                'sku' => $i->sku,
                'name' => $i->name,
                'label' => $i->label,
                'qty' => $i->qty,
                'unitCents' => $i->unit_cents,
                'lineCents' => $i->line_cents,
            ])->all(),
        ];

        if ($forBuyer) {
            return $base;
        }

        return $base + [
            'customerId' => $o->customer_id,
            'countryId' => $o->country_id,
            'country' => $o->relationLoaded('country') && $o->country ? ['iso2' => $o->country->iso2, 'name' => $o->country->name] : null,
            'adminNote' => $o->admin_note,
            'integrationError' => $o->integration_error,
            'priceSources' => $o->items->pluck('price_source', 'variantId')->all(),
            'history' => $o->relationLoaded('history') ? $o->history->sortBy('occurred_at')->map(fn (WholesaleOrderStatus $h) => [
                'from' => $h->from_status, 'to' => $h->to_status, 'byName' => $h->by_name, 'reason' => $h->reason, 'at' => $h->occurred_at,
            ])->values()->all() : null,
            'payments' => $o->relationLoaded('payments') ? $o->payments->map(fn (WholesalePayment $p) => self::payment($p))->all() : null,
        ];
    }

    public static function payment(WholesalePayment $p): array
    {
        return [
            'id' => $p->id,
            'orderId' => $p->order_id,
            'method' => $p->method,
            'amountCents' => $p->amount_cents,
            'status' => $p->status,
            'reference' => $p->reference,
            'note' => $p->note,
            'byName' => $p->recorded_by_name,
            'at' => $p->occurred_at,
        ];
    }

    /** What an unlocked buyer is told about themselves. Their own business only — never another's. */
    public static function session(WholesaleSession $s): array
    {
        $s->loadMissing(['customer', 'country']);

        return [
            'business' => $s->customer?->business_name ?? '',
            'contactPerson' => $s->customer?->contact_person ?? '',
            'country' => $s->country ? [
                'id' => $s->country->id, 'iso2' => $s->country->iso2, 'name' => $s->country->name,
                'language' => $s->country->language_code, 'minOrderCents' => $s->country->min_order_cents,
            ] : null,
            'expiresAt' => $s->expires_at,
        ];
    }
}
