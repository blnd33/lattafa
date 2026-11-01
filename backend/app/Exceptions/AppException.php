<?php

namespace App\Exceptions;

use RuntimeException;

/**
 * A business-rule failure with a stable machine `code` (the same codes the POS translates as `err.<code>`),
 * plus parameters for the message. Rendered as `{"error": {"code": "...", "params": {...}}}`.
 */
class AppException extends RuntimeException
{
    /** @param array<string, scalar> $params */
    public function __construct(public readonly string $errorCode, public readonly array $params = [], public readonly int $status = 422)
    {
        parent::__construct($errorCode);
    }

    public static function forbidden(string $permission): self
    {
        return new self('forbidden', ['permission' => $permission], 403);
    }

    public static function notFound(): self
    {
        return new self('not_found', [], 404);
    }
}
