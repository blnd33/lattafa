<?php

namespace App\Http\Requests;

class CheckoutRequest extends ApiRequest
{
    public function rules(): array
    {
        return [
            'id' => ['nullable', 'uuid'],
            'number' => ['nullable', 'string', 'max:40'],
            'lines' => ['required', 'array', 'min:1'],
            'lines.*.variantId' => ['required', 'uuid'],
            'lines.*.qty' => ['required', 'integer', 'min:1'],
            'lines.*.discountPct' => ['nullable', 'integer', 'between:0,100'],
            'customerId' => ['nullable', 'uuid'],
            'orderDiscount' => ['nullable', 'array'],
            'orderDiscount.type' => ['required_with:orderDiscount', 'in:pct,fixed'],
            'orderDiscount.value' => ['required_with:orderDiscount', 'numeric', 'min:0'],
            'giftWrap' => ['boolean'],
            'redeemPoints' => ['nullable', 'integer', 'min:0'],
            'payments' => ['required', 'array'],
            'payments.*.method' => ['required', 'in:cash_iqd,cash_usd,card,fib,zain,debt,return_credit'],
            'payments.*.tendered' => ['required', 'numeric', 'min:0'],
            'payments.*.reference' => ['nullable', 'string', 'max:120'],
            'note' => ['nullable', 'string', 'max:500'],
            'approvedBy' => ['nullable', 'array'],
            'approvedBy.id' => ['required_with:approvedBy', 'uuid'],
            'returnCreditIQD' => ['nullable', 'integer', 'min:0'],
        ];
    }
}
