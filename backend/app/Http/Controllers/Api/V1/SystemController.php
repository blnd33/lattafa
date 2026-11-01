<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\Present;
use App\Models\AuditLog;
use App\Services\DeviceService;
use App\Services\SettingsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Settings, devices and the activity log. */
class SystemController extends Controller
{
    public function __construct(private SettingsService $settings, private DeviceService $devices) {}

    public function settings(): JsonResponse
    {
        return response()->json(['settings' => $this->settings->get()]);
    }

    public function updateSettings(Request $r): JsonResponse
    {
        // Every editable setting is listed: Laravel only returns keys that have a rule, so anything not listed can't be changed
        // (and unknown keys can't sneak into the stored document).
        $d = $r->validate([
            'store' => ['array'], 'store.name' => ['string', 'max:120'], 'store.tagline' => ['nullable', 'string', 'max:160'], 'store.address' => ['nullable', 'string', 'max:255'],
            'store.phone' => ['nullable', 'string', 'max:40'], 'store.city' => ['nullable', 'string', 'max:80'],
            'receipt' => ['array'], 'receipt.header' => ['nullable', 'string', 'max:500'], 'receipt.footer' => ['array'],
            'receipt.footer.en' => ['nullable', 'string', 'max:200'], 'receipt.footer.ar' => ['nullable', 'string', 'max:200'], 'receipt.footer.ku' => ['nullable', 'string', 'max:200'],
            'receipt.showLogo' => ['boolean'], 'receipt.showQr' => ['boolean'], 'receipt.qrUrl' => ['nullable', 'string', 'max:255'], 'receipt.paperMm' => ['in:58,80'],
            'receipt.autoPrint' => ['boolean'], 'receipt.copies' => ['integer', 'between:1,5'],
            'currency' => ['array'], 'currency.rate' => ['numeric', 'gt:0'], 'currency.rounding' => ['in:0,250,500,1000'], 'currency.usdEnabled' => ['boolean'],
            'tax' => ['array'], 'tax.pct' => ['numeric', 'between:0,100'],
            'loyalty' => ['array'], 'loyalty.enabled' => ['boolean'], 'loyalty.pointsPer1000IQD' => ['numeric', 'min:0'], 'loyalty.pointValueIQD' => ['integer', 'min:0'],
            'sales' => ['array'], 'sales.requireShift' => ['boolean'], 'sales.allowNegativeStock' => ['boolean'], 'sales.giftWrapFeeIQD' => ['integer', 'min:0'],
            'sales.defaultCustomerCreditIQD' => ['integer', 'min:0'], 'sales.returnWindowDays' => ['integer', 'min:0', 'max:3650'],
            'security' => ['array'], 'security.autoLockMinutes' => ['integer', 'min:0'], 'security.maxFailedAttempts' => ['integer', 'min:3'], 'security.lockoutSeconds' => ['integer', 'min:10'],
        ]);

        return response()->json(['settings' => $this->settings->update($r->user(), $d)]);
    }

    public function devices(Request $r): JsonResponse
    {
        return response()->json(['devices' => $this->devices->list($r->user())->map(fn ($d) => Present::device($d))->values()]);
    }

    public function updateDevice(Request $r, string $id): JsonResponse
    {
        $d = $r->validate(['name' => ['required', 'string', 'max:80'], 'code' => ['required', 'string', 'max:6']]);

        return response()->json(['device' => Present::device($this->devices->update($r->user(), $id, $d['name'], $d['code']))]);
    }

    public function revokeDevice(Request $r, string $id): JsonResponse
    {
        return response()->json(['device' => Present::device($this->devices->setRevoked($r->user(), $id, true))]);
    }

    public function restoreDevice(Request $r, string $id): JsonResponse
    {
        return response()->json(['device' => Present::device($this->devices->setRevoked($r->user(), $id, false))]);
    }

    public function audit(Request $r): JsonResponse
    {
        $q = AuditLog::query()
            ->when($r->query('action'), fn ($q, $a) => $q->whereLike('action', $a.'%')) // case-insensitive on SQLite and PostgreSQL alike
            ->when($this->uuidQuery($r, 'userId'), fn ($q, $u) => $q->where('user_id', $u))
            ->orderByDesc('occurred_at')->limit(min((int) $r->query('limit', 300), 1000));

        return response()->json(['entries' => $q->get()->map(fn ($a) => Present::audit($a))->values()]);
    }
}
