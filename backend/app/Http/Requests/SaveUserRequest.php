<?php

namespace App\Http\Requests;

class SaveUserRequest extends ApiRequest
{
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:120'],
            'username' => ['required', 'string', 'max:32'],
            'roleId' => ['required', 'uuid'],
            'active' => ['required', 'boolean'],
            'color' => ['nullable', 'string', 'max:9'],
            'pin' => ['nullable', 'string', 'max:6'],
            'password' => ['nullable', 'string', 'max:200'],
            'grants' => ['array'],
            'grants.*' => ['string'],
            'denies' => ['array'],
            'denies.*' => ['string'],
            'limits' => ['required', 'array'],
            'limits.maxDiscountPct' => ['required', 'numeric', 'between:0,100'],
            'limits.maxRefundIQD' => ['required', 'numeric', 'min:0'],
        ];
    }
}
