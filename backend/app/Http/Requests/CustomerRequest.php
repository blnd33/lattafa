<?php

namespace App\Http\Requests;

class CustomerRequest extends ApiRequest
{
    public function rules(): array
    {
        return [
            'clientId' => ['nullable', 'uuid'],
            'name' => ['required', 'string', 'max:160'],
            'phone' => ['nullable', 'string', 'max:40'],
            'type' => ['nullable', 'in:retail,shop,wholesale'],
            'city' => ['nullable', 'string', 'max:80'],
            'notes' => ['nullable', 'string', 'max:500'],
            'creditLimitIQD' => ['nullable', 'integer', 'min:0'],
            'lat' => ['nullable', 'numeric', 'between:-90,90'],
            'lng' => ['nullable', 'numeric', 'between:-180,180'],
        ];
    }
}
