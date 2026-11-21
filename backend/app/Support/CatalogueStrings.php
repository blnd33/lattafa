<?php

namespace App\Support;

/**
 * The wholesale catalogue's own words, in English.
 *
 * This list is what "a complete translation" is measured against, and English is what any language falls back to, so
 * the catalogue always reads even when a translation is half done. Every other language lives in the database
 * (`catalogue_translations`) and is edited from the admin panel — including English itself, which can be overridden
 * row by row without touching this file.
 *
 * Keys added here as the catalogue grows simply show up as "missing" on the translations screen.
 */
final class CatalogueStrings
{
    /** @var array<string, string> */
    public const EN = [
        // welcome and country
        'cat.welcome_title' => 'The Wholesale Collection',
        'cat.welcome_lead' => 'For perfume shops, distributors and retailers.',
        'cat.explore' => 'Explore the collection',
        'cat.choose_country' => 'Where are you buying from?',
        'cat.country_search' => 'Search countries',
        'cat.change_country' => 'Change country',

        // unlocking wholesale prices
        'cat.locked_prices' => 'Unlock wholesale prices',
        'cat.unlock_title' => 'Your wholesale access code',
        'cat.unlock_lead' => 'Enter the code Lattafa gave your business to see your prices and order.',
        'cat.unlock_cta' => 'Unlock',
        'cat.code_label' => 'Access code',
        'cat.signed_in_as' => 'Signed in as {business}',
        'cat.lock' => 'Sign out',

        // what can go wrong
        'cat.err_code_invalid' => 'That code was not recognised. Please check it and try again.',
        'cat.err_code_expired' => 'That code has expired. Please ask Lattafa for a new one.',
        'cat.err_code_revoked' => 'That code is no longer in use. Please ask Lattafa for a new one.',
        'cat.err_customer_inactive' => 'This account is on hold. Please contact Lattafa.',
        'cat.err_code_country' => 'That code is for {country}. Switch country to use it.',
        'cat.err_too_many' => 'Too many attempts. Please wait a little and try again.',

        // the collection
        'cat.in_stock' => 'In stock',
        'cat.out_of_stock' => 'Out of stock',
        'cat.collections' => 'Collections',
        'cat.categories' => 'Categories',
        'cat.search' => 'Search perfumes',
        'cat.favourites' => 'Favourites',
        'cat.cart' => 'Your order',

        // wholesale rules
        'cat.min_order' => 'Minimum wholesale order: {amount}.',
        'cat.min_order_add' => 'Add {amount} more to continue.',
        'cat.min_qty' => 'Minimum {qty} bottles.',
        'cat.qty_step' => 'In steps of {step} bottles.',
        'cat.prices_usd' => 'All prices are in US dollars.',

        // what a basket can be told, from the codes `CatalogueRules` sends back
        'cat.err_min_order' => 'Minimum wholesale order: {minimum}. Add {add} more to continue.',
        'cat.err_min_qty' => '{sku}: at least {qty} bottles.',
        'cat.err_qty_step' => '{sku}: in steps of {step} bottles.',
        'cat.err_unpriced' => '{sku} has no price yet. Please ask us.',
        'cat.err_out_of_stock' => '{sku} is out of stock.',
        'cat.err_invalid_quantity' => '{sku}: choose how many.',
        'cat.err_cart_empty' => 'Your order is empty.',
        'cat.err_offline' => 'We could not reach Lattafa. Please try again.',
        'cat.err_unknown' => 'Something went wrong. Please try again.',
        'cat.err_not_unlocked' => 'Please enter your access code again.',

        // the bones of the page
        'cat.menu' => 'Menu',
        'cat.close' => 'Close',
        'cat.loading' => 'Loading…',
        'cat.retry' => 'Try again',
        'cat.new' => 'New',

        // the kinds of perfume the shop sells
        'cat.kind_perfume' => 'Perfume',
        'cat.kind_oud' => 'Oud',
        'cat.kind_mist' => 'Body mist',
        'cat.kind_oil' => 'Perfume oil',
        'cat.kind_set' => 'Gift sets',
        'cat.kind_home' => 'Home fragrance',
        'cat.men' => 'Men',
        'cat.women' => 'Women',
        'cat.unisex' => 'Unisex',

        // the homepage
        'cat.home' => 'Home',
        'cat.shop_by_kind' => 'Shop by kind',
        'cat.collections' => 'Collections',
        'cat.featured' => 'Featured',
        'cat.new_arrivals' => 'New arrivals',
        'cat.all_perfumes' => 'All perfumes',
        'cat.view_all' => 'View all',
        'cat.story_title' => 'Made in the Emirates, worn everywhere',
        'cat.story_body' => 'Lattafa blends oud, amber and florals in the Gulf tradition, bottled for a world that has come to know it.',
        'cat.how_title' => 'How wholesale works',
        'cat.how_1' => 'Browse the whole collection — no code needed.',
        'cat.how_2' => 'Enter the code we gave your business to see your own prices.',
        'cat.how_3' => 'Build your order and send it. We confirm it before anything ships.',
        // `_1` is the one-of-it wording; the catalogue picks it when n is 1 (the same shape the POS uses)
        'cat.perfumes_n' => '{n} perfumes',
        'cat.perfumes_n_1' => '{n} perfume',
        // what a buyer is told about a perfume the shop has not priced for them yet
        'cat.ask_us' => 'Price on request',
        // the colours and wordmark are this system's house theme until the real brand kit is loaded in, and the
        // footer says so rather than letting a placeholder pass for official branding
        'cat.look_provisional' => 'The colours and wordmark on this page are a working placeholder, not official Lattafa branding.',
        'cat.photograph_n' => 'Photograph {n}',
        'cat.notes' => 'Notes',
        'cat.families' => 'Family',

        // browsing
        'cat.filters' => 'Filters',
        'cat.clear' => 'Clear',
        'cat.kind' => 'Kind',
        'cat.brand' => 'Brand',
        'cat.gender' => 'For',
        'cat.availability' => 'Availability',
        'cat.in_stock_only' => 'In stock only',
        'cat.any' => 'Any',
        'cat.no_results' => 'No perfumes match that',
        'cat.no_results_hint' => 'Try a different word, or clear the filters.',
        'cat.showing_n' => '{n} of {total}',

        // a perfume
        'cat.concentration' => 'Concentration',
        'cat.sizes' => 'Sizes',
        'cat.notes_top' => 'Top notes',
        'cat.notes_heart' => 'Heart notes',
        'cat.notes_base' => 'Base notes',
        'cat.longevity' => 'Longevity',
        'cat.sillage' => 'Sillage',
        'cat.season' => 'Season',
        'cat.related' => 'You may also like',
        'cat.back' => 'Back',
        'cat.add_to_order' => 'Add to order',
        'cat.in_order' => 'In your order',
        'cat.favourite' => 'Save',
        'cat.favourited' => 'Saved',
        'cat.favourites_empty' => 'Nothing saved yet',
        'cat.favourites_empty_hint' => 'Tap Save on a perfume to keep it here.',

        // the order
        'cat.your_order' => 'Your order',
        'cat.order_empty' => 'Your order is empty',
        'cat.order_empty_hint' => 'Add bottles from the collection.',
        'cat.subtotal' => 'Subtotal',
        'cat.bottles_n' => '{n} bottles',
        'cat.bottles_n_1' => '{n} bottle',
        'cat.remove' => 'Remove',
        'cat.clear_order' => 'Empty the order',
        'cat.send_order' => 'Send this order',

        // sending it
        'cat.co_title' => 'Send your order',
        'cat.co_business' => 'Business name',
        'cat.co_contact' => 'Contact person',
        'cat.co_phone' => 'Phone',
        'cat.co_whatsapp' => 'WhatsApp',
        'cat.co_email' => 'Email',
        'cat.co_address' => 'Delivery address',
        'cat.co_note' => 'Anything we should know',
        'cat.co_via_whatsapp' => 'Order via WhatsApp',
        'cat.co_place' => 'Place the order',
        'cat.co_pending_hint' => 'Either way, your order reaches us the same. WhatsApp just opens the conversation too.',
        'cat.co_thanks' => 'Thank you — we have your order',
        'cat.co_reference' => 'Your reference',
        'cat.co_pending' => 'Waiting for Lattafa to confirm it. Nothing ships until we do, and we will be in touch.',
        'cat.co_keep_browsing' => 'Keep browsing',
        // what the WhatsApp message itself says — written on the server, from the order as recorded
        'cat.wa_title' => 'LATTAFA WHOLESALE ORDER',
        'cat.wa_order' => 'Order',
        'cat.wa_business' => 'Business',
        'cat.wa_country' => 'Country',
        'cat.wa_contact' => 'Contact',
        'cat.wa_items' => 'Products',
        'cat.wa_total' => 'Total',
        'cat.wa_status' => 'Order status',
        'cat.wa_note' => 'Note',
        // how an order reads wherever it is shown
        'cat.status_pending_approval' => 'Waiting for confirmation',
        'cat.status_approval_processing' => 'Being confirmed',
        'cat.status_approved' => 'Confirmed',
        'cat.status_rejected' => 'Not accepted',
        'cat.status_cancelled' => 'Cancelled',
        'cat.status_integration_error' => 'Needs a look',
        'cat.send_soon' => 'Sending an order opens shortly. Everything below is checked and ready.',
        'cat.ready_to_send' => 'Ready to send',
        'cat.unlock_to_order' => 'Enter your access code to see prices and order.',
    ];

    /** @return string[] */
    public static function keys(): array
    {
        return array_keys(self::EN);
    }
}
