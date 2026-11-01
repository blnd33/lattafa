<?php

namespace App\Http\Controllers\Api\V1;

use App\Exceptions\AppException;
use App\Http\Controllers\Controller;
use App\Http\Requests\SaveProductRequest;
use App\Http\Resources\Present;
use App\Services\CatalogService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ProductController extends Controller
{
    public function __construct(private CatalogService $catalog) {}

    /** Cost prices are hidden from anyone without `prices.edit` / `reports.financial`. */
    private function showCost(Request $r): bool
    {
        return $r->user()->can('prices.edit') || $r->user()->can('reports.financial');
    }

    public function index(Request $r): JsonResponse
    {
        $items = $this->catalog->list($r->user(), $r->boolean('includeInactive'));
        $cost = $this->showCost($r);

        return response()->json(['products' => $items->map(fn ($p) => Present::product($p, $cost))->values()]);
    }

    public function store(SaveProductRequest $r): JsonResponse
    {
        $p = $this->catalog->save($r->user(), $r->validated('product'), $r->validated('variants'));

        return response()->json(['product' => Present::product($p, $this->showCost($r))], 201);
    }

    public function update(SaveProductRequest $r, string $id): JsonResponse
    {
        $p = $this->catalog->save($r->user(), ['id' => $id] + $r->validated('product'), $r->validated('variants'));

        return response()->json(['product' => Present::product($p, $this->showCost($r))]);
    }

    public function destroy(Request $r, string $id): JsonResponse
    {
        return response()->json(['result' => $this->catalog->delete($r->user(), $id)]);
    }

    public function setActive(Request $r, string $id): JsonResponse
    {
        $this->catalog->setActive($r->user(), $id, $r->validate(['active' => ['required', 'boolean']])['active']);

        return response()->json(['ok' => true]);
    }

    /** Barcode / SKU lookup for the scanner. */
    public function lookup(Request $r): JsonResponse
    {
        $hit = $this->catalog->findByCode($r->user(), (string) $r->query('code', ''));
        if (! $hit) {
            throw AppException::notFound();
        }
        $hit['product']->setRelation('variants', collect([$hit['variant']]));

        return response()->json(['product' => Present::product($hit['product'], $this->showCost($r))]);
    }

    public function bulkPrice(Request $r): JsonResponse
    {
        $d = $r->validate(['mode' => ['required', 'in:pct,fixed'], 'value' => ['required', 'numeric'], 'target' => ['required', 'in:retail,wholesale,both'], 'productIds' => ['nullable', 'array'], 'productIds.*' => ['uuid']]);

        return response()->json(['updated' => $this->catalog->bulkPrice($r->user(), $d['mode'], (float) $d['value'], $d['target'], $d['productIds'] ?? null)]);
    }

    public function import(Request $r): JsonResponse
    {
        $d = $r->validate(['rows' => ['required', 'array', 'min:1', 'max:2000'], 'rows.*' => ['array']]);

        return response()->json($this->catalog->import($r->user(), $d['rows']));
    }

    /** A free in-store EAN-13 for the product editor's "generate" button (tills can't pick one offline without clashing). */
    public function nextBarcode(Request $r): JsonResponse
    {
        if (! $r->user()->can('products.create') && ! $r->user()->can('products.edit')) {
            throw AppException::forbidden('products.create');
        }

        return response()->json(['barcode' => $this->catalog->nextBarcode()]);
    }

    public function brands(Request $r): JsonResponse
    {
        return response()->json(['brands' => $this->catalog->brands($r->user())]);
    }
}
