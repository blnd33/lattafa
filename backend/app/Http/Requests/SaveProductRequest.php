<?php

namespace App\Http\Requests;

class SaveProductRequest extends ApiRequest
{
    public function rules(): array
    {
        return [
            'product' => ['required', 'array'],
            'product.name' => ['required', 'array'],
            'product.name.en' => ['nullable', 'string', 'max:160'],
            'product.name.ar' => ['nullable', 'string', 'max:160'],
            'product.name.ku' => ['nullable', 'string', 'max:160'],
            'product.description' => ['nullable', 'array'],
            'product.brand' => ['required', 'string', 'max:120'],
            'product.category' => ['required', 'string', 'max:40'],
            'product.gender' => ['required', 'in:men,women,unisex'],
            'product.concentration' => ['required', 'string', 'max:20'],
            'product.scentFamilies' => ['array'],
            'product.notes' => ['nullable', 'array'],
            'product.season' => ['in:all,winter,summer'],
            'product.longevity' => ['integer', 'between:1,5'],
            'product.sillage' => ['integer', 'between:1,5'],
            'product.image' => ['nullable', 'string'],
            'product.art' => ['nullable', 'array'],
            'product.showOnMenu' => ['boolean'],
            'product.featured' => ['boolean'],
            'product.isNew' => ['boolean'],
            'product.active' => ['boolean'],
            'variants' => ['required', 'array', 'min:1'],
            'variants.*.id' => ['nullable', 'uuid'],
            'variants.*.label' => ['nullable', 'string', 'max:40'], // empty = filled in from size + unit ("3.4 oz")
            'variants.*.size' => ['numeric', 'min:0', 'max:100000'],
            'variants.*.unit' => ['in:ml,oz'],
            'variants.*.ml' => ['integer', 'min:0'], // older clients: size in ml only (ignored when size + unit are sent)
            'variants.*.sku' => ['required', 'string', 'max:64'],
            'variants.*.barcode' => ['nullable', 'string', 'max:64'],
            'variants.*.costIQD' => ['integer', 'min:0'],
            'variants.*.retailIQD' => ['required', 'integer', 'min:0'],
            'variants.*.wholesaleIQD' => ['nullable', 'integer', 'min:0'],
            'variants.*.minStock' => ['integer', 'min:0'],
            'variants.*.openingStock' => ['nullable', 'integer', 'min:0'],
        ];
    }
}
