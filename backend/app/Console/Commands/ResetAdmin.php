<?php

namespace App\Console\Commands;

use App\Exceptions\AppException;
use App\Models\User;
use App\Services\AuditService;
use App\Services\Credentials;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * The way back in when the owner forgets their password or PIN: only someone who can run commands on the server can
 * use it. Sets a new password and/or PIN for a Super Admin, lifts a lockout and signs that person out everywhere.
 * Tills and phones stay registered, and nobody else is signed out.
 */
class ResetAdmin extends Command
{
    protected $signature = 'lattafa:reset-admin {username? : the Super Admin to reset (asked when left out)}';

    protected $description = 'Locked out? Set a new password and/or PIN for a Super Admin, straight on the server';

    private const TRIES = 3;

    public function handle(AuditService $audit): int
    {
        $admins = User::with('role')->whereHas('role', fn ($q) => $q->where('key', 'super_admin'))->orderBy('name')->get();
        if ($admins->isEmpty()) {
            $this->error('There is no Super Admin yet. Open the POS in a browser to set the shop up.');

            return self::FAILURE;
        }

        $username = $this->argument('username');
        if ($username === null) {
            $username = $admins->count() === 1
                ? $admins->first()->username
                : $this->choice('Which Super Admin?', $admins->map(fn (User $u) => $u->username)->all());
        }
        $user = $admins->firstWhere('username', Str::lower(trim($username)));
        if (! $user) {
            $this->error("No Super Admin has the username \"{$username}\". Super Admins: ".$admins->pluck('username')->join(', '));

            return self::FAILURE;
        }
        $this->info("Resetting {$user->name} ({$user->username}).");

        $password = $this->askPassword();
        if ($password === false) {
            return self::FAILURE;
        }
        $pin = $this->askPin($user);
        if ($pin === false) {
            return self::FAILURE;
        }

        $patch = ['failed_attempts' => 0, 'locked_until' => null];
        if ($password !== null) {
            $patch['password'] = Hash::make($password);
        }
        if ($pin !== null) {
            $patch += Credentials::pinColumns($pin);
        }
        if (! $user->active && $this->confirm('This account is switched off. Switch it back on?', true)) {
            $patch['active'] = true;
        }
        if (count($patch) === 2 && ! $user->isLocked()) {
            $this->warn('Nothing was changed.');

            return self::SUCCESS;
        }

        $user->update($patch);
        $user->tokens()->delete();
        $audit->log(null, 'user.reset_credentials', 'user', $user->id, ['pin' => $pin !== null, 'password' => $password !== null, 'via' => 'server']);

        $this->info('Done. '.collect([
            $password !== null ? 'New password saved.' : null,
            $pin !== null ? 'New PIN saved.' : null,
            isset($patch['active']) ? 'Account switched back on.' : null,
            'Any lockout is lifted, and '.$user->name.' is signed out everywhere: sign in again with the new details.',
        ])->filter()->join(' '));

        return self::SUCCESS;
    }

    /** @return string|null|false the new password, null to keep the current one, false after too many bad tries */
    private function askPassword(): string|null|false
    {
        for ($i = 0; $i < self::TRIES; $i++) {
            $password = (string) $this->secret('New password (press Enter to keep the current one)');
            if ($password === '') {
                return null;
            }
            try {
                Credentials::assertPassword($password);
            } catch (AppException $e) {
                $this->error($e->errorCode === 'password_short'
                    ? 'Too short: at least '.Credentials::PASSWORD_MIN.' characters.'
                    : 'Too long: at most '.Credentials::PASSWORD_MAX_BYTES.' bytes (an Arabic or Kurdish letter counts as 2).');

                continue;
            }
            if ((string) $this->secret('Type the new password again') !== $password) {
                $this->error('The two passwords are not the same.');

                continue;
            }

            return $password;
        }
        $this->error('Nothing was changed.');

        return false;
    }

    /** @return string|null|false the new PIN, null to keep the current one, false after too many bad tries */
    private function askPin(User $user): string|null|false
    {
        for ($i = 0; $i < self::TRIES; $i++) {
            $pin = trim((string) $this->secret('New PIN, 4 to 6 digits (press Enter to keep the current one)'));
            if ($pin === '') {
                return null;
            }
            if (! preg_match('/^\d{4,6}$/', $pin)) {
                $this->error('A PIN is 4 to 6 digits.');

                continue;
            }
            // PINs are unique: a supervisor's PIN alone must point to exactly one person
            if (User::where('pin_fingerprint', Credentials::fingerprint($pin))->where('id', '!=', $user->id)->exists()) {
                $this->error('Someone else already uses this PIN. Choose another one.');

                continue;
            }
            if ((string) $this->secret('Type the new PIN again') !== $pin) {
                $this->error('The two PINs are not the same.');

                continue;
            }

            return $pin;
        }
        $this->error('Nothing was changed.');

        return false;
    }
}
