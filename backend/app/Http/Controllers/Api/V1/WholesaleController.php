<?php

namespace App\Http\Controllers\Api\V1;

use App\Exceptions\AppException;
use App\Http\Controllers\Controller;
use App\Http\Middleware\ResolveWholesaleSession;
use App\Http\Resources\PresentCatalogue;
use App\Services\Catalogue\AccessCodeService;
use App\Services\Catalogue\AppearanceService;
use App\Services\Catalogue\CollectionService;
use App\Services\Catalogue\GeographyService;
use App\Services\Catalogue\OrderService;
use App\Services\Catalogue\RulesService;
use App\Services\Catalogue\TranslationService;
use App\Services\Catalogue\WhatsAppMessage;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;

/**
 * The wholesale catalogue as a buyer meets it: no staff account, no sign-in page — a code, or nothing.
 *
 * Nothing here ever returns a price. Prices arrive in Phase 2, and when they do they are left out of the JSON
 * entirely for anyone without a live session rather than hidden in the page.
 */
class WholesaleController extends Controller
{
    public function __construct(
        private GeographyService $geography,
        private TranslationService $translations,
        private AccessCodeService $codes,
        private RulesService $rules,
        private CollectionService $collection,
        private OrderService $orders,
        private \App\Services\SettingsService $settings,
        private AppearanceService $appearance,
    ) {}

    /**
     * What a visitor needs before anything else: the countries the catalogue is open in, the languages it reads
     * in, and the words themselves. Public, and safe to cache for a short while — there is nothing private in it.
     */
    public function open(Request $r): JsonResponse
    {
        $open = $this->geography->open();

        $language = (string) $r->query('language', '');
        $known = array_column($open['languages'], 'code');
        if (! in_array($language, $known, true)) {
            $default = collect($open['countries'])->firstWhere('id', $open['defaultCountryId']);
            $language = $default['language'] ?? ($known[0] ?? 'en');
        }

        // the number a WhatsApp order opens at — the shop's own, the same one the QR menu already uses
        $shop = $this->settings->get();
        $whatsapp = (string) ($shop['menu']['whatsapp'] ?? '') ?: (string) ($shop['store']['phone'] ?? '');

        return response()->json([
            'countries' => $open['countries'],
            'languages' => $open['languages'],
            'defaultCountryId' => $open['defaultCountryId'],
            'language' => $language,
            'words' => $this->translations->dictionary($language),
            'currency' => 'USD',
            'whatsapp' => preg_replace('/[^0-9+]/', '', $whatsapp) ?? '',
            // how the owner has arranged the catalogue: brand, headline, which sections and in what order
            'look' => $this->appearance->open(),
        ])->header('Cache-Control', 'public, max-age=60');
    }

    /**
     * The whole collection, in one language — the perfumes, their notes, and whether each size is in stock.
     *
     * Public, like the shop's own QR menu: anyone may look. **No price is built into this reply at all**, so
     * there is no filter here that could be forgotten — a buyer's prices come from `GET /wholesale/prices`,
     * behind the session middleware, and the catalogue puts the two together in the browser.
     */
    public function products(Request $r): JsonResponse
    {
        $open = $this->geography->open();
        $known = array_column($open['languages'], 'code');
        $language = (string) $r->query('language', '');
        if (! in_array($language, $known, true)) {
            $language = $known[0] ?? 'en';
        }

        return response()->json(['language' => $language] + $this->collection->all($language))
            ->header('Cache-Control', 'public, max-age=60');
    }

    /**
     * A buyer typing their access code.
     *
     * Guessing is slowed per address as well as per code: ten refusals from one address in an hour and that
     * address waits. People mistyping their own code now and then never come near it.
     */
    public function unlock(Request $r): JsonResponse
    {
        $data = $r->validate([
            'code' => ['required', 'string', 'max:64'],
            'country' => ['nullable', 'string', 'max:64'],
        ]);

        $key = 'wholesale-unlock:'.$r->ip();
        if (RateLimiter::tooManyAttempts($key, 10)) {
            throw new AppException('too_many_requests', ['seconds' => RateLimiter::availableIn($key)], 429);
        }

        try {
            $out = $this->codes->unlock($data['code'], $data['country'] ?? null, (string) $r->ip(), (string) $r->userAgent());
        } catch (AppException $e) {
            // a refusal because the shop restricted the code to another country is not a guess — it is a buyer
            // who picked the wrong country, and holding that against them would lock out a real customer
            if ($e->errorCode !== 'code_country') {
                RateLimiter::hit($key, 3600);
            }
            throw $e;
        }

        RateLimiter::clear($key);

        return response()->json([
            'token' => $out['token'],
            'session' => PresentCatalogue::session($out['session']),
        ]);
    }

    /** Who this buyer is, for a catalogue reopened with a token already in hand. */
    public function me(Request $r): JsonResponse
    {
        return response()->json(['session' => PresentCatalogue::session(ResolveWholesaleSession::of($r))]);
    }

    /**
     * This buyer's own price list, in US dollars.
     *
     * Behind the `wholesale` middleware, so there is no route by which a price reaches anyone who has not
     * unlocked the catalogue — the figures are not withheld from the JSON, the JSON is never built.
     * Availability is a yes or no; the shop's shelf is nobody else's business.
     */
    public function prices(Request $r): JsonResponse
    {
        $session = ResolveWholesaleSession::of($r);

        return response()->json($this->rules->priceList($session->customer, $session->country));
    }

    /**
     * Prices a basket and says what is wrong with it: below the smallest order, too few of a size, not a whole
     * number of steps, nothing left on the shelf.
     *
     * The catalogue runs the same check as the buyer types, for instant feedback. This is the one that counts,
     * and Phase 5 runs it again inside the transaction that creates the order.
     */
    public function quote(Request $r): JsonResponse
    {
        $data = $r->validate([
            'lines' => ['present', 'array', 'max:200'],
            'lines.*.variantId' => ['required', 'string', 'max:64'],
            'lines.*.qty' => ['required', 'integer', 'min:0', 'max:100000'],
        ]);
        $session = ResolveWholesaleSession::of($r);

        return response()->json($this->rules->check($session->customer, $session->country, $data['lines']));
    }

    /**
     * Sending an order.
     *
     * The basket is priced and checked again on the server, inside the transaction that writes the order and
     * takes the stock off the shelf for it — what the browser was shown is never trusted. Send the same
     * `Idempotency-Key` twice and the same order comes back, rather than a second one.
     *
     * For a WhatsApp order the reply also carries the message to open `wa.me` with. The order already exists by
     * then: opening WhatsApp is not what creates it, and not sending the message does not undo it.
     */
    public function placeOrder(Request $r): JsonResponse
    {
        $data = $r->validate([
            'lines' => ['required', 'array', 'min:1', 'max:200'],
            'lines.*.variantId' => ['required', 'string', 'max:64'],
            'lines.*.qty' => ['required', 'integer', 'min:1', 'max:100000'],
            'method' => ['nullable', 'in:direct,whatsapp'],
            'businessName' => ['nullable', 'string', 'max:160'],
            'contactPerson' => ['nullable', 'string', 'max:120'],
            'phone' => ['nullable', 'string', 'max:40'],
            'whatsapp' => ['nullable', 'string', 'max:40'],
            'email' => ['nullable', 'email', 'max:160'],
            'address' => ['nullable', 'string', 'max:500'],
            'note' => ['nullable', 'string', 'max:2000'],
        ]);

        $session = ResolveWholesaleSession::of($r);
        $key = substr(trim((string) $r->header('Idempotency-Key', '')), 0, 80) ?: null;
        $order = $this->orders->place($session, $data['lines'], $data, $data['method'] ?? 'direct', $key);

        $out = ['order' => PresentCatalogue::order($order, forBuyer: true)];
        if ($order->method === 'whatsapp') {
            $language = $session->country?->language_code ?? 'en';
            $out['whatsapp'] = WhatsAppMessage::for($order->loadMissing(['items', 'country']), $this->translations->dictionary($language));
        }

        return response()->json($out, 201);
    }

    /** The buyer opened WhatsApp. Recorded as its own fact — it is not the message being sent. */
    public function whatsappOpened(Request $r, string $reference): JsonResponse
    {
        $session = ResolveWholesaleSession::of($r);
        $order = $this->orders->whatsappOpened($this->orders->forBuyer($session, $reference));

        return response()->json(['order' => PresentCatalogue::order($order, forBuyer: true)]);
    }

    /** This buyer's own orders. */
    public function orders(Request $r): JsonResponse
    {
        $session = ResolveWholesaleSession::of($r);

        return response()->json(['orders' => $this->orders->mine($session)->map(fn ($o) => PresentCatalogue::order($o, forBuyer: true))]);
    }

    /** One of them, by the reference the buyer was given — never by guessing a number. */
    public function order(Request $r, string $reference): JsonResponse
    {
        $session = ResolveWholesaleSession::of($r);

        return response()->json(['order' => PresentCatalogue::order($this->orders->forBuyer($session, $reference), forBuyer: true)]);
    }

    /** Signing out: the token stops working everywhere at once, not just in this browser. */
    public function lock(Request $r): JsonResponse
    {
        $this->codes->lock($r->bearerToken());

        return response()->json(['ok' => true]);
    }
}
