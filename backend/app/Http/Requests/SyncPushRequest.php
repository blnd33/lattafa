<?php

namespace App\Http\Requests;

class SyncPushRequest extends ApiRequest
{
    public function rules(): array
    {
        return [
            'items' => ['required', 'array', 'min:1', 'max:200'],
            'items.*.entity' => ['required', 'string'],
            'items.*.id' => ['required', 'uuid'], // every record a till creates carries its own UUID (that is what makes retries safe)
            'items.*.data' => ['required', 'array'],
        ];
    }
}
