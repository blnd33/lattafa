# Lattafa Wholesale Digital Catalogue — build plan

A luxury B2B wholesale catalogue for Lattafa: international shops and distributors browse the whole
collection, unlock their own USD wholesale prices with a private code, and send orders that reserve stock
and wait for the owner's approval.

This plan is written against **the system that already exists in this repository**, not against a blank page.
Read §1 first: it changes the shape of most of the work.

---

## 1 · What is already here, and what that means

The repository is a working perfume business system for the Lattafa shop in Duhok — live on
`lattafa-system.com`. One Laravel API, one PostgreSQL database, four web apps on one domain:

| URL | App | Source |
|---|---|---|
| `/menu/` | Public perfume menu (the QR code in the shop) | `menu/` |
| `/pos/` | Store point of sale (tills, tablets) | `pos/` |
| `/delegate/` | Delegate field sales — a POS for the road | `delegate/` |
| `/admin/` | Admin panel for the owner and managers | `admin/` |
| `/api/v1/…` | Laravel 13 · PHP 8.4 · PostgreSQL · Sanctum | `backend/` |

163 backend tests, 148 front-end tests, all green.

### 1.1 The POS is not a remote system — it is the same database

The master brief assumes the catalogue must *integrate* with an external POS: webhooks, scheduled
synchronisation, idempotent remote stock deductions, reconciliation tooling, and a careful answer to
"who owns inventory". **None of that applies here.** The POS is this repository. The catalogue is a fifth
app on the same domain, reading and writing the same PostgreSQL database through the same services.

That dissolves the brief's hardest requirement (§36, "Critical Inventory Consistency") instead of
engineering around it:

* There is no product synchronisation. `products` and `variants` *are* the catalogue's products.
* There is no inventory synchronisation. `stock` *is* the catalogue's stock.
* A reservation and the order that owns it are rows in the same database as the stock they hold, so they
  commit in **one transaction** — overselling is prevented by a row lock, not by a distributed protocol.
* Approving an order deducts stock through `StockService::applyMovement`, the one writer the whole system
  already funnels every stock change through. A deduction cannot happen twice because the reservation row
  moves `ACTIVE → CONSUMED` inside that same transaction.
* No sync jobs, no webhook receivers, no retry queues, no "last successful sync" timestamp, no drift.

What we **do** still build is one seam, so this stays true rather than becoming folklore: a thin
`App\Services\Catalogue\Inventory` port that every catalogue read and write of stock goes through. If the
catalogue is ever split onto its own server, that one file is what gets a remote implementation. It will be
documented honestly as *same-database access*, never as a live integration with a remote POS.

### 1.2 What the existing schema already gives us

`products` already carries what a perfume catalogue needs: `name` and `description` as JSON per language,
`brand`, `category`, `gender`, `concentration`, `scent_families`, `notes` as `{top, heart, base}`, `season`,
`longevity`, `sillage`, `image_path`, plus `featured` / `is_new` / `show_on_menu` flags.

`variants` is one row per bottle size: `label`, `ml`, `sku`, `barcode`, `cost_iqd`, `retail_iqd`,
`wholesale_iqd`, **`wholesale_usd_cents`**, `cost_usd_cents`, `min_stock`.

`stock` is one row per variant × location, written only by `StockService`. `stock_movements` is the ledger
behind it — every change explained, with `ref_type` / `ref_id` so a balance can always be traced.

Also reusable as-is: Sanctum auth, the custom RBAC (`Support/Permissions.php`, mirrored 1:1 in
`pos/src/lib/permissions.ts`), `AuditService`, `SettingsService`, `PushService` and the in-app bell, the
built-in Excel reader/writer (`pos/src/lib/xlsx.ts`, no library), the branded A4 print pages, the shared UI
kit and money helpers under `pos/src` (imported everywhere as `@/…`), and the fonts already installed —
Playfair Display, Poppins, Tajawal.

### 1.3 Three collisions to settle deliberately

**Dollar prices already exist.** `variants.wholesale_usd_cents` is the dollar price list the *delegate*
sells to shops with, managed in admin → Delegates → Prices. The catalogue needs *country-specific* USD
prices. Plan: country prices are an **override layer on top of that list**, not a replacement — a size with
no country price falls back to `wholesale_usd_cents`, so the shop does not re-type hundreds of prices to
open a new country, and the delegate's own list keeps working untouched.

**An `orders` table already exists.** It is the menu order *request*: a shop taps Add on the QR menu, a
delegate accepts it, and the real sale happens when the goods are handed over. No prices, no stock
movement. The catalogue's order is a different animal — agreed unit prices, reservations, approval,
payments. Plan: a **new `wholesale_orders` table**. The menu → delegate flow is not touched.

**Languages are compile-time today.** `pos/src/i18n` holds hand-written `en` / `ar` / `ku` dictionaries and
a `Lang` union type. The brief needs languages the owner can add without a developer — Turkish, German,
French, Kurdish Badini and Sorani. Plan: the **catalogue gets a database-backed translation layer**
(`catalogue_languages`, `catalogue_translations`, `catalogue_product_translations`), seeded from files and
editable in the admin panel. The POS, delegate app and admin panel keep their TypeScript dictionaries —
there is no reason to destabilise three working apps.

### 1.4 House rules the catalogue inherits

| Rule | Why it matters here |
|---|---|
| UUID primary keys | Every new table follows it |
| Money as exact integers; timestamps as epoch-milliseconds `bigint` | Catalogue is USD-only → **integer cents** everywhere, matching `wholesale_usd_cents` |
| Business rules live in `Services/`, controllers only validate and present | Every catalogue rule goes in a service that checks its own permission |
| Prices are recomputed on the server; a client can never state a price | Already the law in `SaleService::checkout`; the catalogue's cart obeys it |
| Protected fields never leave the server (`Present::product` drops cost for the unprivileged; the menu drops prices entirely when the shop hides them) | Wholesale prices are **omitted from the JSON**, not hidden in CSS |
| Secrets stored as HMAC fingerprint + bcrypt hash (how user PINs work) | Access codes use the same proven pattern |

---

## 2 · Decisions this plan assumes

| # | Decision | Taken |
|---|---|---|
| D1 | The catalogue is a fifth app in this repository (`catalogue/`, React + Vite + Tailwind), served at `/catalogue/` on the same domain, against the same Laravel API and PostgreSQL database | §1.1 — one database removes the inventory-consistency problem entirely. The brief sanctions it: *"Use the existing project's technology where practical."* |
| D2 | Country prices override `variants.wholesale_usd_cents`, which stays the fallback | §1.3 — no double data entry, delegate list untouched |
| D3 | A new `wholesale_orders` family of tables; the existing `orders` (menu → delegate) is untouched | §1.3 |
| D4 | The catalogue gets DB-backed translations; the other three apps keep their TS dictionaries | §1.3 |
| D5 | USD only, stored as integer cents. No currency switch, no conversion | Brief §6, §45 |
| D6 | The catalogue sits **alongside** the QR menu. The menu stays the walk-in/retail-facing page; the catalogue is the international wholesale channel | Both can live on one domain without overlap |
| D7 | Online card payments ship as a **documented, unimplemented port**. Offline methods (bank transfer, cash) are fully built | No payment provider is chosen or approved yet; the brief forbids inventing one |

---

## 3 · The phases

Each phase ends with the whole system still runnable, `php artisan test` and `npm test` green, and something
the owner can actually open.

### Phase 0 — Skeleton and decisions · ~½ day

Make the fifth app exist and be reachable before anything is built inside it.

* `catalogue/index.html` + `catalogue/src/` scaffold; `@catalogue/…` alias.
* `vite.config.ts`: fifth rollup input, `/catalogue` → `/catalogue/` redirect, PWA glob.
* `public/catalogue.webmanifest`, app icon, `scripts/publish.mjs` and `scripts/serve.mjs` (port 8005),
  `.claude/launch.json` entry, `CATALOGUE_URL` in `config/app.addresses` → `GET /api/v1/apps`.
* `backend/routes/web.php` serves `/catalogue/` like the other apps. No API routes yet — an endpoint arrives in
  Phase 1 together with the service behind it, rather than as an empty shell.
* New permission group `catalogue` in **both** `Support/Permissions.php` and `pos/src/lib/permissions.ts`
  (`tests/Unit/PermissionsTest.php` fails if they drift): `catalogue.view`, `catalogue.products`,
  `catalogue.countries`, `catalogue.translations`, `catalogue.customers`, `catalogue.codes`,
  `catalogue.prices`, `catalogue.rules`, `catalogue.orders`, `catalogue.payments`, `catalogue.appearance`.
* Two new system roles from the brief's §30: **Catalogue Manager**, **Sales Manager**; Finance and Order
  manager duties fold into the existing Manager plus per-person grants, which this RBAC already supports.

**Done when:** `/catalogue/` opens a branded shell, installs as an app, and both test suites pass.

> **Built.** The app renders in ivory, charcoal and gold on the existing design system, mirrors correctly in RTL, and
> carries no price anywhere (a test asserts it). The two roles appear on a shop that is already open through
> `2026_11_20_100001_upgrade_system_roles_for_catalogue`, which only ever adds and is safe to run twice.

### Phase 1 — Foundation: identity, geography, access codes · ~2 days

Backend first, tests first. Nothing customer-facing yet.

New tables:

* `catalogue_languages` — `code` (pk), `name`, `native`, `rtl`, `enabled`, `sort`
* `catalogue_countries` — `id`, `name` json, `iso2`, `language_code`, `enabled`, `sort`,
  `min_order_cents`, timestamps
* `catalogue_translations` — `language_code`, `key`, `value`; unique pair. UI strings, seeded from files
* `catalogue_product_translations` — `product_id`, `language_code`, `display_name`, `description`,
  `notes` json; all optional, falling back to `products.name` / `.description`
* `wholesale_customers` — `id`, `business_name`, `contact_person`, `email`, `phone`, `whatsapp`,
  `country_id`, `address`, `status`, `notes`, `pos_customer_id` (nullable link to the existing
  `customers` table), `orders_count`, `orders_value_cents`, timestamps
* `wholesale_access_codes` — `id`, `customer_id`, `fingerprint` (HMAC, unique), `hash` (bcrypt),
  `display` (e.g. `LAT-••••3K7Q`), `country_id` nullable, `active`, `expires_at`, `revoked_at`,
  `uses`, `last_used_at`
* `wholesale_customer_sessions` — Sanctum personal access tokens on the customer model with a
  `wholesale` ability; one row per unlock, revocable from admin

Services: `Catalogue\CountryService`, `Catalogue\TranslationService`, `Catalogue\CustomerService`,
`Catalogue\AccessCodeService` (cryptographically random `LAT-XXXXXXXX`, shown once at generation and never
again), `Catalogue\Inventory` (the stock port of §1.1).

Rate limiting on code verification: per address and per code, on top of the existing throttle conventions.

**Tests:** valid code · unknown code · expired · revoked · inactive customer · wrong country ·
brute-force lockout · a code grants no admin reach and sees no other customer's data.

**Done when:** the brief's §44 Scenario 11 passes — a country added with a language and prices becomes
available with no code change.

> **Built.** Six tables, seven models, five services, 23 endpoints, 37 tests. Two things turned out differently and
> better than planned, both for safety:
>
> * **A buyer's session is not a Sanctum token.** It is an opaque token in `wholesale_sessions` behind a `wholesale`
>   middleware of its own. Sharing Sanctum would have put buyers and staff on one guard, where a buyer's token
>   reaching a staff route would resolve to a `WholesaleCustomer` where a `User` was expected — a 500, not a 403.
>   Apart, a buyer's token simply is not a token (`401`), and a staff token is not a session. A test walks a buyer's
>   token over eight staff endpoints to prove it.
> * **The default country is a column, not a setting.** `SettingsService::update` requires `settings.edit`, which is
>   Super-Admin-only, so a Catalogue Manager could never have set it. `catalogue_countries.is_default` keeps the
>   choice next to the thing it describes, and the service keeps exactly one.
>
> Also worth knowing: country names are translated per language in one JSON column, like `products.name`; the
> catalogue's own words fall back to English so a half-translated language still reads; and the seed migration
> brings English, Arabic and Kurdish Sorani switched on (the three the system already speaks), Badini, Turkish,
> German and French ready to be switched on, and Iraq as the first country.

### Phase 2 — Pricing and the wholesale rules engine · ~2 days

Pure backend, the most test-heavy phase. This is where money correctness is decided.

New tables:

* `catalogue_country_prices` — `country_id`, `variant_id`, `price_cents`; unique pair
* `catalogue_customer_prices` — `customer_id`, `variant_id`, `price_cents` **or** `percent_off`,
  `valid_from`, `valid_to`
* `catalogue_customer_discounts` — `customer_id`, `percent_off`, `valid_from`, `valid_to`
* `catalogue_price_history` — who changed which price, from what to what, when
* `catalogue_order_rules` — `scope` (`global` | `country` | `category`), `scope_id`, `min_order_cents`,
  `min_qty`, `qty_increment`, `enabled`
* `catalogue_rule_exemptions` — `customer_id`, which rule, enabled

`App\Support\CataloguePricing` — the single place catalogue money maths lives, in the spirit of the
existing `Support/Pricing.php`. Deterministic resolution, no stacking, never negative:

1. an active customer × variant price override
2. an active customer-wide or customer × variant percentage discount
3. the country price for the customer's authorised country
4. `variants.wholesale_usd_cents` (the delegate list — D2)
5. otherwise **unpriced**: visible, not orderable, and listed for the admin to fill in

Rule validation runs twice — in the catalogue for instant feedback, and again in the service before an order
is created. The server is authoritative; a modified browser request cannot get under a minimum.

**Tests:** the brief's §40 pricing block in full, plus every rule branch, plus "an unauthorised request
never receives a price field at all".

**Done when:** §44 Scenarios 2, 3 and 4 pass at the API level.

> **Built.** Six tables, two dependency-free support classes, two services, 13 endpoints, 53 tests (31 of them pure
> arithmetic with no database at all). Three decisions worth recording:
>
> * **The country's smallest order stays on the country**, where Phase 1 put it. `catalogue_order_rules` could have
>   carried a `country` scope too, but then "what is Turkey's minimum" would have had two answers. The general rule
>   only fills in where a country has not set one.
> * **Percentages are basis points**, not decimals — 17.5 % is `1750`. Money is already integer cents for the same
>   reason, and a `decimal(5,2)` coming back from PostgreSQL as a string was a bug waiting to happen.
> * **A rule for a category replaces the general one, it does not stack.** "At least 6 bottles, except oud, which
>   goes in 2s" is what a shop means; adding the two together is not.
>
> Also: a smallest quantity that is not a whole number of steps is refused when the rule is saved, because "at least
> 7, in steps of 6" can never be satisfied. A size priced nowhere is left out of a buyer's list rather than shown at
> zero. And `out_of_stock` names the perfume but never the number on the shelf.

### Phase 3 — Admin screens · ~3 days

Inside the existing `admin/` app, which already has sign-in, the shell, permissions and the house UI kit.
New sections:

* **Countries & languages** — add, enable, order, assign a language, set the default, set minimum orders
* **Translations** — edit UI strings per language, with a completeness indicator and a missing-keys list;
  never auto-translate product copy
* **Wholesale customers** — searchable list, profile, status, country, notes, exemptions, orders, payments
* **Access codes** — generate (shown once), assign, deactivate, revoke, regenerate, expiry, country
  restriction, usage
* **Country prices** — a grid per country (the Product-sheet pattern), bulk edit, Excel out and back in by
  SKU using the existing `xlsx.ts`, a "missing prices" filter, price history
* **Customer prices** — overrides and discounts per customer with validity dates
* **Order rules** — minimums, increments, per-country and per-category, each switchable
* **Catalogue appearance** — logo, favicon, hero media, headlines, featured collections and products,
  banners, footer, contacts, WhatsApp number, brand colours; sections reorderable and switchable, with the
  live phone preview the Customer-menu screen already does so well
* **Product enrichment** — extra photographs, per-language copy, fragrance notes, collections, featured,
  minimum quantity; POS-owned fields clearly marked as read-only here

**Done when:** everything the brief's §43 lists is editable by the owner with no developer involved.

> **Built, with two pieces moved to Phase 4.** Admin panel → **Wholesale catalogue** (`/admin/#/wholesale`), five
> tabs behind the permissions each needs: Countries (and languages), Words, Wholesale customers (with their access
> codes and agreed prices), Prices, and Order rules. 17 screen tests, and driven by hand against a live server.
>
> **Catalogue appearance and product enrichment move to Phase 4.** Both configure a catalogue that does not exist
> yet: appearance styles a homepage with no sections, and product enrichment writes photographs and per-language
> copy for product pages nobody can open. Both need their own backend (homepage sections, collections, extra
> images), and building that against an imaginary front end is how you get settings nothing reads. They are listed
> in Phase 4 below, next to the screens they feed.
>
> Worth recording:
>
> * **The shared `Switch` and `Checkbox` draw no visible text** — their `label` is an aria-label, because they were
>   built for the permissions matrix where the row already says what the tick means. On a settings card that leaves
>   unlabelled controls, so `catalogue/Setting.tsx` pairs each with words (`aria-hidden`, since the control already
>   announces itself).
> * **The i18n completeness test did not scan `admin/src`** — only `pos/src` and `delegate/src`. Every admin key
>   ever written was unguarded. It scans the admin panel now, and caught two bad keys in this phase's own code on
>   the first run. No pre-existing screen was missing one.
> * A price grid that read **Z–A**: Laravel's `sortBy([['name', false]])` takes the `false` as *descending*.

### Phase 4 — The luxury catalogue · ~4 days

The customer-facing app. Editorial magazine meets modern B2B.

Welcome screen → country selection (searchable, from the database) → homepage (hero, featured collections,
shop by category, featured perfumes, new arrivals, brand story, how wholesale works, footer) → category and
collection pages → product grid → product detail (gallery, notes, sizes, availability, minimum quantity) →
search and filters → **Unlock wholesale prices** → personalised prices → favourites → cart.

Carried over from Phase 3, because each configures something that only exists once this phase does:

* **Catalogue appearance** — logo, favicon, hero media, headlines, featured collections and products, banners,
  footer, contacts, WhatsApp number, brand colours; sections reorderable and switchable, with the live phone
  preview the Customer-menu screen already does well. Needs its own backend (homepage sections, banners, brand
  settings) alongside the homepage it styles.
* **Product enrichment** — extra photographs, per-language copy, fragrance notes, collections, featured, minimum
  quantity, with the POS-owned fields clearly read-only. Needs `collections` and `product_images`, built with the
  product pages that show them. `catalogue_product_translations` is already there from Phase 1.

* Design: warm ivory, deep charcoal, muted gold; Playfair Display headings, Poppins interface, Tajawal for
  Arabic — all already installed. Every colour and font a CSS variable, replaceable from the admin
  appearance settings, and marked provisional until the official brand kit arrives.
* Availability shows **In Stock / Out of Stock** only — never a quantity.
* Before unlocking, prices are not in the payload at all.
* RTL for Arabic and Kurdish via logical CSS properties; `prefers-reduced-motion` respected; mobile first.

**Done when:** §44 Scenarios 1 and 12 pass on a real phone, tablet and desktop.

> **Built, except the two pieces carried over.** The catalogue runs at `/catalogue/`: welcome → country → homepage
> → browse with filters and search → a perfume → unlock → this buyer's own prices → favourites → a basket the
> server prices and checks. 36 front-end tests, driven by hand on desktop, at 375 px and in RTL.
>
> **The guarantee, and how it is kept.** Two endpoints, deliberately apart. `GET /wholesale/products` is public
> and **has no price field built into it at all** — a test greps the reply for "price", "cost", "wholesale" and
> "cents" and fails if any appears. Prices come from `GET /wholesale/prices` behind the session middleware, and
> the browser joins the two. "No code, no prices" is therefore not a filter anyone has to remember to apply.
>
> **The words are the server's.** The catalogue ships no dictionary of its own: `GET /wholesale/open` returns it,
> so the owner translates the catalogue from the Words tab and it reads differently the same evening.
> `catalogue/src/words.test.ts` reads `CatalogueStrings.php`, scans the catalogue for every `t('cat.…')` plus the
> keys built from a server code or a database column, and fails listing anything the server does not ship.
>
> Three things the browser caught that no test had: an unlocked buyer was still told to "unlock wholesale prices"
> on a perfume the shop had never priced (it now says *Price on request*); "1 perfumes"; and a notes heading that
> read "TOP", from a `.replace()` of mine that chopped "Top notes" at the first space.
>
> Still carried: **catalogue appearance** and **product enrichment**, with the homepage sections, collections and
> extra images they need. The homepage is today built from what the POS already knows — featured, new, categories,
> the shop's own photographs — which is honest but not yet arrangeable. *(Built after Phase 5; see below.)*

### The two carried pieces — appearance and product enrichment · ~1½ days

The last of the brief's §43 list, built after Phase 5 because the pages they configure had to exist first.

**Done when:** the owner can recolour the catalogue, write its headline, put up an opening picture, reorder and
switch off homepage sections, group perfumes into collections, and hide, feature, photograph and describe a
perfume for buyers abroad — without a developer, and without any of it reaching the till.

> **Built.** Five tables, two services, 14 endpoints, 19 backend tests; two admin tabs (**Perfumes** and
> **How it looks**) and 7 more catalogue front-end tests.
>
> **The line, drawn in a test.** `catalogue_product_settings`, `catalogue_product_images`,
> `catalogue_product_translations`, `catalogue_collections` and `catalogue_settings` are all beside `products`,
> never inside it. The test that matters takes a snapshot of the whole product row, runs every write this feature
> has — hidden, featured, photographed, described, collected — and asserts the row is byte-for-byte what it was:
> *the POS owns the perfume; the catalogue owns how it is shown.* So hiding a perfume from buyers in Türkiye
> leaves it on sale at the till, and renaming it in Products changes it in all five apps at once.
>
> **The homepage is a list, not a layout.** `homepage.sections` is `[{key,on}]` in the owner's order; the server
> sends only the ones switched on, and the catalogue draws exactly that list in exactly that order. Moving
> "Collections" above "Featured" in the admin panel moves it on the real page, with no build and no deploy. A
> section key this build cannot draw is dropped by the server, and one left out of a save is put back switched
> off, so the list is always whole.
>
> **Provisional, and it says so.** The three colours and the wordmark that ship are this system's house theme, not
> Lattafa's own kit, which nobody has supplied. `brand.provisional` ships true and the catalogue's footer states
> plainly that the colours and wordmark are a placeholder; the owner turns it off when the real kit is loaded in.
> The colours reach the page as CSS custom properties on `<html>` — everything beyond the three is mixed from them
> in CSS with `color-mix`, so one save recolours every screen and no second stylesheet exists to drift.
>
> **Collections are editorial, and self-emptying.** A collection lists only perfumes the catalogue is currently
> showing, so hiding one empties it out of every collection at once rather than leaving a card that leads
> nowhere, and a collection with nothing left in it is not sent to a visitor at all.
>
> Three things the browser caught that no test had: a collection card whose name was crushed to "Oud …" by the
> badge beside it; the chosen rows in the "choose perfumes" dialog, which used `bg-gold-soft` — a light colour
> whatever the theme — and so were invisible on a dark screen; and, outside this work, `backend/public/storage`
> still pointing at the folder this project had before it was moved, which 404s every photograph it serves.

### Phase 5 — Orders, reservations, approval, payments · ~4 days

The heart of it.

New tables: `wholesale_orders`, `wholesale_order_items` (unit price frozen at creation),
`wholesale_order_status_history`, `wholesale_reservations`, `wholesale_reservation_items`,
`wholesale_order_idempotency`, `wholesale_payments`, `wholesale_payment_events`.

* **Order states:** `DRAFT → PENDING_APPROVAL → APPROVAL_PROCESSING → APPROVED | REJECTED | CANCELLED`,
  plus a recoverable `INTEGRATION_ERROR`. **Reservation states:** `ACTIVE | CONSUMED | RELEASED | ERROR`.
* **Effective stock** = `stock.qty` − active reservations, computed in one place in `Catalogue\Inventory`,
  so it can never be subtracted twice.
* **Submitting an order** checks effective stock, freezes prices, creates the order and its reservations
  **in one transaction** with the stock rows locked. An idempotency key makes a repeated submit return the
  same order instead of a second one.
* **Reservations never expire on their own** — ever. Instead: pending-order alerts, a reservation age
  column, filters for old orders, manual release, and a reservation report.
* **Approval** deducts through `StockService::applyMovement` inside the same transaction that marks the
  reservation `CONSUMED`; a repeated approval is a no-op. **Rejection or cancellation** releases.
* **WhatsApp ordering:** the order is created and stock reserved *first*, then `wa.me` opens with the
  prefilled message in the customer's language. Opening WhatsApp is recorded as its own event
  (`whatsapp_opened_at`) and is never treated as proof the message was sent; repeat opens never reserve
  twice. Abandoned orders are listed for the admin.
* **Direct ordering** with an order confirmation page and a reference that does not expose the order to
  anyone who merely guesses a number.
* **Admin order dashboard:** list and detail, approve, reject, cancel, modify (revalidating prices,
  minimums and reservations), print, export, payment status.
* **Payments:** offline methods fully built — configurable instructions, recorded payments with references,
  partial payments, statuses `UNPAID / PENDING / PARTIAL / PAID / FAILED / REFUNDED`, independent of the
  approval state. Online card payment is a port with no provider behind it (D7).
* **Notifications** through the existing `PushService` and bell: new order, awaiting approval, payment
  recorded, access-code trouble; customer-side order submitted / approved / rejected.

**Done when:** §44 Scenarios 6, 7, 8, 9 and 10 pass, including two tills and a catalogue order racing for
the last bottle.

> **Built.** Eight tables, two services, 16 endpoints, 35 backend tests and 4 more in the catalogue. The buyer's
> checkout, the shop's Orders screen, held stock, approval, refusal, and offline payments.
>
> **The one hard thing, and how it is held.** `Catalogue\Inventory::available()` is *the shelf, less what orders
> waiting for approval are holding* — subtracted in one place in the whole system, so a bottle cannot be promised
> twice or a hold forgotten. Placing an order locks the stock rows **before** working anything out and writes the
> order, its lines and its reservation in one transaction; the second of two racing buyers waits, re-reads and is
> refused. Approving deducts through `StockService::applyMovement` and consumes the hold in the same transaction,
> so the figure never flickers and a repeated approval is a no-op (a test presses it three times and checks there
> is exactly one stock movement).
>
> **Nothing expires.** No job, no sweep, no age check — a person decides, or releases the hold by hand. A test
> back-dates an order three weeks, then reads the catalogue, prices a basket and lists orders, and asserts the
> hold is still there.
>
> **Payment is its own track.** Recording money moves no stock and approves nothing; approving marks nothing paid.
> Part payments, refunds and pending-until-cleared are all real. Card payment is **refused** rather than faked —
> no provider is chosen — and `wholesale_payment_events` carries the unique `(provider, external_id)` that will
> make one safe when it is.
>
> **Opening WhatsApp is not sending.** The order is written and its stock held first; `wa.me` is opened after, and
> `whatsapp_opened_at` is recorded as its own fact. Opening it three times still leaves one order and one hold.
>
> Honest about the limit: the parallel race is proved by the row lock and the re-read, and the test that checks
> the lock is actually asked for is **skipped on SQLite**, where `lockForUpdate` compiles to nothing. It runs when
> the suite is run on PostgreSQL, which is how this project checks itself before a deploy.

### Phase 6 — Hardening, tests, deployment, documentation · ~2 days

* Concurrency tests: simultaneous orders for the last bottle; a POS sale while a reservation is held;
  repeated approval; repeated checkout.
* Localisation tests: country selection, automatic language, RTL, missing-translation fallback, USD-only.
* Payment tests: offline recording, duplicate events, failure, refund, order/payment independence.
* Security pass: rate limits, session handling, upload validation, "no price without authorisation" checked
  at the API level, audit coverage.
* Performance: image sizes, lazy loading, query counts, pagination, caching that cannot leak one customer's
  prices to another.
* Docs: `backend/docs/api.md` extended, a catalogue section in the README, an owner's guide for the new
  admin screens, and an honest note in README §4 about what is a port rather than an integration.

---

## 4 · Running total

| Phase | Work | Estimate |
|---|---|---|
| 0 | Skeleton, routes, permissions, roles | ½ day |
| 1 | Identity, geography, access codes | 2 days |
| 2 | Pricing and rules engine | 2 days |
| 3 | Admin screens | 3 days |
| 4 | The luxury catalogue | 4 days |
| 5 | Orders, reservations, approval, payments | 4 days |
| — | Appearance and product enrichment (carried from 3 → 4 → after 5) | 1½ days |
| 6 | Hardening, tests, deployment, docs | 2 days |
| | | **~19 days** |

---

## 5 · Acceptance criteria → phase

| § 44 Scenario | Phase |
|---|---|
| 1 · Public browsing | 4 |
| 2 · Wholesale access | 1 → 2 → 4 |
| 3 · Special pricing | 2 → 3 |
| 4 · Minimum orders | 2 → 5 |
| 5 · POS stock synchronisation | 1 (same database — nothing to synchronise) |
| 6 · WhatsApp checkout | 5 |
| 7 · Direct checkout | 5 |
| 8 · Approval | 5 |
| 9 · Rejection | 5 |
| 10 · Reservation duration | 5 |
| 11 · Country administration | 1 → 3 |
| 12 · Responsive luxury interface | 4 |

---

## 6 · What is blocked on someone else

Built around, not guessed at:

* **Official brand kit** — logo, colours, typography, artwork. The theme is now editable from Admin panel →
  Wholesale catalogue → **How it looks**, and the catalogue's footer says in so many words that the colours and
  wordmark are a placeholder until somebody loads the real kit in and turns that mark off. No invented Lattafa
  colours or logos.
* **Product photography** — real catalogue imagery for the perfumes. Extra photographs can be added per perfume
  from Admin panel → Wholesale catalogue → **Perfumes**; where there is none, the catalogue draws a plain
  silhouette in the product's own two colours, which is visibly a drawing. No stand-in photograph is ever
  presented as actual Lattafa inventory.
* **Payment provider** — none chosen, and the merchant jurisdiction decides which are even possible. The
  online-payment port stays empty and is documented as empty.
* **WhatsApp Business API** — not assumed to exist. Ordering uses a `wa.me` link; the notification service
  is structured so a Business API or email can be added later.
* **Translation review** — Turkish, German, French, Kurdish Badini and Sorani need a native speaker, as
  Arabic and Kurdish Sorani already do (README §4).

---

*Developed by Coda Agency — Build What's Next*
