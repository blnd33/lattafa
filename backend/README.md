# Lattafa API

Laravel 13 · PHP 8.4+ · PostgreSQL · Sanctum tokens. The single source of truth for the Lattafa perfume store
(Duhok, Iraq): accounts and permissions, catalogue, stock, sales, returns, shifts, customers and the offline
sync used by the POS tills and delegate phones.

**One domain for everything** — the three web apps are built into this Laravel app's `public/` folder:

| URL | App | Source |
|---|---|---|
| `/menu/` | Public perfume menu (QR code in the shop) | `../menu` |
| `/` → `/pos/` | Store point of sale (tills, tablets) — the domain opens it; its sidebar (phones: More) and sign-in screen link to the other sections | `../pos` |
| `/delegate/` | Delegate field-sales app — a POS for the road, in the phone's browser (installable, works offline) | `../delegate` |
| `/admin/` | Admin panel for the owner and managers — any computer or tablet, signs in with username + password and is never registered as a till; dashboard, sales to check, purchasing & suppliers, expenses, and every management screen (products, stock, customers, delegates, users, settings…) | `../admin` |
| `/api/v1/…` | This API | here |

* **API reference:** [docs/api.md](docs/api.md)
* **Putting it online:** [docs/deploy.md](docs/deploy.md) — server, Nginx, HTTPS, nightly backups, restoring, updates.
* **Tests:** `php artisan test` — 163 tests, all green on SQLite and on PostgreSQL (feature tests hit the real HTTP layer
  with real tokens). On PostgreSQL: `DB_CONNECTION=pgsql DB_DATABASE=<an empty test database> … php artisan test`.
  Front end: `npm test` in the project root — 148 tests.

---

## 1 · First-time setup

### 1a · Create the PostgreSQL database (once, by you)

The application never needs PostgreSQL superuser rights. Run [`database/setup-postgres.sql`](database/setup-postgres.sql)
once as the `postgres` user — it creates a login `lattafa` and an empty database `lattafa`.

* **pgAdmin:** open the file in the Query Tool, replace `CHANGE-ME-TO-A-LONG-PASSWORD`, then run the two statements
  **one at a time** (PostgreSQL refuses `CREATE DATABASE` inside a multi-statement batch).
* **psql:** `psql -U postgres -h 127.0.0.1 -f database/setup-postgres.sql`

### 1b · Configure and migrate

```bash
cd backend
composer install
cp .env.example .env          # Windows: copy .env.example .env
php artisan key:generate
# edit .env → DB_PASSWORD=<the password you chose>, APP_URL, CORS_ALLOWED_ORIGINS
php artisan migrate --force
php artisan storage:link      # product photos are served from /storage
php artisan serve             # http://127.0.0.1:8000
```

Quick try-out **without** PostgreSQL: set `DB_CONNECTION=sqlite`, remove the `DB_HOST…DB_PASSWORD` lines and
`touch database/database.sqlite`. The schema is identical; the test-suite runs on in-memory SQLite.

### 1c · Build the web apps into `public/`

From the **project root** (one folder up), with Node 20+:

```bash
npm install
npm run build:backend         # builds /menu, /pos, /delegate and copies them into backend/public/
```

Now `php artisan serve` serves everything: http://127.0.0.1:8000/ (menu), `/pos/`, `/delegate/`. Run the build again
after every front-end change (it only replaces its own files in `public/`).

**While developing the front end** run `npm run dev` in the project root next to `php artisan serve`: Vite serves the
three apps with hot reload on http://localhost:5173/menu/, `/pos/`, `/delegate/` and forwards `/api` and `/storage` to
Laravel on :8000 — the same one-domain layout as production.

**One address per app (local):** the whole system with each app on its own port, from the project root:

```bash
node scripts/serve.mjs all             # menu :8001 · POS :8002 · delegate :8003 · admin :8004
```

| App | Address |
|---|---|
| Customer menu | http://localhost:8001 |
| Store POS | http://localhost:8002 |
| Delegate app | http://localhost:8003 |
| Admin panel | http://localhost:8004 |

(`node scripts/serve.mjs pos` starts just one; in the Claude desktop app they are the `menu`, `pos`, `delegate` and
`admin` entries of `.claude/launch.json`.) They are all this same backend and database, so a sale on the POS shows in
the admin panel and stock on the menu. Each is told where the others are (`MENU_URL`, `POS_URL`, `DELEGATE_URL`,
`ADMIN_URL` → `GET /api/v1/apps`), so the links between them go to the right address: the admin panel's sidebar opens
the POS, delegate app and menu; the POS user menu opens the admin panel and the menu. `APP_HOME` decides which app
opens at `/`. Every address is a separate origin for the browser: it keeps its own sign-in and offline copy, so a till
or delegate phone opened on a new address is connected once (Super Admin username and password, as on first setup).

### 1d · First run

There is **no default admin account**. Open the POS (or call `POST /api/v1/setup`) and the shop owner creates the
Super Admin — name, username, password (any characters, 4 to 72 — Arabic/Kurdish letters count as 2) and a 4–6 digit PIN — plus, optionally, a
13-perfume demo catalogue. That call only works once. The Super Admin then creates every other account and decides
what each role — and each individual — may do.

**Adding many products:** in the POS open **Product sheet** — an Excel-like grid, one row per size. Press Enter and the
row is added (same perfume name again = another size of it); rows can be pasted straight from Excel, with or without
their header row. SKU and barcode are generated when left empty. **Excel files:** the sheet downloads a ready template
(.xlsx with dropdown lists and a "How to fill" page) or all current products, and uploads .xlsx / .csv files back into
the grid to be checked before "Add all rows" (rows with an existing SKU update that size and add their quantity to its
stock). The Excel reading/writing is built in (`pos/src/lib/xlsx.ts`, no library) and works offline.

**Dollar price list (to shops):** admin panel → **Delegates → Prices**. The perfumes are the shop's own — one
list, one stock — and this is where each size gets the dollar price the delegate sells it to shops for. Type them in,
or take the list out as Excel and put it back (matched by SKU). The delegate's dollar bills then use that exact
price, cents and all; a size left at 0 bills as before (the dinar price at the day's rate, to the nearest 50 cents).
Set **only here**: the till cannot change these, and the shop's own dinar prices never move. Change the exchange rate
and the dinars these come to follow it by themselves, because the dollar price is the one that is stored.

**Orders from the menu:** a shop opens the customer menu, taps **Add** on the sizes it wants, writes its name and
phone, and sends. It is a request, not a sale — no price is agreed and no stock moves; the delegate makes the real
sale when he hands the goods over. Every delegate sees the waiting orders (a banner on the delegate app's Home, the
**Orders** screen, and **Orders** in the admin panel) and the **first to accept takes it** — the next one is told who
got there first. Refusing takes a short reason. The public endpoint is held to 10 orders an hour per address.

**Notifications:** the bell and counts inside the apps work out of the box. For a phone to ring with the app closed,
run `php artisan lattafa:push-keys` once on the server, paste the two lines into `.env`, `php artisan optimize`, then
each delegate turns it on in the delegate app under **More**. Without the keys everything simply carries on without push.

**Supplier invoices:** the supplier's .xlsx (الباركود · القيمة · الحسم · السعر · الكمية · المادة, plus the shop's own
"cost price in dinnar" and selling-price columns and the rate next to "Rate" in the title row) is uploaded as it is.
Free pieces (الحسم = 100%) are left out, so stock counts what was bought; the name gives the size, brand (لطافة →
Lattafa, لطافة برايد → Lattafa Pride, نيش → Niche Emarati), category and gender. Rows with no selling price, or a
perfume/mist with no size in its name, are marked red to fill in. An item already on file (same barcode, or same Arabic
name + brand + size) updates its cost and price and gets its pieces added.

**Delegates:** in the POS, *Users → New account* with the role **Delegate** and a PIN. On the delegate's phone open
`https://<your-domain>/delegate/`, tap the name and type the PIN — the first sign-in connects the phone (it gets a
code `DL1`, `DL2`…); no admin password is needed on it. The delegate then sells from the shop's stock.

**Install as an app:** all four apps have their own app icon and open full-screen, without the browser bar. On Android
(Chrome) the delegate app offers **Install** on its home screen and under *More*; the POS and admin panel under *My
account*; or use the browser menu → *Install app* / *Add to Home screen*. On iPhone: Safari → Share → *Add to Home
Screen*. Needs HTTPS (the real domain). The POS, delegate app and admin panel also keep their screens cached, so they open
fast; the POS and delegate app keep working with no signal. The customer menu can be added too, but keeps no offline copy.

---

## 2 · How it is built

```
app/
  Http/Controllers/Api/V1/   thin: validate → call a service → present JSON
  Http/Requests/             shape validation only (authorisation lives in the services)
  Http/Resources/Present.php camelCase JSON, identical to pos/src/data/types.ts
  Http/Middleware/           perm:<permission>, device (identifies the till)
  Services/                  ALL business rules — every service checks permissions itself
  Support/Pricing.php        the one place bill maths lives (1:1 port of pos/src/lib/pricing.ts)
  Support/Permissions.php    permission catalogue + role maths (1:1 port of pos/src/lib/permissions.ts)
  Models/                    Eloquent, UUID primary keys
database/migrations/         PostgreSQL-first schema
tests/                       Feature (HTTP) + Unit (pricing, permissions)
```

**Rules that never bend**

| Rule | Where it is enforced |
|---|---|
| Stock changes only through `StockService::applyMovement` (row-locked, one `stock_movements` row per change, so any balance can be explained) | `Services/StockService.php` |
| Bill maths only in `Pricing` — the server recomputes every online sale; a client can't tell it a price or total | `SaleService::checkout` |
| A sale, its stock movements, customer balance/points, and audit row commit **together or not at all** | DB transaction in `SaleService` |
| A paid offline sale is **never rejected** for business reasons — oddities are stored as review flags instead | `SaleService::recordFromClient` |
| Every record a till creates has its own UUID → re-sending a batch can never create duplicates | `sync/push` |
| Cost prices are hidden from anyone without `prices.edit` / `reports.financial` | `Present::product/sale` |
| Money is whole IQD (`bigint`); USD tender is `decimal(12,2)`; timestamps are epoch-milliseconds | migrations |

### Accounts, roles and permissions (custom RBAC)

* A **role** holds a list of permission strings (`*` = everything). A person's effective permissions =
  **role ∪ personal grants − personal denies**. The Super Admin always keeps `*`.
* Five built-in roles: Super Admin, Manager, Cashier, Stock Keeper, Delegate. The Super Admin can create custom roles
  and give any individual extra permissions or take some away.
* Some things are **Super-Admin-only whatever a role says**: `roles.manage`, `users.delete`, `devices.manage`,
  `backup.manage`, `settings.edit`. A Manager can create cashiers but can't mint a Super Admin or hand out grants.
* **A watch-only account:** a custom role holding just `audit.view` (app: admin) sees one screen — **Activity**, what
  happened and who did it — and nothing else. The log's details column holds the figures that changed, so it is shown
  only to someone who may see the shop's money (`reports.financial` or `prices.edit`); everything else the account
  might ask the server for comes back `403`. Useful for watching the shop without seeing prices, sales or customers.
* Guard rails: you can't delete or disable yourself or the last Super Admin; built-in roles can't be edited/deleted;
  a role in use can't be deleted; a user with sales history is deactivated, never deleted.
* **Supervisor approval:** a cashier needing a discount above their limit / a large refund / a void asks a supervisor to
  type their PIN (`POST /auth/approve`) — the server checks that PIN belongs to an active person who really holds the
  permission, and records who approved. PIN guessing through this endpoint is rate-limited.
* **PINs** are unique per person (HMAC fingerprint + bcrypt hash), so a PIN alone identifies an approver. Five wrong
  PINs lock the account for a minute (configurable).
* **Devices:** every till and delegate phone is open: it shows the names, and the first good PIN (or password) sign-in
  on it connects it (`ST1`, `DL1`…) — a device is only added once someone really signed in. Revoking a device kills
  every token issued to it and keeps it out. Guessing is slowed twice: 5 wrong tries lock that person for a while, and
  15 wrong sign-ins from one internet address in an hour make that address wait.

> Deviation from the original brief: the brief suggested `spatie/laravel-permission`. Permissions here are a small
> purpose-built layer instead, because the POS needs the *same* rules offline (a 1:1 port, kept honest by
> `tests/Unit/PermissionsTest.php`, which fails if the two catalogues ever drift apart), plus per-person grants/denies,
> discount/refund limits and PIN approvals that Spatie doesn't model.

### Field sales (delegates)

* The delegate app is a **POS for the road**: a grid of every perfume the shop has (how many are left), tap to add to the
  bill, then **"Where did you sell?"** — pick the shop (nearest first when the phone has GPS) or add a new one on the
  spot, or "not a shop" with a note of the place — choose cash / debt / partly paid, and finish. The phone's position is
  saved with the sale.
* Delegates sell **the shop's own stock** (no van): every sale takes the bottles off the shop's shelf, and the phone
  refreshes the stock each time it syncs. A sale can't go over what the phone last saw; if two sellers sold the same
  last bottle meanwhile, the server still records it and flags it for a manager.
* **Dollars or dinars:** each bill is shown and paid in USD (the default) or IQD at the shop's rate (Settings → currency).
  On a dollar bill each bottle is its price converted and rounded to 50 cents (36,000 IQD at 1,460 = $24.50), and the
  bill to 50 cents after a discount. Debts always stay in IQD. Debt payments can be taken in dollars too; the dollar
  notes handed over are kept with the payment.
* The owner sees every delegate sale under **Delegates → Sales** (by day: shop, place, what, $ amount, map link) and in
  **Reports → Delegate sales** (any period, Excel / PDF, with a Google Maps link per sale).
* Collections, GPS check-ins (`visits`) and new customers are recorded offline and synced. (The older van tools —
  load/unload, stock requests — are still in the API but no longer used by the app.)
* **Live location:** while a delegate is signed in and the app is open, the phone sends its position (every few minutes
  or after moving ~50 m; kept on the phone when there is no signal). The owner sees "last seen" on POS → Delegates and a
  map, the day's points and the route in Google Maps on the Location tab. A web page only gets GPS while it is on
  screen and over HTTPS — locked phone = the last known place; background tracking would need a native app.
  Points are kept 60 days.
* **Daily closing:** the delegate counts their dinar notes and their dollar notes separately; the server recomputes the
  day (cash/credit sales, collections, expenses, expected cash and difference in each currency) from what was synced,
  and a manager approves it or sends it back with a note.

### Offline sync

```
till ── POST /sync/push  {items:[{entity,id,data}]}  ──►  results per item: ok | duplicate | retry | rejected | error
till ◄─ GET  /sync/pull?since=<serverTime>            ──   settings, roles, users, changed products+stock, customers, deletions
```

Push first, then pull. Entities: `sale`, `return`, `shift`, `collection`, `customer`, `stock_movement`, and from
delegate phones `visit`, `stock_request`, `closing`. A delegate's pull carries the shop's stock (with the products) and their closings.
`retry` means "not yet" (a return that arrived before its sale). Sale anomalies — stock gone negative, a price that
changed while offline, a total that doesn't add up, a discount over the cashier's limit, a credit limit exceeded, an
unknown cashier — are kept as `flags` and surface on `GET /sales/review` for an admin. Pull re-sends a 3-second overlap
so an edit made in the same second as the previous pull can't be missed.

---

### Admin panel (`/admin/`)

All planned steps are built: sign-in, the dashboard, "Sales to check" (flagged offline
sales, explained, marked as checked) and the management screens — products, product sheet, stock, customers,
delegates, sales, reports, users & roles (devices), activity, settings, my account. These are the POS's own
screens running against the server, with the till-only parts left out (selling, returns, the till's local backup).
Also built: **Purchasing** (suppliers in USD or IQD, purchase orders, receiving into stock — which sets each size's
cost price — supplier statements and payments) and **Expenses** (by month and category, dollars or dinars).
And **Reports**: 14 reports (sales by day/product/brand/category/seller, delegate sales, profit & loss, expenses, delegate commission,
debt aging, stock value, slow sellers, deliveries, shifts) for any period, each exported to Excel (built in, no
library) or to a branded A4 page for printing / “Save as PDF”.
And **Customer menu**: which perfumes guests see, featured / new, their order (drag, arrows or automatic), whether
prices and sold-out perfumes show, the WhatsApp number orders go to, and photos/videos behind the top of the menu
(uploaded in 2 MB pieces, taking turns, darkened as chosen) — with a live phone preview of the real menu that follows
every change before it is saved.

## 3 · Running it online

The full step-by-step is in **[docs/deploy.md](docs/deploy.md)**. In short:

* PHP **8.4+** (the locked libraries need it), PostgreSQL, Nginx, **HTTPS** (phones only allow GPS and "install app"
  on https). Start from [`.env.production.example`](.env.production.example): `APP_DEBUG=false`, daily log files,
  the real `APP_URL` (product photos are linked from it). Never change `APP_KEY` once the shop has started.
* Every Laravel response carries browser safety headers (`app/Http/Middleware/SecurityHeaders.php`); the guide adds the
  same ones in Nginx for the files it serves itself. Behind Cloudflare or another proxy set `TRUSTED_PROXIES`.
* **Backups:** `php artisan lattafa:backup` saves a full copy of the database (`pg_dump` → `storage/app/backups`,
  14 days kept) and runs every night at 03:00 through the scheduler (one cron line). Copy the backups off the server.
* **Locked out:** `php artisan lattafa:reset-admin` sets a new Super Admin password/PIN from the server.
* `/up` answers when the system runs, for an uptime monitor. `APP_TIMEZONE` defaults to `Asia/Baghdad`, so "today's
  sales" ends at midnight in Duhok.

## 4 · Not built yet (planned)

* A native Delegate app — not planned for now; the delegate app is a web app on the same domain.
* An embedded map of customers/visits (the delegate app links to Google Maps directions instead).
* Payments gateway (FIB / Zain Cash) and thermal-printer integration are front-end / later-phase work.
* Arabic and Kurdish (Sorani) texts are drafts — have a native speaker review them.

*Developed by Coda Agency — Build What's Next — +964 750 730 8005 — @codatechagency*
