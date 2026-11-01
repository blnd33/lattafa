# Putting Lattafa online — step by step

For whoever sets up the server. The result: one domain (`https://<your-domain>`) serving the menu (`/`), the POS
(`/pos/`), the delegate app (`/delegate/`), the admin panel (`/admin/`) and the API (`/api/v1`). Takes about an hour on
a fresh server.

The code is ready: every test passes on PostgreSQL (`php artisan test` with `DB_CONNECTION=pgsql`), including a real
`pg_dump` backup that was restored into an empty database.

---

## 0 · What to buy

| | Needed | Notes |
|---|---|---|
| Server | A small VPS: 1–2 CPU, 2 GB RAM, 20 GB disk, **Ubuntu 24.04** | Hetzner, DigitalOcean, Vultr, Contabo… about $5–10 a month. Turn on the provider's **automatic backups** too (a few $ more). |
| Domain | Any, e.g. `lattafa-duhok.com` | Point its **A record** at the server's IP address. |
| HTTPS | Free (Let's Encrypt, step 6) | **Required:** phones only allow GPS, offline mode and "install app" on https. |

The server needs **PHP 8.4 or newer** (the installed libraries require it; Ubuntu 24.04's own PHP is 8.3, so step 1
adds a newer one) and **PostgreSQL**. Shared hosting (cPanel) only works if it offers PHP 8.4+ with PostgreSQL, SSH
access and cron jobs; most offer only MySQL, which this system does not use. A VPS is simpler.

## 1 · Install the programs (as root)

```bash
apt update && apt upgrade -y
apt install -y software-properties-common
add-apt-repository -y ppa:ondrej/php          # the usual source of newer PHP versions for Ubuntu
apt update
apt install -y nginx postgresql unzip \
  php8.4-fpm php8.4-cli php8.4-pgsql php8.4-mbstring php8.4-xml php8.4-curl php8.4-zip php8.4-bcmath php8.4-intl
curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer
php -v                                          # must say 8.4 (or newer)
```

## 2 · Copy the system to the server

On the **office PC**, in the project folder, build the four web apps into `backend/public/`:

```bash
npm ci
npm run build:backend
```

Then copy the **`backend` folder** to `/var/www/lattafa/backend` on the server (WinSCP, FileZilla over SFTP, or `scp`).
**Leave these out**: `backend/.env`, `backend/vendor/`, `backend/database/database.sqlite` (the office test data: demo
products and test accounts), `backend/storage/logs/*`, and **`backend/public/storage`**. That last one is a Windows
shortcut (junction) to the office PC's photo folder; copied over, it becomes a plain folder, `php artisan storage:link`
in step 4 then says "already exists" and every product photo and menu photo is broken. If it got copied anyway:
`rm -rf public/storage && php artisan storage:link`.

## 3 · Create the database

On the server, open `database/setup-postgres.sql`, put your own long password in place of
`CHANGE-ME-TO-A-LONG-PASSWORD`, and run it:

```bash
cd /var/www/lattafa/backend
nano database/setup-postgres.sql
sudo -u postgres psql -f database/setup-postgres.sql
```

Then put the password back as the placeholder (or delete the file): it should not stay on the server.

## 4 · Configure

```bash
cd /var/www/lattafa/backend
composer install --no-dev --optimize-autoloader
cp .env.production.example .env
nano .env                       # fill in APP_URL=https://<your-domain> and DB_PASSWORD (the one from step 3)
php artisan key:generate        # ONCE. Then copy the APP_KEY line from .env somewhere safe (see "Backups")
php artisan migrate --force
php artisan storage:link
php artisan optimize
chown -R www-data:www-data storage bootstrap/cache
```

## 5 · Nginx

Create `/etc/nginx/snippets/lattafa-headers.conf`: the same browser safety headers the API sends, for the files Nginx
serves by itself:

```nginx
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "SAMEORIGIN" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(self), geolocation=(self), screen-wake-lock=(self), microphone=(), payment=()" always;
add_header Strict-Transport-Security "max-age=31536000" always;
```

Create `/etc/nginx/sites-available/lattafa`:

```nginx
server {
    listen 80;
    server_name <your-domain>;
    root /var/www/lattafa/backend/public;
    index index.html index.php;               # /pos/, /delegate/, /menu/ are folders with an index.html
    charset utf-8;
    client_max_body_size 20M;                 # Excel imports (up to 2,000 rows) and product photos are bigger than Nginx's 1 MB default (menu videos arrive in 2 MB pieces)

    location / {
        include snippets/lattafa-headers.conf;
        try_files $uri $uri/ /index.php?$query_string;
    }
    location = /sw.js {                       # the offline service worker must update promptly
        include snippets/lattafa-headers.conf;
        add_header Cache-Control "no-cache";
    }
    location /assets/ {                       # file names change with every build, so they can be cached for a year
        include snippets/lattafa-headers.conf;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }
    location ~ \.php$ {                       # Laravel adds the safety headers itself
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/run/php/php8.4-fpm.sock;
    }
    location ~ /\.(?!well-known) { deny all; }
}
```

```bash
ln -s /etc/nginx/sites-available/lattafa /etc/nginx/sites-enabled/
rm /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

## 6 · HTTPS

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d <your-domain> --redirect
```

Certbot renews the certificate by itself. Open `https://<your-domain>/up`: it should say the application is up.

If **Cloudflare** (or another proxy) sits in front of the server, set `TRUSTED_PROXIES=*` in `.env` and run
`php artisan optimize` again. See `config/trustedproxy.php`.

## 7 · Scheduler (the nightly backup)

```bash
crontab -u www-data -e
```

Add this line. It runs Laravel's scheduler every minute, which starts the database backup at 03:00 shop time:

```
* * * * * cd /var/www/lattafa/backend && php artisan schedule:run >> /dev/null 2>&1
```

Check it once by hand: `sudo -u www-data php artisan lattafa:backup` should print `Backup saved: … .dump`.

## 8 · First run

Open `https://<your-domain>/pos/`. The setup screen appears **once**: shop name, dollar rate, and the **Super Admin**
(owner) account. Use a strong password, not a test one. Choose **no** demo data for the real shop. Then follow
"First run", "Adding many products" and "Delegates" in the [README](../README.md).

---

## Backups

* **Every night** `lattafa:backup` writes `storage/app/backups/lattafa-<date>-<time>.dump` and keeps 14 days
  (`BACKUP_KEEP_DAYS`). A failed backup is written to `storage/logs/` and never deletes the older copies.
* The database backup does not hold **files**: product photos and the customer menu's photos/videos live in
  `storage/app/public` (the second half of the rclone line below copies them).
* **Copy them off the server.** A backup on the same server is lost with it. Turn on the hosting provider's automatic
  backups, **and** copy the files somewhere else every day, for example with [rclone](https://rclone.org) to Google
  Drive (`sudo -u www-data rclone config` once, then this cron line for `www-data`):

  ```
  30 3 * * * rclone copy /var/www/lattafa/backend/storage/app/backups gdrive:lattafa/backups && rclone copy /var/www/lattafa/backend/storage/app/public gdrive:lattafa/photos
  ```
* **Keep the `.env` file (above all `APP_KEY`) in a safe place too**, such as a password manager. Supervisor PIN
  approvals depend on that key, so restoring a backup on a new server also needs the same key.

**Restoring** a backup (it replaces everything in the database):

```bash
cd /var/www/lattafa/backend
php artisan down
pg_restore --clean --if-exists --no-owner -h 127.0.0.1 -U lattafa -d lattafa storage/app/backups/lattafa-<date>-<time>.dump
php artisan up
```

## Locked out?

If the owner forgets the Super Admin password or PIN, or locks the account, run this on the server:

```bash
cd /var/www/lattafa/backend
php artisan lattafa:reset-admin
```

It asks for a new password and/or PIN, lifts the lockout and signs that person out everywhere. Tills, delegate phones
and other staff are not affected. It shows in the activity log as "System".

## Installing an update

On the office PC: `npm run build:backend`. Copy the changed `backend` files to the server (again leaving out `.env`,
`vendor/`, `database/database.sqlite`, `storage/`, `public/storage`), then on the server:

```bash
cd /var/www/lattafa/backend
php artisan down
composer install --no-dev --optimize-autoloader
php artisan migrate --force
php artisan optimize
php artisan up
```

Tills and phones pick up the new version by themselves the next time they open the app.

## Keeping an eye on it

* `https://<your-domain>/up` answers when the system is running: add it to a free uptime monitor (e.g. UptimeRobot)
  to get an e-mail or SMS when the site is down.
* Errors are in `storage/logs/laravel-<date>.log` (kept 30 days).
