<?php

namespace App\Http\Requests;

class PinLoginRequest extends ApiRequest
{
    public function rules(): array
    {
        return [
            'userId' => ['required', 'uuid'],
            'pin' => ['required', 'string', 'max:6'],
            'deviceId' => ['nullable', 'uuid'],
            'app' => ['nullable', 'in:pos,delegate'],
        ];
    }
}
