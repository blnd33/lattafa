<?php

use Illuminate\Support\Facades\Schedule;

/*
| Scheduled jobs. They only run when the server calls the scheduler every minute — one cron line:
|   * * * * * cd /path/to/backend && php artisan schedule:run >> /dev/null 2>&1
*/

// a full copy of the database every night (shop time); see config/backup.php
Schedule::command('lattafa:backup')->dailyAt(config('backup.daily_at'));
