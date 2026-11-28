<?php

use App\Http\Controllers\Api\V1\AuthController;
use App\Http\Controllers\Api\V1\CatalogueController;
use App\Http\Controllers\Api\V1\CustomerController;
use App\Http\Controllers\Api\V1\DelegateController;
use App\Http\Controllers\Api\V1\ExpenseController;
use App\Http\Controllers\Api\V1\MenuController;
use App\Http\Controllers\Api\V1\OrderController;
use App\Http\Controllers\Api\V1\PushController;
use App\Http\Controllers\Api\V1\ProductController;
use App\Http\Controllers\Api\V1\PurchasingController;
use App\Http\Controllers\Api\V1\ReportController;
use App\Http\Controllers\Api\V1\RoleController;
use App\Http\Controllers\Api\V1\SaleController;
use App\Http\Controllers\Api\V1\SetupController;
use App\Http\Controllers\Api\V1\ShiftController;
use App\Http\Controllers\Api\V1\StockController;
use App\Http\Controllers\Api\V1\SyncController;
use App\Http\Controllers\Api\V1\SystemController;
use App\Http\Controllers\Api\V1\UserController;
use App\Http\Controllers\Api\V1\WholesaleController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Lattafa API — /api/v1
|--------------------------------------------------------------------------
| JSON in/out, camelCase keys (same shapes as pos/src/data/types.ts).
| Errors: {"error": {"code": "...", "params": {...}}} — codes match the POS `err.<code>` messages.
| Every authenticated request may carry `X-Device-Id` (the till's UUID).
*/

// Every `{id}` is a UUID. Anything else is a plain 404 (PostgreSQL would otherwise raise an error comparing it to a uuid column).
Route::pattern('id', '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}');

// where each web app lives (they link to each other) — public: the sign-in screens need it too
Route::get('/apps', fn () => response()->json(config('app.addresses'))->header('Cache-Control', 'public, max-age=300'));

Route::get('/health', fn () => ['ok' => true, 'app' => 'lattafa', 'time' => (int) floor(microtime(true) * 1000)]);

// ── public perfume menu (QR code in the shop) — no sign-in, customer-safe fields only ──
Route::get('/menu', [MenuController::class, 'index'])->middleware('throttle:120,1');
// a shop ordering from the menu: no sign-in either, so it is held to a few an hour per address
Route::post('/orders', [OrderController::class, 'store'])->middleware('throttle:10,60');

// ── the wholesale catalogue, as a buyer abroad meets it — no staff account, a code or nothing ──
// Nothing here returns a price. A session is not a Sanctum token (see ResolveWholesaleSession).
Route::prefix('wholesale')->group(function () {
    Route::get('open', [WholesaleController::class, 'open'])->middleware('throttle:120,1');
    // the collection itself — public, and with no price anywhere in it
    Route::get('products', [WholesaleController::class, 'products'])->middleware('throttle:120,1');
    Route::post('unlock', [WholesaleController::class, 'unlock'])->middleware('throttle:30,1');
    Route::middleware('wholesale')->group(function () {
        Route::get('me', [WholesaleController::class, 'me']);
        // the only route by which a wholesale price ever leaves the server
        Route::get('prices', [WholesaleController::class, 'prices']);
        Route::post('quote', [WholesaleController::class, 'quote']);
        // sending an order. `Idempotency-Key` makes the same checkout sent twice one order, not two.
        Route::post('orders', [WholesaleController::class, 'placeOrder'])->middleware('throttle:30,1');
        Route::get('orders', [WholesaleController::class, 'orders']);
        Route::get('orders/{reference}', [WholesaleController::class, 'order'])->where('reference', '[A-Za-z0-9]{4,40}');
        Route::post('orders/{reference}/whatsapp-opened', [WholesaleController::class, 'whatsappOpened'])->where('reference', '[A-Za-z0-9]{4,40}');
        Route::post('lock', [WholesaleController::class, 'lock']);
    });
});

// ── first run + sign-in (no token yet) ──
Route::get('/setup/status', [SetupController::class, 'status']);
Route::post('/setup', [SetupController::class, 'run'])->middleware('throttle:5,1');

Route::prefix('auth')->middleware('device')->group(function () {
    Route::post('login', [AuthController::class, 'login'])->middleware('throttle:20,1');
    Route::post('pin-login', [AuthController::class, 'pinLogin'])->middleware('throttle:30,1');
    Route::get('login-users', [AuthController::class, 'loginUsers'])->middleware('throttle:30,1');
});

// ── everything else needs a token ──
Route::middleware(['auth:sanctum', 'device'])->group(function () {
    Route::prefix('auth')->group(function () {
        Route::get('me', [AuthController::class, 'me']);
        Route::post('refresh', [AuthController::class, 'refresh']);
        Route::post('logout', [AuthController::class, 'logout']);
        Route::post('approve', [AuthController::class, 'approve'])->middleware('throttle:30,1');
        Route::post('change-credentials', [AuthController::class, 'changeCredentials'])->middleware('throttle:10,1');
    });

    // accounts, roles, permissions
    Route::get('users', [UserController::class, 'index']);
    Route::post('users', [UserController::class, 'store']);
    Route::put('users/{id}', [UserController::class, 'update']);
    Route::delete('users/{id}', [UserController::class, 'destroy']);
    Route::post('users/{id}/reset-credentials', [UserController::class, 'resetCredentials']);
    Route::post('users/{id}/unlock', [UserController::class, 'unlock']);
    Route::get('roles', [RoleController::class, 'index']);
    Route::get('permissions', [RoleController::class, 'catalogue']);
    Route::post('roles', [RoleController::class, 'store']);
    Route::put('roles/{id}', [RoleController::class, 'update']);
    Route::delete('roles/{id}', [RoleController::class, 'destroy']);

    // system
    Route::get('settings', [SystemController::class, 'settings'])->middleware('perm:settings.view');
    Route::put('settings', [SystemController::class, 'updateSettings']);
    Route::get('devices', [SystemController::class, 'devices']);
    Route::put('devices/{id}', [SystemController::class, 'updateDevice']);
    Route::post('devices/{id}/revoke', [SystemController::class, 'revokeDevice']);
    Route::post('devices/{id}/restore', [SystemController::class, 'restoreDevice']);
    Route::get('audit', [SystemController::class, 'audit'])->middleware('perm:audit.view');

    // catalogue
    Route::get('products', [ProductController::class, 'index']);
    Route::get('products/lookup', [ProductController::class, 'lookup']);
    Route::get('products/next-barcode', [ProductController::class, 'nextBarcode']);
    Route::get('brands', [ProductController::class, 'brands']);
    Route::post('products', [ProductController::class, 'store']);
    Route::post('products/bulk-price', [ProductController::class, 'bulkPrice']);
    Route::post('products/import', [ProductController::class, 'import']);
    Route::put('products/{id}', [ProductController::class, 'update']);
    Route::patch('products/{id}/active', [ProductController::class, 'setActive']);
    Route::delete('products/{id}', [ProductController::class, 'destroy']);
    // the customer menu as arranged in the admin panel (which perfumes, featured/new, order, menu settings)
    Route::get('menu/manage', [MenuController::class, 'manage']);
    Route::put('menu/manage', [MenuController::class, 'arrange']);
    // photos/videos behind the top of the menu, uploaded in pieces (MenuMedia)
    Route::post('menu/media', [MenuController::class, 'startMedia']);
    Route::put('menu/media/order', [MenuController::class, 'orderMedia']);
    Route::put('menu/media/{id}/part', [MenuController::class, 'mediaPart']);
    Route::post('menu/media/{id}/finish', [MenuController::class, 'finishMedia']);
    Route::delete('menu/media/{id}', [MenuController::class, 'deleteMedia']);

    // inventory
    Route::get('stock/movements', [StockController::class, 'movements']);
    Route::get('stock/low', [StockController::class, 'low']);
    Route::post('stock/adjust', [StockController::class, 'adjust']);
    Route::post('stock/receive', [StockController::class, 'receive']);
    Route::post('stock/tester', [StockController::class, 'tester']);
    Route::post('stock/count', [StockController::class, 'count']);

    // customers
    Route::get('customers', [CustomerController::class, 'index']);
    Route::post('customers', [CustomerController::class, 'store']);
    Route::get('customers/{id}', [CustomerController::class, 'show']);
    Route::put('customers/{id}', [CustomerController::class, 'update']);
    Route::delete('customers/{id}', [CustomerController::class, 'destroy']);
    Route::post('customers/{id}/collect', [CustomerController::class, 'collect']);
    Route::get('customers/{id}/statement', [CustomerController::class, 'statement']);

    // sales, returns, shifts
    Route::post('sales', [SaleController::class, 'store']);
    Route::get('sales', [SaleController::class, 'index']);
    Route::get('sales/review', [SaleController::class, 'review']);
    Route::get('sales/{id}', [SaleController::class, 'show'])->where('id', '[A-Za-z0-9._-]{1,64}'); // a sale id OR its receipt number (scanned barcode)
    Route::post('sales/{id}/void', [SaleController::class, 'void']);
    Route::post('sales/{id}/correct', [SaleController::class, 'correct']);
    Route::post('sales/{id}/reviewed', [SaleController::class, 'reviewed'])->whereUuid('id');
    Route::post('returns', [SaleController::class, 'createReturn']);
    Route::get('returns', [SaleController::class, 'returns']);
    Route::get('shifts', [ShiftController::class, 'index']);
    Route::get('shifts/current', [ShiftController::class, 'current']);
    Route::post('shifts/open', [ShiftController::class, 'open']);
    Route::post('shifts/close', [ShiftController::class, 'close']);
    Route::post('shifts/cash-movements', [ShiftController::class, 'cashMovement']);
    Route::get('shifts/{id}', [ShiftController::class, 'show']);

    // reports
    Route::get('dashboard', [ReportController::class, 'dashboard']);
    Route::get('debts', [ReportController::class, 'debts']);

    // the admin panel's assistant (Claude) — read-only, admin panel only
    Route::get('assistant/status', [\App\Http\Controllers\Api\V1\AssistantController::class, 'status']);
    Route::post('assistant/chat', [\App\Http\Controllers\Api\V1\AssistantController::class, 'chat'])->middleware('throttle:30,1');
    Route::get('reports/sales', [ReportController::class, 'sales']);
    Route::get('reports/stock-valuation', [ReportController::class, 'stockValuation']);
    Route::get('reports/debtors', [ReportController::class, 'debtors']);
    Route::get('reports/table/{type}', [ReportController::class, 'table'])->where('type', '[a-z-]{3,40}');
    Route::put('delegates/{id}/commission', [ReportController::class, 'commission']);
    Route::post('reports/missing-cost/{variantId}', [ReportController::class, 'fixMissingCost']);

    // buying: suppliers, purchase orders, receiving, supplier payments
    Route::get('suppliers', [PurchasingController::class, 'suppliers']);
    Route::post('suppliers', [PurchasingController::class, 'saveSupplier']);
    Route::put('suppliers/{id}', [PurchasingController::class, 'saveSupplier']);
    Route::get('suppliers/{id}/statement', [PurchasingController::class, 'statement']);
    Route::post('suppliers/{id}/payments', [PurchasingController::class, 'pay']);
    Route::delete('supplier-payments/{id}', [PurchasingController::class, 'deletePayment']);
    Route::get('purchase-orders', [PurchasingController::class, 'orders']);
    Route::post('purchase-orders', [PurchasingController::class, 'createOrder']);
    Route::get('purchase-orders/{id}', [PurchasingController::class, 'order']);
    Route::put('purchase-orders/{id}', [PurchasingController::class, 'updateOrder']);
    Route::post('purchase-orders/{id}/receive', [PurchasingController::class, 'receive']);
    Route::post('purchase-orders/{id}/cancel', [PurchasingController::class, 'cancel']);

    // spending
    Route::get('expenses', [ExpenseController::class, 'index']);
    Route::post('expenses', [ExpenseController::class, 'store']);
    Route::put('expenses/{id}', [ExpenseController::class, 'store']);
    Route::delete('expenses/{id}', [ExpenseController::class, 'destroy']);

    // running the wholesale catalogue (its screens live in the admin panel; each service checks its own permission)
    Route::prefix('catalogue')->group(function () {
        Route::get('countries', [CatalogueController::class, 'countries']);
        Route::post('countries', [CatalogueController::class, 'saveCountry']);
        Route::put('countries/{id}', [CatalogueController::class, 'saveCountry']);
        Route::delete('countries/{id}', [CatalogueController::class, 'deleteCountry']);

        Route::get('languages', [CatalogueController::class, 'languages']);
        Route::put('languages', [CatalogueController::class, 'saveLanguage']);
        Route::delete('languages/{code}', [CatalogueController::class, 'deleteLanguage'])->where('code', '[a-z]{2,3}(-[a-z0-9]{2,8})?');

        Route::get('translations', [CatalogueController::class, 'translationProgress']);
        Route::get('translations/{language}', [CatalogueController::class, 'translations'])->where('language', '[a-z]{2,3}(-[a-z0-9]{2,8})?');
        Route::put('translations/{language}', [CatalogueController::class, 'saveTranslations'])->where('language', '[a-z]{2,3}(-[a-z0-9]{2,8})?');

        Route::get('customers', [CatalogueController::class, 'customers']);
        Route::post('customers', [CatalogueController::class, 'saveCustomer']);
        Route::get('customers/{id}', [CatalogueController::class, 'customer']);
        Route::put('customers/{id}', [CatalogueController::class, 'saveCustomer']);
        Route::patch('customers/{id}/status', [CatalogueController::class, 'setCustomerStatus']);
        Route::delete('customers/{id}', [CatalogueController::class, 'deleteCustomer']);

        // the one reply in the whole API that carries an access code in full is POST .../codes
        Route::get('customers/{customerId}/codes', [CatalogueController::class, 'codes'])->whereUuid('customerId');
        Route::post('customers/{customerId}/codes', [CatalogueController::class, 'generateCode'])->whereUuid('customerId');
        Route::patch('codes/{codeId}/active', [CatalogueController::class, 'setCodeActive'])->whereUuid('codeId');
        Route::post('codes/{codeId}/revoke', [CatalogueController::class, 'revokeCode'])->whereUuid('codeId');

        // wholesale prices: by country, then what a particular business has been promised on top
        Route::get('prices/history', [CatalogueController::class, 'priceHistory']);
        Route::get('prices/{countryId}', [CatalogueController::class, 'countryPrices'])->whereUuid('countryId');
        Route::put('prices/{countryId}', [CatalogueController::class, 'saveCountryPrices'])->whereUuid('countryId');
        Route::get('customers/{id}/terms', [CatalogueController::class, 'customerTerms']);
        Route::put('customers/{id}/terms', [CatalogueController::class, 'saveCustomerTerms']);
        Route::put('customers/{id}/discount', [CatalogueController::class, 'setCustomerDiscount']);
        Route::get('customers/{id}/exemptions', [CatalogueController::class, 'exemptions']);
        Route::put('customers/{id}/exemptions', [CatalogueController::class, 'setExemptions']);

        // wholesale orders: the shop's side of them
        Route::get('orders', [CatalogueController::class, 'orders']);
        Route::get('orders/{id}', [CatalogueController::class, 'order']);
        Route::post('orders/{id}/approve', [CatalogueController::class, 'approveOrder']);
        Route::post('orders/{id}/reject', [CatalogueController::class, 'rejectOrder']);
        Route::post('orders/{id}/cancel', [CatalogueController::class, 'cancelOrder']);
        Route::get('orders/{id}/payments', [CatalogueController::class, 'payments']);
        Route::post('orders/{id}/payments', [CatalogueController::class, 'recordPayment']);
        Route::patch('payments/{paymentId}', [CatalogueController::class, 'setPaymentStatus'])->whereUuid('paymentId');
        Route::delete('payments/{paymentId}', [CatalogueController::class, 'deletePayment'])->whereUuid('paymentId');

        // how the catalogue looks, and what it says about the house
        Route::get('appearance', [CatalogueController::class, 'appearance']);
        Route::put('appearance/hero', [CatalogueController::class, 'setHero']);
        Route::put('appearance/{key}', [CatalogueController::class, 'saveAppearance'])->where('key', 'brand|homepage|footer');

        // editorial collections, and the catalogue's own view of a perfume the POS owns
        Route::get('collections', [CatalogueController::class, 'collections']);
        Route::post('collections', [CatalogueController::class, 'saveCollection']);
        Route::put('collections/{id}', [CatalogueController::class, 'saveCollection']);
        Route::delete('collections/{id}', [CatalogueController::class, 'deleteCollection']);
        Route::put('collections/{id}/products', [CatalogueController::class, 'setCollectionProducts']);

        Route::get('perfumes/{id}', [CatalogueController::class, 'catalogueProduct']);
        Route::put('perfumes/{id}', [CatalogueController::class, 'setCatalogueProduct']);
        Route::put('perfumes/{id}/text/{language}', [CatalogueController::class, 'setProductText'])->where('language', '[a-z]{2,3}(-[a-z0-9]{2,8})?');
        Route::post('perfumes/{id}/images', [CatalogueController::class, 'addProductImage']);
        Route::delete('images/{imageId}', [CatalogueController::class, 'deleteProductImage'])->whereUuid('imageId');

        // how little the shop will sell
        Route::get('rules', [CatalogueController::class, 'rules']);
        Route::put('rules', [CatalogueController::class, 'saveRule']);
        Route::delete('rules/{id}', [CatalogueController::class, 'deleteRule']);
    });

    // being told about new orders with the app closed
    Route::get('push/key', [PushController::class, 'key']);
    Route::post('push/subscribe', [PushController::class, 'subscribe']);
    Route::post('push/unsubscribe', [PushController::class, 'unsubscribe']);

    // orders shops sent from the menu — delegates work them, managers watch them
    Route::get('orders', [OrderController::class, 'index']);
    Route::get('orders/waiting', [OrderController::class, 'waiting']);
    // the delegate's own dollar prices for the shop's perfumes (never set from the till)
    Route::get('delegate-prices', [OrderController::class, 'prices']);
    Route::put('delegate-prices', [OrderController::class, 'setPrices']);
    Route::post('delegate-products', [OrderController::class, 'addProduct']);
    Route::post('orders/{id}/accept', [OrderController::class, 'accept']);
    Route::post('orders/{id}/refuse', [OrderController::class, 'refuse']);

    // field sales (delegates)
    Route::get('delegates', [DelegateController::class, 'index']);
    Route::get('delegates/{id}/van', [DelegateController::class, 'van']);
    Route::post('delegates/{id}/load', [DelegateController::class, 'load']);
    Route::post('delegates/{id}/unload', [DelegateController::class, 'unload']);
    // a delegate's own selling prices: they may set their own, a manager may set anyone's
    Route::get('delegates/{id}/dashboard', [DelegateController::class, 'dashboard']);
    Route::get('delegates/{id}/prices', [DelegateController::class, 'prices']);
    Route::put('delegates/{id}/prices', [DelegateController::class, 'setPrices']);
    Route::get('stock-requests', [DelegateController::class, 'requests']);
    Route::post('stock-requests', [DelegateController::class, 'createRequest']);
    Route::post('stock-requests/{id}/cancel', [DelegateController::class, 'cancelRequest']);
    Route::post('delegate-locations', [DelegateController::class, 'storeLocations'])->middleware('throttle:30,1');
    Route::get('delegates/{id}/locations', [DelegateController::class, 'locations']);
    Route::post('delegates/{id}/receive-cash', [DelegateController::class, 'receiveCash']);
    Route::get('visits', [DelegateController::class, 'visits']);
    Route::post('visits', [DelegateController::class, 'createVisit']);
    Route::get('delegate-closings', [DelegateController::class, 'closings']);
    Route::get('delegate-closings/figures', [DelegateController::class, 'figures']);
    Route::post('delegate-closings', [DelegateController::class, 'submitClosing']);
    Route::post('delegate-closings/{id}/approve', [DelegateController::class, 'approveClosing']);
    Route::post('delegate-closings/{id}/reject', [DelegateController::class, 'rejectClosing']);

    // offline sync
    Route::post('sync/push', [SyncController::class, 'push']);
    Route::get('sync/pull', [SyncController::class, 'pull']);
});
