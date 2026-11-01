<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\Present;
use App\Services\DashboardService;
use App\Services\ReportCenter;
use App\Services\ReportService;
use App\Support\Time;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ReportController extends Controller
{
    public function __construct(private ReportService $reports, private DashboardService $dashboard, private ReportCenter $center) {}

    /** Admin panel → Reports: any report in the one table shape. `?from=&to=` (ms, default today in shop time). */
    public function table(Request $r, string $type): JsonResponse
    {
        $r->validate(['from' => ['nullable', 'integer', 'min:0'], 'to' => ['nullable', 'integer', 'min:0']]);
        $from = (int) $r->query('from', Time::startOfDayMs());
        $to = (int) $r->query('to', Time::endOfDayMs());
        if ($to < $from) {
            [$from, $to] = [$to, $from];
        }

        return response()->json($this->center->run($r->user(), $type, $from, $to));
    }

    /** A delegate's commission percentage (Reports → Delegate commission). */
    public function commission(Request $r, string $id): JsonResponse
    {
        $d = $r->validate(['pct' => ['required', 'numeric', 'min:0', 'max:100']]);
        $this->center->setCommission($r->user(), $id, (float) $d['pct']);

        return response()->json(['ok' => true]);
    }

    /** The admin panel's first screen: `?period=today|week|month`. */
    public function dashboard(Request $r): JsonResponse
    {
        $r->validate(['period' => ['nullable', 'in:'.implode(',', array_keys(DashboardService::PERIODS))]]);

        return response()->json($this->dashboard->get($r->user(), (string) $r->query('period', 'today')));
    }

    public function sales(Request $r): JsonResponse
    {
        $from = (int) $r->query('from', Time::startOfDayMs());
        $to = (int) $r->query('to', Time::endOfDayMs());

        return response()->json(['report' => $this->reports->sales($r->user(), $from, $to, $this->uuidQuery($r, 'userId'))]);
    }

    public function stockValuation(Request $r): JsonResponse
    {
        return response()->json($this->reports->stockValuation($r->user()));
    }

    public function debtors(Request $r): JsonResponse
    {
        return response()->json(['customers' => $this->reports->debtors($r->user())->map(fn ($c) => Present::customer($c))->values()]);
    }
}
