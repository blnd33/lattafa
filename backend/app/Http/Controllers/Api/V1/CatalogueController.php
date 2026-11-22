<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\PresentCatalogue;
use App\Models\CatalogueCollection;
use App\Models\CatalogueCountry;
use App\Models\CatalogueLanguage;
use App\Models\CatalogueOrderRule;
use App\Models\WholesaleAccessCode;
use App\Models\WholesaleCustomer;
use App\Models\WholesaleOrder;
use App\Services\Catalogue\AccessCodeService;
use App\Services\Catalogue\AppearanceService;
use App\Services\Catalogue\EnrichmentService;
use App\Services\Catalogue\GeographyService;
use App\Services\Catalogue\OrderService;
use App\Services\Catalogue\PaymentService;
use App\Services\Catalogue\PricingService;
use App\Services\Catalogue\RulesService;
use App\Services\Catalogue\TranslationService;
use App\Services\Catalogue\WholesaleCustomerService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Running the wholesale catalogue, from the admin panel: countries, languages, the words, the businesses that buy
 * and the codes they buy with. Thin, as every controller here is — each service checks its own permission.
 */
class CatalogueController extends Controller
{
    public function __construct(
        private GeographyService $geography,
        private TranslationService $translations,
        private WholesaleCustomerService $customers,
        private AccessCodeService $codes,
        private PricingService $pricing,
        private RulesService $rules,
        private OrderService $orders,
        private PaymentService $payments,
        private AppearanceService $appearance,
        private EnrichmentService $enrichment,
    ) {}

    // ───────────────────────── countries and languages ─────────────────────────

    public function countries(Request $r): JsonResponse
    {
        return response()->json(['countries' => $this->geography->countries($r->user())->map(fn (CatalogueCountry $c) => PresentCatalogue::country($c))]);
    }

    public function saveCountry(Request $r, ?string $id = null): JsonResponse
    {
        $data = $r->validate([
            'iso2' => ['required', 'string', 'size:2'],
            'name' => ['required', 'array'],
            'name.*' => ['nullable', 'string', 'max:120'],
            'language' => ['required', 'string', 'max:12'],
            'enabled' => ['boolean'],
            'isDefault' => ['boolean'],
            'sort' => ['integer', 'min:0', 'max:9999'],
            'minOrderCents' => ['integer', 'min:0'],
        ]);

        $country = $this->geography->saveCountry($r->user(), $data + ['id' => $id]);

        return response()->json(['country' => PresentCatalogue::country($country)], $id ? 200 : 201);
    }

    public function deleteCountry(Request $r, string $id): JsonResponse
    {
        $this->geography->deleteCountry($r->user(), $id);

        return response()->json(['ok' => true]);
    }

    public function languages(Request $r): JsonResponse
    {
        return response()->json(['languages' => $this->geography->languages($r->user())->map(fn (CatalogueLanguage $l) => PresentCatalogue::language($l))]);
    }

    public function saveLanguage(Request $r): JsonResponse
    {
        $data = $r->validate([
            'code' => ['required', 'string', 'max:12'],
            'name' => ['nullable', 'string', 'max:60'],
            'native' => ['nullable', 'string', 'max:60'],
            'rtl' => ['boolean'],
            'enabled' => ['boolean'],
            'sort' => ['integer', 'min:0', 'max:9999'],
        ]);

        return response()->json(['language' => PresentCatalogue::language($this->geography->saveLanguage($r->user(), $data))]);
    }

    public function deleteLanguage(Request $r, string $code): JsonResponse
    {
        $this->geography->deleteLanguage($r->user(), $code);

        return response()->json(['ok' => true]);
    }

    // ───────────────────────── the words ─────────────────────────

    public function translations(Request $r, string $language): JsonResponse
    {
        return response()->json($this->translations->sheet($r->user(), $language));
    }

    public function saveTranslations(Request $r, string $language): JsonResponse
    {
        $data = $r->validate(['values' => ['present', 'array'], 'values.*' => ['nullable', 'string', 'max:2000']]);

        return response()->json(['changed' => $this->translations->save($r->user(), $language, $data['values'])]);
    }

    public function translationProgress(Request $r): JsonResponse
    {
        return response()->json(['languages' => $this->translations->completeness($r->user())]);
    }

    // ───────────────────────── who buys ─────────────────────────

    public function customers(Request $r): JsonResponse
    {
        $filters = $r->validate([
            'q' => ['nullable', 'string', 'max:120'],
            'status' => ['nullable', 'in:active,suspended,closed'],
            'countryId' => ['nullable', 'string', 'max:64'],
        ]);

        return response()->json(['customers' => $this->customers->list($r->user(), $filters)->map(fn (WholesaleCustomer $w) => PresentCatalogue::customer($w))]);
    }

    public function customer(Request $r, string $id): JsonResponse
    {
        return response()->json(['customer' => PresentCatalogue::customer($this->customers->get($r->user(), $id))]);
    }

    public function saveCustomer(Request $r, ?string $id = null): JsonResponse
    {
        $data = $r->validate([
            'businessName' => ['required', 'string', 'max:160'],
            'contactPerson' => ['nullable', 'string', 'max:120'],
            'email' => ['nullable', 'email', 'max:160'],
            'phone' => ['nullable', 'string', 'max:40'],
            'whatsapp' => ['nullable', 'string', 'max:40'],
            'countryId' => ['nullable', 'string', 'max:64'],
            'address' => ['nullable', 'string', 'max:500'],
            'status' => ['nullable', 'in:active,suspended,closed'],
            'notes' => ['nullable', 'string', 'max:2000'],
            'posCustomerId' => ['nullable', 'string', 'max:64'],
        ]);

        $customer = $this->customers->save($r->user(), $data + ['id' => $id]);

        return response()->json(['customer' => PresentCatalogue::customer($customer)], $id ? 200 : 201);
    }

    public function setCustomerStatus(Request $r, string $id): JsonResponse
    {
        $data = $r->validate(['status' => ['required', 'in:active,suspended,closed']]);

        return response()->json(['customer' => PresentCatalogue::customer($this->customers->setStatus($r->user(), $id, $data['status']))]);
    }

    public function deleteCustomer(Request $r, string $id): JsonResponse
    {
        $this->customers->delete($r->user(), $id);

        return response()->json(['ok' => true]);
    }

    // ───────────────────────── the codes they buy with ─────────────────────────

    public function codes(Request $r, string $customerId): JsonResponse
    {
        return response()->json(['codes' => $this->codes->codesFor($r->user(), $customerId)->map(fn (WholesaleAccessCode $c) => PresentCatalogue::code($c))]);
    }

    /**
     * Generates a code. This is the ONE reply in the whole API that carries a code in full: it is shown to the
     * person who pressed the button and never stored anywhere it could be read again.
     */
    public function generateCode(Request $r, string $customerId): JsonResponse
    {
        $data = $r->validate([
            'countryId' => ['nullable', 'string', 'max:64'],
            'expiresAt' => ['nullable', 'integer', 'min:0'],
        ]);

        $out = $this->codes->generate($r->user(), $customerId, $data);

        return response()->json(['code' => PresentCatalogue::code($out['code']), 'plain' => $out['plain']], 201);
    }

    public function setCodeActive(Request $r, string $codeId): JsonResponse
    {
        $data = $r->validate(['active' => ['required', 'boolean']]);

        return response()->json(['code' => PresentCatalogue::code($this->codes->setActive($r->user(), $codeId, $data['active']))]);
    }

    public function revokeCode(Request $r, string $codeId): JsonResponse
    {
        return response()->json(['code' => PresentCatalogue::code($this->codes->revoke($r->user(), $codeId))]);
    }

    // ───────────────────────── what they pay ─────────────────────────

    public function countryPrices(Request $r, string $countryId): JsonResponse
    {
        $filters = $r->validate(['q' => ['nullable', 'string', 'max:120'], 'missing' => ['nullable', 'boolean']]);

        return response()->json(['rows' => $this->pricing->countryGrid($r->user(), $countryId, $filters)]);
    }

    /** `{prices: {variantId: cents|null}}` — `null` takes the price away and the size falls back to the dollar list. */
    public function saveCountryPrices(Request $r, string $countryId): JsonResponse
    {
        $data = $r->validate(['prices' => ['present', 'array', 'max:5000'], 'prices.*' => ['nullable', 'integer', 'min:0', 'max:100000000']]);

        return response()->json(['changed' => $this->pricing->saveCountryPrices($r->user(), $countryId, $data['prices'])]);
    }

    public function customerTerms(Request $r, string $id): JsonResponse
    {
        return response()->json($this->pricing->customerTerms($r->user(), $id));
    }

    /** `{terms: {variantId: {priceCents?, percentBp?, validFrom?, validTo?}}}` — a price **or** a percentage, never both. */
    public function saveCustomerTerms(Request $r, string $id): JsonResponse
    {
        $data = $r->validate([
            'terms' => ['present', 'array', 'max:5000'],
            'terms.*.priceCents' => ['nullable', 'integer', 'min:0', 'max:100000000'],
            'terms.*.percentBp' => ['nullable', 'integer', 'min:0', 'max:10000'],
            'terms.*.validFrom' => ['nullable', 'integer', 'min:0'],
            'terms.*.validTo' => ['nullable', 'integer', 'min:0'],
        ]);

        return response()->json(['changed' => $this->pricing->saveCustomerPrices($r->user(), $id, $data['terms'])]);
    }

    /** `{percentBp: 1750}` for 17.5 % off everything, or `{percentBp: null}` to withdraw it. */
    public function setCustomerDiscount(Request $r, string $id): JsonResponse
    {
        $data = $r->validate([
            'percentBp' => ['present', 'nullable', 'integer', 'min:0', 'max:10000'],
            'validFrom' => ['nullable', 'integer', 'min:0'],
            'validTo' => ['nullable', 'integer', 'min:0'],
        ]);

        $discount = $this->pricing->setCustomerDiscount($r->user(), $id, $data['percentBp'], $data['validFrom'] ?? null, $data['validTo'] ?? null);

        return response()->json(['discount' => $discount ? [
            'id' => $discount->id, 'percentBp' => $discount->percent_off_bp, 'validFrom' => $discount->valid_from, 'validTo' => $discount->valid_to,
        ] : null]);
    }

    public function priceHistory(Request $r): JsonResponse
    {
        $filters = $r->validate([
            'scope' => ['nullable', 'in:country,customer,customer_wide'],
            'scopeId' => ['nullable', 'string', 'max:64'],
            'variantId' => ['nullable', 'string', 'max:64'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:500'],
        ]);

        return response()->json(['history' => $this->pricing->history($r->user(), $filters)->map(fn ($h) => PresentCatalogue::priceChange($h))]);
    }

    // ───────────────────────── how little we will sell ─────────────────────────

    public function rules(Request $r): JsonResponse
    {
        return response()->json(['rules' => $this->rules->rules($r->user())->map(fn (CatalogueOrderRule $x) => PresentCatalogue::rule($x))]);
    }

    public function saveRule(Request $r): JsonResponse
    {
        $data = $r->validate([
            'scope' => ['required', 'in:global,category'],
            'scopeId' => ['nullable', 'string', 'max:60'],
            'minOrderCents' => ['nullable', 'integer', 'min:0', 'max:100000000'],
            'minQty' => ['nullable', 'integer', 'min:0', 'max:100000'],
            'qtyIncrement' => ['nullable', 'integer', 'min:0', 'max:100000'],
            'enabled' => ['boolean'],
        ]);

        return response()->json(['rule' => PresentCatalogue::rule($this->rules->saveRule($r->user(), $data))]);
    }

    public function deleteRule(Request $r, string $id): JsonResponse
    {
        $this->rules->deleteRule($r->user(), $id);

        return response()->json(['ok' => true]);
    }

    public function exemptions(Request $r, string $id): JsonResponse
    {
        return response()->json(['letOff' => $this->rules->exemptions($r->user(), $id)]);
    }

    // ───────────────────────── how it looks ─────────────────────────

    public function appearance(Request $r): JsonResponse
    {
        return response()->json($this->appearance->read($r->user()));
    }

    /** `PUT /catalogue/appearance/brand|homepage|footer` — one part at a time, so two screens cannot clash. */
    public function saveAppearance(Request $r, string $key): JsonResponse
    {
        $data = $r->validate(['patch' => ['present', 'array']]);

        return response()->json($this->appearance->save($r->user(), $key, $data['patch']));
    }

    /** The picture behind the top of the homepage. `{image: null}` takes it away. */
    public function setHero(Request $r): JsonResponse
    {
        $data = $r->validate(['image' => ['present', 'nullable', 'string']]);

        return response()->json($this->appearance->setHero($r->user(), $data['image']));
    }

    // ───────────────────────── collections and perfumes ─────────────────────────

    public function collections(Request $r): JsonResponse
    {
        return response()->json(['collections' => $this->enrichment->collections($r->user())->map(fn (CatalogueCollection $c) => PresentCatalogue::collection($c))]);
    }

    public function saveCollection(Request $r, ?string $id = null): JsonResponse
    {
        $data = $r->validate([
            'slug' => ['nullable', 'string', 'max:80'],
            'name' => ['required', 'array'],
            'name.*' => ['nullable', 'string', 'max:120'],
            'description' => ['nullable', 'array'],
            'description.*' => ['nullable', 'string', 'max:600'],
            'enabled' => ['boolean'],
            'featured' => ['boolean'],
            'sort' => ['integer', 'min:0', 'max:9999'],
            'image' => ['nullable', 'string'],
        ]);

        $collection = $this->enrichment->saveCollection($r->user(), $data + ['id' => $id]);

        return response()->json(['collection' => PresentCatalogue::collection($collection)], $id ? 200 : 201);
    }

    public function deleteCollection(Request $r, string $id): JsonResponse
    {
        $this->enrichment->deleteCollection($r->user(), $id);

        return response()->json(['ok' => true]);
    }

    public function setCollectionProducts(Request $r, string $id): JsonResponse
    {
        $data = $r->validate(['productIds' => ['present', 'array', 'max:500'], 'productIds.*' => ['string', 'max:64']]);

        return response()->json(['count' => $this->enrichment->setCollectionProducts($r->user(), $id, $data['productIds'])]);
    }

    public function catalogueProduct(Request $r, string $id): JsonResponse
    {
        return response()->json($this->enrichment->product($r->user(), $id));
    }

    public function setCatalogueProduct(Request $r, string $id): JsonResponse
    {
        $data = $r->validate([
            'hidden' => ['boolean'],
            'featured' => ['nullable', 'boolean'],
            'sort' => ['nullable', 'integer', 'min:0', 'max:9999'],
        ]);
        $this->enrichment->setProduct($r->user(), $id, $data);

        return response()->json($this->enrichment->product($r->user(), $id));
    }

    public function setProductText(Request $r, string $id, string $language): JsonResponse
    {
        $data = $r->validate([
            'name' => ['nullable', 'string', 'max:200'],
            'description' => ['nullable', 'string', 'max:4000'],
            'notes' => ['nullable', 'array'],
        ]);
        $this->enrichment->setProductText($r->user(), $id, $language, $data);

        return response()->json($this->enrichment->product($r->user(), $id));
    }

    public function addProductImage(Request $r, string $id): JsonResponse
    {
        $data = $r->validate(['image' => ['required', 'string']]);
        $this->enrichment->addImage($r->user(), $id, $data['image']);

        return response()->json($this->enrichment->product($r->user(), $id), 201);
    }

    public function deleteProductImage(Request $r, string $imageId): JsonResponse
    {
        $this->enrichment->deleteImage($r->user(), $imageId);

        return response()->json(['ok' => true]);
    }

    // ───────────────────────── orders ─────────────────────────

    public function orders(Request $r): JsonResponse
    {
        $filters = $r->validate([
            'status' => ['nullable', 'string', 'max:24'],
            'customerId' => ['nullable', 'string', 'max:64'],
            'countryId' => ['nullable', 'string', 'max:64'],
            'q' => ['nullable', 'string', 'max:120'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:500'],
        ]);

        return response()->json(['orders' => $this->orders->list($r->user(), $filters)->map(fn (WholesaleOrder $o) => PresentCatalogue::order($o))]);
    }

    public function order(Request $r, string $id): JsonResponse
    {
        return response()->json(['order' => PresentCatalogue::order($this->orders->get($r->user(), $id))]);
    }

    /** Takes the stock off the shelf for good and consumes the hold, in one transaction. Running it twice is harmless. */
    public function approveOrder(Request $r, string $id): JsonResponse
    {
        return response()->json(['order' => PresentCatalogue::order($this->orders->approve($r->user(), $id))]);
    }

    public function rejectOrder(Request $r, string $id): JsonResponse
    {
        $data = $r->validate(['reason' => ['nullable', 'string', 'max:300']]);

        return response()->json(['order' => PresentCatalogue::order($this->orders->reject($r->user(), $id, $data['reason'] ?? ''))]);
    }

    public function cancelOrder(Request $r, string $id): JsonResponse
    {
        $data = $r->validate(['reason' => ['nullable', 'string', 'max:300']]);

        return response()->json(['order' => PresentCatalogue::order($this->orders->cancel($r->user(), $id, $data['reason'] ?? ''))]);
    }

    /** Lets the bottles go without deciding on the order — for one that has sat far too long. */
    public function releaseHold(Request $r, string $id): JsonResponse
    {
        $data = $r->validate(['reason' => ['nullable', 'string', 'max:300']]);

        return response()->json(['order' => PresentCatalogue::order($this->orders->releaseHold($r->user(), $id, $data['reason'] ?? ''))]);
    }

    // ───────────────────────── money against an order ─────────────────────────

    public function payments(Request $r, string $id): JsonResponse
    {
        return response()->json(['payments' => $this->payments->forOrder($r->user(), $id)->map(fn ($p) => PresentCatalogue::payment($p))]);
    }

    public function recordPayment(Request $r, string $id): JsonResponse
    {
        $data = $r->validate([
            'method' => ['required', 'in:bank_transfer,cash,other'],
            'amountCents' => ['required', 'integer', 'min:1', 'max:100000000'],
            'reference' => ['nullable', 'string', 'max:160'],
            'note' => ['nullable', 'string', 'max:500'],
            'status' => ['nullable', 'in:pending,confirmed,failed,refunded'],
            'occurredAt' => ['nullable', 'integer', 'min:0'],
        ]);

        return response()->json(['payment' => PresentCatalogue::payment($this->payments->record($r->user(), $id, $data))], 201);
    }

    public function setPaymentStatus(Request $r, string $paymentId): JsonResponse
    {
        $data = $r->validate(['status' => ['required', 'in:pending,confirmed,failed,refunded']]);

        return response()->json(['payment' => PresentCatalogue::payment($this->payments->setStatus($r->user(), $paymentId, $data['status']))]);
    }

    public function deletePayment(Request $r, string $paymentId): JsonResponse
    {
        $this->payments->delete($r->user(), $paymentId);

        return response()->json(['ok' => true]);
    }

    public function setExemptions(Request $r, string $id): JsonResponse
    {
        $data = $r->validate([
            'letOff' => ['present', 'array'],
            'letOff.*' => ['in:min_order,min_qty,qty_increment'],
        ]);

        return response()->json(['letOff' => $this->rules->setExemptions($r->user(), $id, $data['letOff'])]);
    }
}
