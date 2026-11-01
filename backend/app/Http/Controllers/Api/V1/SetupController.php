<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\SetupRequest;
use App\Http\Resources\Present;
use App\Models\User;
use App\Services\AuthService;
use App\Services\SettingsService;
use App\Services\SetupService;
use Illuminate\Http\JsonResponse;

class SetupController extends Controller
{
    public function status(SettingsService $settings): JsonResponse
    {
        return response()->json(['setupDone' => $settings->isSetupDone() || User::count() > 0]);
    }

    /** First-run only: creates the Super Admin, settings and (optionally) demo data, then signs the owner in. */
    public function run(SetupRequest $r, SetupService $setup): JsonResponse
    {
        $out = $setup->run($r->validated());
        $token = $out['user']->createToken(AuthService::tokenName($out['device']), ['*'], now()->addDays(30))->plainTextToken;

        return response()->json(['token' => $token, 'user' => Present::actor($out['user']), 'device' => $out['device'] ? Present::device($out['device']) : null], 201);
    }
}
