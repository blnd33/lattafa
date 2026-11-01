<?php

namespace App\Http\Requests;

class SaveRoleRequest extends ApiRequest
{
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:80'],
            'description' => ['nullable', 'string', 'max:255'],
            'permissions' => ['present', 'array'],
            'permissions.*' => ['string'],
            'apps' => ['present', 'array'],
            'apps.*' => ['in:pos,admin,delegate'],
        ];
    }
}
