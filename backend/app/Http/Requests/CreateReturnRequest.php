<?php

namespace App\Http\Requests;

class CreateReturnRequest extends ApiRequest
{
    public function rules(): array
    {
        return [
            'saleId' => ['required', 'uuid'],
            'lines' => ['required', 'array', 'min:1'],
            'lines.*.saleItemIndex' => ['required', 'integer', 'min:0'],
            'lines.*.qty' => ['required', 'integer', 'min:0'],
            'lines.*.restock' => ['nullable', 'boolean'],
            'lines.*.reason' => ['nullable', 'string', 'max:255'],
            'refundMethod' => ['required', 'in:cash_iqd,card,fib,zain,store_credit,debt_reduction'],
            'note' => ['nullable', 'string', 'max:500'],
            'approvedBy' => ['nullable', 'array'],
            'approvedBy.id' => ['required_with:approvedBy', 'uuid'],
        ];
    }
}
