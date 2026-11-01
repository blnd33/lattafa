<?php

namespace App\Http\Requests;

class SetupRequest extends ApiRequest
{
    public function rules(): array
    {
        return [
            'store' => ['nullable', 'array'],
            'store.name' => ['nullable', 'string', 'max:120'],
            'store.phone' => ['nullable', 'string', 'max:40'],
            'store.address' => ['nullable', 'string', 'max:255'],
            'store.city' => ['nullable', 'string', 'max:80'],
            'rate' => ['required', 'numeric', 'gt:0'],
            'admin' => ['required', 'array'],
            'admin.name' => ['required', 'string', 'max:120'],
            'admin.username' => ['required', 'string', 'max:32'],
            'admin.password' => ['required', 'string', 'max:200'],
            'admin.pin' => ['required', 'string', 'max:6'],
            'demoData' => ['boolean'],
            'deviceId' => ['nullable', 'uuid'],
            'deviceName' => ['nullable', 'string', 'max:80'],
        ];
    }
}
