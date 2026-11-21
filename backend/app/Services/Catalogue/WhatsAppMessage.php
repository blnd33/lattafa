<?php

namespace App\Services\Catalogue;

use App\Models\WholesaleOrder;
use App\Support\CataloguePricing;

/**
 * The message a buyer sends the shop on WhatsApp about an order.
 *
 * Written on the server, from the order as it was actually recorded — not from the basket in the browser — so
 * what the shop reads and what the shop has on file are the same thing.
 *
 * The catalogue then opens `wa.me` with it. **That is not the message being sent**, and nothing here pretends
 * otherwise: the order already exists and its stock is already held, so whether the buyer presses send in
 * WhatsApp changes nothing about what the shop has. Opening it is recorded separately, and a buyer who opens it
 * five times still has one order.
 *
 * There is no WhatsApp Business API here. This is a link a person taps.
 */
final class WhatsAppMessage
{
    /**
     * @param  array<string, string>  $words  the catalogue's dictionary, so the buyer writes in their own language
     */
    public static function for(WholesaleOrder $order, array $words = []): string
    {
        $t = fn (string $key, string $fallback) => $words[$key] ?? $fallback;

        $lines = [
            $t('cat.wa_title', 'LATTAFA WHOLESALE ORDER'),
            '',
            $t('cat.wa_order', 'Order').': '.$order->reading(),
            $t('cat.wa_business', 'Business').': '.$order->business_name,
        ];

        if ($order->country) {
            $lines[] = $t('cat.wa_country', 'Country').': '.$order->country->nameIn('en');
        }
        if ($order->contact_person !== '') {
            $lines[] = $t('cat.wa_contact', 'Contact').': '.$order->contact_person;
        }

        $lines[] = '';
        $lines[] = $t('cat.wa_items', 'Products').':';
        foreach ($order->items as $item) {
            $lines[] = sprintf(
                '%s %s — %d × %s = %s',
                $item->name,
                $item->label,
                $item->qty,
                CataloguePricing::dollars($item->unit_cents),
                CataloguePricing::dollars($item->line_cents),
            );
        }

        $lines[] = '';
        $lines[] = $t('cat.wa_total', 'Total').': '.CataloguePricing::dollars($order->subtotal_cents);
        $lines[] = $t('cat.wa_status', 'Order status').': '.$t('cat.status_pending_approval', 'Pending approval');

        if ($order->note !== '') {
            $lines[] = '';
            $lines[] = $t('cat.wa_note', 'Note').': '.$order->note;
        }

        return implode("\n", $lines);
    }
}
