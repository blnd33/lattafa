<?php

namespace App\Services\Concerns;

use App\Exceptions\AppException;
use App\Models\User;

trait RequiresPermission
{
    /** Throws a 403 `forbidden` (with the permission name) unless the actor holds it. */
    protected function need(User $actor, string $permission): void
    {
        if (! $actor->can($permission)) {
            throw AppException::forbidden($permission);
        }
    }
}
