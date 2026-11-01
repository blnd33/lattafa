<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/** Base class: authorisation is enforced by the services (permission checks), so requests only validate shape. */
abstract class ApiRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }
}
