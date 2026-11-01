<?php

namespace App\Services;

use App\Models\AuditLog;
use App\Models\User;
use App\Support\Time;
use Illuminate\Support\Facades\DB;
use Throwable;

/** Append-only activity log. Never throws — logging must not break a sale. */
class AuditService
{
    /** @param array<string, mixed> $meta */
    /** `$at` = when it really happened (epoch ms), for what a till or phone did offline and sends later; never in the future. */
    public function log(?User $actor, string $action, string $entity, string $entityId, array $meta = [], ?string $deviceId = null, ?int $at = null): void
    {
        try {
            // Inside the caller's transaction this becomes a savepoint: on PostgreSQL a failed statement would otherwise
            // poison the whole transaction, so swallowing the error here would still break the sale around it.
            DB::transaction(fn () => AuditLog::create([
                'user_id' => $actor?->id,
                'user_name' => $actor?->name ?? 'System',
                'action' => $action,
                'entity' => $entity,
                'entity_id' => $entityId,
                'meta' => $meta,
                'device_id' => $deviceId,
                'occurred_at' => $at && $at > 0 ? min($at, Time::nowMs()) : Time::nowMs(),
            ]));
        } catch (Throwable $e) {
            report($e);
        }
    }
}
