<?php

namespace App\Http\Requests;

class LoginRequest extends ApiRequest
{
    public function rules(): array
    {
        return [
            'username' => ['required', 'string', 'max:64'],
            'password' => ['required', 'string', 'max:200'],
            'deviceId' => ['nullable', 'uuid'],
            'app' => ['nullable', 'in:pos,delegate,admin'],
            'deviceName' => ['nullable', 'string', 'max:80'],
        ];
    }
}
