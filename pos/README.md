# Lattafa Store POS

Point of sale for the Lattafa perfume store (Duhok, Iraq). React 18 + TypeScript + Tailwind, **offline-first**
(IndexedDB via Dexie), installable as an app (PWA), Arabic / Kurdish (Sorani) / English with full RTL.

This is the **front end**. Everything runs in the browser against a local database, so the shop can trade today;
the Laravel backend (next phase) will sync sales, stock, prices and accounts between tills and the admin panel.

## Run it

```bash
cd pos
npm install
npm run dev        # http://localhost:5173  (also on your LAN, see below)
npm test           # 63 unit / integration tests
npm run typecheck
npm run build      # production build in dist/  (+ service worker)
npm run preview    # serve the production build
```

First launch shows a **setup wizard**: shop details → **Super Admin account** → optional demo perfumes.
There is no default password. The Super Admin then creates every other account (Users → Accounts).

## Any device

| Device | How |
|---|---|
| Shop PC / laptop | open the URL in Chrome/Edge; *Install* from the address bar for a kiosk-style window |
| Android tablet / phone | open the URL in Chrome → menu → *Install app*. Works offline afterwards |
| iPad / iPhone | Safari → Share → *Add to Home Screen* |
| Touch till (1366×768) | the selling screen is laid out for it: big buttons (≥ 44 px), persistent bill panel |
| Barcode scanner (USB / Bluetooth) | just scan — scanners act like a keyboard; no setup |
| Phone camera as scanner | camera button on the sell screen (Chrome/Edge on Android; needs https) |
| Receipt printer | print dialog → any printer the OS knows (USB, network, paired Bluetooth). Paper width 58/80 mm in Settings |
| Barcode label printer | Products → Tools → *Print barcode labels* (50×30, 40×25, 58×40 mm) |

Layout switches by width: **phone** (<768: bottom navigation, bill as a bottom sheet) → **tablet** (768–1023:
icon rail, bill as a side drawer) → **desktop** (≥1024: rail + persistent bill panel).

### Using the POS from other devices on the shop network

`npm run dev` and `npm run preview` listen on the LAN (`--host`). Open `http://<PC-IP>:5173` on the tablet.
Plain-http LAN addresses are *not* a "secure context", so the browser disables **install**, **offline service
worker** and **camera scanning** there (selling, printing, USB scanners and PIN sign-in still work — the app is
written to not need Web Crypto). For the full experience serve it over **https**:

* Nginx/Caddy with a certificate (a real domain, or a local CA such as `mkcert`), or
* a Cloudflare/Tailscale tunnel, or
* deploy the `dist/` folder to any static host.

The build uses relative paths and hash routing (`#/sell`), so `dist/` works from any folder — Nginx, a Windows
XAMPP `htdocs/pos/` sub-folder, or a USB stick — with no rewrite rules.

> Each device has its **own local database** until the backend sync exists. Use **one till per device** for now, and
> download a backup (Settings → Data) regularly.

## Accounts, roles and permissions

* **Super Admin** — full access; the only account that can manage roles, per-person permissions, devices, settings,
  backups and delete users. Cannot be edited/removed if it is the last one.
* **Manager**, **Cashier**, **Stock Keeper**, **Delegate** — built-in roles. Create *custom roles* with any mix of the
  ~50 permissions (Users → Roles), and fine-tune single people with *Allow / Deny* overrides (account → Permissions).
* Sign-in: cashiers tap their name and enter a **4–6 digit PIN**; admins may also use username + password.
  Wrong PINs lock the account for a while; the screen locks itself after inactivity (Settings → Security).
* **Supervisor approval**: over-limit discounts, big refunds, late returns and voids ask for a manager's PIN on the spot.
  The limits are per person (Users → Account → Limits).
* Every permission is enforced in the **services layer** (`src/services`), not only by hiding buttons.

## What is in it

Sell (search, filters, barcode/camera scan, sizes, line & bill discounts, gift wrap, notes, customers + loyalty points,
hold/resume, testers) · Payment (cash IQD/USD with auto change, card, FIB, Zain Cash, debt with credit limit, split
payments, exchange credit) · 58/80 mm receipts with QR + barcode and a trilingual footer · Shifts (opening float, cash
in/out, X & Z reports, denomination counter, variance) · Returns & exchanges · Void · Sales history · Customers
(statement, collect debt) · Products (3-language names, sizes, barcodes, photos, CSV import/export, bulk price change,
labels) · Inventory (levels, receive, count, movement history) · Reports · Users & roles · Devices · Activity log ·
Settings · Backup/restore · Dark mode.

## Architecture

```
src/
  data/        types.ts (domain model = future API), db.ts (Dexie), seed.ts
  lib/         pricing.ts (the ONE place bill maths lives), permissions.ts, credentials.ts, code128.ts, money.ts …
  services/    every read/write + permission check + audit + outbox (stock.ts is the ONLY stock writer)
  hooks/       TanStack Query wrappers, device / scanner / auth hooks
  store/       Zustand: session, cart (persisted), ui, toast
  components/  ui kit, layout shell, print host, approval + confirm providers
  features/    auth, setup, sell, sales, customers, shifts, products, inventory, reports, users, settings, account
  i18n/        en / ar / ku dictionaries  (a test fails if any key is missing in any language)
```

Rules that keep the money right: integer IQD everywhere; USD only as a *tender* stored with the rate used; every sale
has a client UUID and a per-device number (`ST1-000123`); a sale, its stock movements, customer balance/points and its
sync-queue row commit in **one** IndexedDB transaction; totals are recomputed at save time, never trusted from the screen.

## Next: backend

The `services/` layer is the seam. The Laravel API (`/api/v1`, Sanctum, PostgreSQL) will implement the same operations;
`services/sync.ts` already queues every sale/return/shift/collection in an outbox, ready for `POST /sync/push`
and `GET /sync/pull?since=`.

*Developed by Coda Agency — Build What's Next — +964 750 730 8005 — @codatechagency*
