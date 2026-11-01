<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Services\MenuMedia;
use App\Services\MenuService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The public perfume menu (the QR code in the shop) and, for the admin panel, arranging it.
 * The public part needs no sign-in and only carries what a customer may see — see MenuService.
 */
class MenuController extends Controller
{
    public function __construct(private MenuService $menu, private MenuMedia $media) {}

    public function index(): JsonResponse
    {
        return response()->json($this->menu->public())->header('Cache-Control', 'public, max-age=60');
    }

    /** Admin panel → Customer menu: every perfume with its menu switches and place, plus the menu settings. */
    public function manage(Request $r): JsonResponse
    {
        return response()->json($this->menu->manage($r->user()));
    }

    public function arrange(Request $r): JsonResponse
    {
        $d = $r->validate([
            'products' => ['present', 'array', 'max:5000'],
            'products.*.id' => ['required', 'uuid'],
            'products.*.showOnMenu' => ['required', 'boolean'],
            'products.*.featured' => ['required', 'boolean'],
            'products.*.isNew' => ['required', 'boolean'],
            'order' => ['nullable', 'array', 'max:5000'],
            'order.*' => ['uuid', 'distinct'],
            'autoOrder' => ['boolean'],
            'settings' => ['nullable', 'array'],
            'settings.showPrices' => ['boolean'],
            'settings.hideSoldOut' => ['boolean'],
            'settings.whatsapp' => ['nullable', 'string', 'max:30', 'regex:/^[0-9+\s()-]*$/'],
            'settings.heroDim' => ['integer', 'between:0,85'],
        ]);
        $auto = (bool) ($d['autoOrder'] ?? false);

        return response()->json($this->menu->arrange($r->user(), $d['products'], $auto ? null : ($d['order'] ?? null), $auto, $d['settings'] ?? null));
    }

    /* ── photos/videos behind the top of the menu: uploaded in pieces (see MenuMedia) ── */

    public function startMedia(Request $r): JsonResponse
    {
        $d = $r->validate(['mime' => ['required', 'string', 'max:40'], 'size' => ['required', 'integer', 'min:1']]);

        return response()->json($this->media->start($r->user(), $d['mime'], (int) $d['size']), 201);
    }

    /** One piece as the raw request body; `?at=` = where it goes (what the server already has). */
    public function mediaPart(Request $r, string $id): JsonResponse
    {
        $r->validate(['at' => ['required', 'integer', 'min:0']]);

        return response()->json(['received' => $this->media->append($r->user(), $id, (int) $r->query('at'), $r->getContent(true))]);
    }

    public function finishMedia(Request $r, string $id): JsonResponse
    {
        $d = $r->validate(['poster' => ['nullable', 'string', 'max:3000000']]);
        $this->media->finish($r->user(), $id, $d['poster'] ?? null);

        return response()->json($this->menu->manage($r->user()));
    }

    public function orderMedia(Request $r): JsonResponse
    {
        $d = $r->validate(['ids' => ['required', 'array', 'max:20'], 'ids.*' => ['uuid', 'distinct']]);
        $this->media->reorder($r->user(), $d['ids']);

        return response()->json($this->menu->manage($r->user()));
    }

    public function deleteMedia(Request $r, string $id): JsonResponse
    {
        $this->media->delete($r->user(), $id);

        return response()->json($this->menu->manage($r->user()));
    }
}
