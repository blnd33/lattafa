<?php

namespace App\Services;

use App\Exceptions\AppException;
use App\Models\Device;
use App\Models\User;
use App\Services\Concerns\RequiresPermission;

/** Tills, tablets and phones running the POS. The code prefixes their document numbers (ST1-000123). */
class DeviceService
{
    use RequiresPermission;

    public function __construct(private AuditService $audit) {}

    public function list(User $actor)
    {
        $this->need($actor, 'devices.manage');

        return Device::orderBy('created_at')->get();
    }

    public function update(User $actor, string $id, string $name, string $code): Device
    {
        $this->need($actor, 'devices.manage');
        $name = trim($name);
        $code = strtoupper(trim($code));
        if ($name === '') {
            throw new AppException('required_fields');
        }
        if (! preg_match('/^[A-Z0-9]{2,6}$/', $code)) {
            throw new AppException('device_code_invalid');
        }
        if (Device::where('code', $code)->where('id', '!=', $id)->exists()) {
            throw new AppException('device_code_taken');
        }
        $device = Device::find($id) ?? throw AppException::notFound();
        $device->update(['name' => $name, 'code' => $code]);
        $this->audit->log($actor, 'device.update', 'device', $id, ['name' => $name, 'code' => $code]);

        return $device;
    }

    public function setRevoked(User $actor, string $id, bool $revoked): Device
    {
        $this->need($actor, 'devices.manage');
        $device = Device::find($id) ?? throw AppException::notFound();
        $device->update(['revoked' => $revoked]);
        if ($revoked) {
            // cut off every token issued to that device
            \Laravel\Sanctum\PersonalAccessToken::where('name', AuthService::tokenName($device))->delete();
        }
        $this->audit->log($actor, $revoked ? 'device.revoke' : 'device.restore', 'device', $id);

        return $device;
    }
}
