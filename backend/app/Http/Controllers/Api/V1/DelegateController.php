<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\Present;
use App\Services\DelegateService;
use App\Support\Time;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Field sales: vans, stock requests, visits and daily closings. */
class DelegateController extends Controller
{
    public function __construct(private DelegateService $delegates) {}

    private const ITEMS = ['items' => ['required', 'array', 'min:1', 'max:200'], 'items.*.variantId' => ['required', 'uuid'], 'items.*.qty' => ['required', 'integer', 'min:1', 'max:100000'], 'note' => ['nullable', 'string', 'max:500']];

    /** Manager: every delegate with today's numbers and what's waiting for them. */
    public function index(Request $r): JsonResponse
    {
        return response()->json(['delegates' => $this->delegates->overview($r->user())]);
    }

    public function van(Request $r, string $id): JsonResponse
    {
        return response()->json(['items' => $this->delegates->vanStock($r->user(), $id)]);
    }

    public function load(Request $r, string $id): JsonResponse
    {
        $d = $r->validate(self::ITEMS + ['requestId' => ['nullable', 'uuid']]);

        return response()->json($this->delegates->load($r->user(), $id, $d['items'], $d['note'] ?? '', $d['requestId'] ?? null));
    }

    public function unload(Request $r, string $id): JsonResponse
    {
        $d = $r->validate(self::ITEMS);

        return response()->json($this->delegates->unload($r->user(), $id, $d['items'], $d['note'] ?? ''));
    }

    public function requests(Request $r): JsonResponse
    {
        $status = in_array($r->query('status'), ['open', 'fulfilled', 'cancelled'], true) ? $r->query('status') : null;

        return response()->json(['requests' => $this->delegates->requests($r->user(), $status)->map(fn ($x) => Present::stockRequest($x))->values()]);
    }

    public function createRequest(Request $r): JsonResponse
    {
        $d = $r->validate(self::ITEMS + ['id' => ['nullable', 'uuid']]);

        return response()->json(['request' => Present::stockRequest($this->delegates->createRequest($r->user(), $d['items'], $d['note'] ?? '', $d['id'] ?? null))], 201);
    }

    public function cancelRequest(Request $r, string $id): JsonResponse
    {
        return response()->json(['request' => Present::stockRequest($this->delegates->cancelRequest($r->user(), $id))]);
    }

    public function visits(Request $r): JsonResponse
    {
        $from = (int) $r->query('from', Time::startOfDayMs());
        $to = (int) $r->query('to', Time::endOfDayMs());

        return response()->json(['visits' => $this->delegates->visits($r->user(), $this->uuidQuery($r, 'userId'), $from, $to)->map(fn ($v) => Present::visit($v))->values()]);
    }

    public function createVisit(Request $r): JsonResponse
    {
        $d = $r->validate([
            'id' => ['nullable', 'uuid'], 'customerId' => ['nullable', 'uuid'], 'lat' => ['nullable', 'numeric', 'between:-90,90'], 'lng' => ['nullable', 'numeric', 'between:-180,180'],
            'accuracyM' => ['nullable', 'integer', 'min:0'], 'outcome' => ['nullable', 'in:visit,sale,collection,no_sale,closed'], 'note' => ['nullable', 'string', 'max:500'],
        ]);
        $device = $r->attributes->get('device');

        return response()->json(['visit' => Present::visit($this->delegates->recordVisit($r->user(), $d, $device?->id))], 201);
    }

    /** The delegate's own day as the server sees it (before counting the cash). */
    /** Live location: a batch of points from the delegate's phone (bad points are skipped, not refused). */
    public function storeLocations(Request $r): JsonResponse
    {
        $r->validate(['points' => ['required', 'array', 'min:1', 'max:500']]);
        $device = $r->attributes->get('device');

        return response()->json(['saved' => $this->delegates->recordLocations($r->user(), (array) $r->input('points'), $device?->id)]);
    }

    /** A delegate's route on a day (default today) and where they were last seen. */
    public function locations(Request $r, string $id): JsonResponse
    {
        $day = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $r->query('day')) ? (string) $r->query('day') : Time::at(Time::nowMs())->format('Y-m-d');

        return response()->json(['points' => $this->delegates->locations($r->user(), $id, $day), 'last' => $this->delegates->lastLocation($id), 'day' => $day]);
    }

    public function figures(Request $r): JsonResponse
    {
        $day = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $r->query('day')) ? (string) $r->query('day') : Time::at(Time::nowMs())->format('Y-m-d');
        if (! $r->user()->can('delegate.close')) {
            throw \App\Exceptions\AppException::forbidden('delegate.close');
        }

        return response()->json(['figures' => $this->delegates->figures($r->user(), $day)]);
    }

    public function closings(Request $r): JsonResponse
    {
        $status = in_array($r->query('status'), ['submitted', 'approved', 'rejected'], true) ? $r->query('status') : null;

        return response()->json(['closings' => $this->delegates->closings($r->user(), $status, $this->uuidQuery($r, 'userId'))->map(fn ($c) => Present::closing($c))->values()]);
    }

    public function submitClosing(Request $r): JsonResponse
    {
        $d = $r->validate([
            'id' => ['nullable', 'uuid'], 'day' => ['nullable', 'date_format:Y-m-d'], 'countedCashIQD' => ['required', 'integer', 'min:0'], 'countedCashUSD' => ['nullable', 'numeric', 'min:0', 'max:10000000'],
            'expensesIQD' => ['nullable', 'integer', 'min:0'], 'note' => ['nullable', 'string', 'max:500'],
        ]);

        return response()->json(['closing' => Present::closing($this->delegates->submitClosing($r->user(), $d))], 201);
    }

    public function approveClosing(Request $r, string $id): JsonResponse
    {
        $d = $r->validate(['note' => ['nullable', 'string', 'max:500']]);

        return response()->json(['closing' => Present::closing($this->delegates->reviewClosing($r->user(), $id, true, $d['note'] ?? ''))]);
    }

    public function rejectClosing(Request $r, string $id): JsonResponse
    {
        $d = $r->validate(['note' => ['required', 'string', 'max:500']]);

        return response()->json(['closing' => Present::closing($this->delegates->reviewClosing($r->user(), $id, false, $d['note']))]);
    }
}
