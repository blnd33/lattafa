<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Str;

abstract class Controller
{
    /**
     * A query-string filter that must be a UUID (ids are `uuid` columns; PostgreSQL rejects anything else with an
     * error instead of "no rows"). A malformed value is treated as "no filter".
     */
    protected function uuidQuery(Request $r, string $key): ?string
    {
        $v = $r->query($key);

        return is_string($v) && Str::isUuid($v) ? $v : null;
    }
}
