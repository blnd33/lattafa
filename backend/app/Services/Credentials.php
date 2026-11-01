<?php

namespace App\Services;

use App\Exceptions\AppException;
use Illuminate\Support\Facades\Hash;

/** PIN / password rules and hashing shared by setup, users and login. */
final class Credentials
{
    public static function assertPin(string $pin): void
    {
        if (! preg_match('/^\d{4,6}$/', $pin)) {
            throw new AppException('pin_invalid');
        }
    }

    /** Passwords are free-form — any letters (Latin, Arabic, Kurdish), numbers, symbols or spaces. Only the length counts. */
    public const PASSWORD_MIN = 4;

    /** bcrypt only reads the first 72 bytes; anything longer would be silently ignored, so it is refused instead. */
    public const PASSWORD_MAX_BYTES = 72;

    public static function assertPassword(string $password): void
    {
        if (mb_strlen($password) < self::PASSWORD_MIN) {
            throw new AppException('password_short');
        }
        if (strlen($password) > self::PASSWORD_MAX_BYTES) {
            throw new AppException('password_long');
        }
    }

    /** Keyed digest of a PIN: lets a supervisor's PIN find exactly one person (PINs are unique) without scanning bcrypt hashes. */
    public static function fingerprint(string $pin): string
    {
        return hash_hmac('sha256', $pin, (string) config('app.key'));
    }

    /** @return array{pin_hash: string, pin_fingerprint: string} */
    public static function pinColumns(string $pin): array
    {
        return ['pin_hash' => Hash::make($pin), 'pin_fingerprint' => self::fingerprint($pin)];
    }
}
