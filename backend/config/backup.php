<?php

/*
| Server backups (`php artisan lattafa:backup`, run every night by the scheduler).
| A backup is a full copy of the database: PostgreSQL → pg_dump file (.dump), SQLite → a copy of the file (.sqlite).
| Copy this folder (and storage/app/public, the product photos) to another place every day: a backup that only
| lives on the same server is lost together with it.
*/

return [
    // where the backup files are written (not reachable from the web)
    'path' => env('BACKUP_PATH', storage_path('app/backups')),

    // backups older than this many days are removed after a new one succeeds
    'keep_days' => (int) env('BACKUP_KEEP_DAYS', 14),

    // the nightly run, shop time (APP_TIMEZONE)
    'daily_at' => env('BACKUP_DAILY_AT', '03:00'),

    // pg_dump program; set the full path when it is not on the PATH
    // (Windows: "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe")
    'pg_dump' => env('BACKUP_PG_DUMP', 'pg_dump'),
];
