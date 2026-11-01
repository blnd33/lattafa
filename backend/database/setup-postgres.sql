-- ════════════════════════════════════════════════════════════════════════════
--  Lattafa — one-time PostgreSQL setup
--  Creates a dedicated login role and an empty database for the Laravel API.
--  The application creates all its own tables afterwards (php artisan migrate).
-- ════════════════════════════════════════════════════════════════════════════
--
--  HOW TO RUN (pick ONE way)
--
--  A) pgAdmin
--     1. Connect as the "postgres" superuser, right-click the "postgres" database → Query Tool.
--     2. Replace  CHANGE-ME-TO-A-LONG-PASSWORD  below with a password of your own (keep the quotes).
--     3. Run STEP 1 on its own:   select only the CREATE ROLE statement → press F5.
--     4. Run STEP 2 on its own:   select only the CREATE DATABASE statement → press F5.
--        (PostgreSQL refuses CREATE DATABASE when it is sent together with other statements,
--         so do not press F5 with everything selected.)
--
--  B) psql (statements are sent one by one, so the whole file works):
--        psql -U postgres -h 127.0.0.1 -f database/setup-postgres.sql
--
--  THEN
--     • open backend/.env and set   DB_CONNECTION=pgsql   and   DB_PASSWORD=<the same password>
--     • run   php artisan migrate --force     (creates every table)
--
--  Safe to re-read: nothing here touches any other database on your server.
-- ════════════════════════════════════════════════════════════════════════════


-- STEP 1 ─ the application's own login (it can only reach its own database)
CREATE ROLE lattafa WITH LOGIN PASSWORD 'CHANGE-ME-TO-A-LONG-PASSWORD' NOSUPERUSER NOCREATEDB NOCREATEROLE;


-- STEP 2 ─ the database, owned by that role
CREATE DATABASE lattafa OWNER lattafa ENCODING 'UTF8' TEMPLATE template0;
