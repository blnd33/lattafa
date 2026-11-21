<?php

namespace App\Services\Catalogue;

use App\Exceptions\AppException;
use App\Models\CatalogueCountry;
use App\Models\User;
use App\Models\WholesaleAccessCode;
use App\Models\WholesaleCustomer;
use App\Models\WholesaleSession;
use App\Services\AuditService;
use App\Services\Concerns\RequiresPermission;
use App\Support\Time;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * The wholesale access code: the one thing standing between a visitor and a buyer's own prices.
 *
 * How a code is kept is the same way a staff PIN is kept (`App\Services\Credentials`): a keyed HMAC fingerprint
 * finds the single row it belongs to without scanning bcrypt hashes, and bcrypt then proves the code. The code
 * itself is never stored and never logged — it is shown once, at the moment it is generated, and after that even
 * the owner only sees its last four characters.
 *
 * Unlocking opens a session, which is deliberately NOT a Sanctum token: a buyer's session and a staff token are
 * separate systems, so a buyer's token handed to a staff endpoint is not a token at all. Withdrawing a code, or
 * putting a business on hold, closes every session opened with it at once.
 *
 * What a code does NOT do: it gives no reach into the admin panel, and it never shows one buyer anything about
 * another. It is a key to one business's prices, nothing more.
 */
class AccessCodeService
{
    use RequiresPermission;

    /** No 0/O/1/I/5/S — a code gets read down a phone line and typed by someone who did not choose it. */
    private const ALPHABET = '23456789ABCDEFGHJKLMNPQRTUVWXYZ';

    private const LENGTH = 8;

    private const PREFIX = 'LAT-';

    /** How long a buyer stays unlocked before typing the code again. */
    private const SESSION_DAYS = 30;

    /** A real bcrypt hash of nothing in particular, checked against when no code matched (see `unlock`). */
    private const NO_SUCH_CODE = '$2y$12$W9Q/FL1sqKQLs/Gib9PX0.5i2t4coGnJHjR4XPvKlWcUlu/hRJS3i';

    public function __construct(private AuditService $audit, private GeographyService $geography) {}

    // ───────────────────────── the owner's side ─────────────────────────

    /**
     * Makes a new code for a business and returns it ONCE, in plain text. It cannot be read again afterwards —
     * if it is lost, generate another.
     *
     * @param array{countryId?: string|null, expiresAt?: int|null} $opts
     * @return array{code: WholesaleAccessCode, plain: string}
     */
    public function generate(User $actor, string $customerId, array $opts = []): array
    {
        $this->need($actor, 'catalogue.codes');
        $customer = WholesaleCustomer::findOrFail($customerId);

        $countryId = $opts['countryId'] ?? null;
        if ($countryId !== null && ! CatalogueCountry::whereKey($countryId)->exists()) {
            throw new AppException('country_unknown');
        }

        $expiresAt = $opts['expiresAt'] ?? null;
        if ($expiresAt !== null && $expiresAt <= Time::nowMs()) {
            throw new AppException('expiry_in_the_past');
        }

        return DB::transaction(function () use ($actor, $customer, $countryId, $expiresAt) {
            $plain = $this->mint();
            $code = WholesaleAccessCode::create([
                'customer_id' => $customer->id,
                'fingerprint' => $this->fingerprint($plain),
                'hash' => Hash::make($plain),
                'display' => self::PREFIX.'••••'.substr($plain, -4),
                'country_id' => $countryId,
                'active' => true,
                'expires_at' => $expiresAt,
                'uses' => 0,            // stated, not left to the column default, so the reply reads the same as the list
                'created_by' => $actor->id,
            ]);

            // the code itself is never written to the activity log
            $this->audit->log($actor, 'catalogue.code_issued', 'wholesale_customer', $customer->id, [
                'business' => $customer->business_name, 'code' => $code->display, 'expires' => $expiresAt,
            ]);

            return ['code' => $code, 'plain' => $plain];
        });
    }

    /** Switches a code off (or back on) without destroying it — the usual "pause this shop" action. */
    public function setActive(User $actor, string $codeId, bool $active): WholesaleAccessCode
    {
        $this->need($actor, 'catalogue.codes');
        $code = WholesaleAccessCode::with('customer')->findOrFail($codeId);

        if ($code->revoked_at !== null) {
            throw new AppException('code_revoked');
        }

        DB::transaction(function () use ($code, $active, $actor) {
            $code->update(['active' => $active]);
            if (! $active) {
                $this->closeSessionsFor($code->id);
            }
            $this->audit->log($actor, $active ? 'catalogue.code_enabled' : 'catalogue.code_disabled', 'wholesale_customer', $code->customer_id, [
                'business' => $code->customer?->business_name, 'code' => $code->display,
            ]);
        });

        return $code->fresh();
    }

    /** Withdraws a code for good. It can never be unlocked with again, and open sessions close at once. */
    public function revoke(User $actor, string $codeId): WholesaleAccessCode
    {
        $this->need($actor, 'catalogue.codes');
        $code = WholesaleAccessCode::with('customer')->findOrFail($codeId);

        if ($code->revoked_at === null) {
            DB::transaction(function () use ($code, $actor) {
                $code->update(['active' => false, 'revoked_at' => Time::nowMs()]);
                $this->closeSessionsFor($code->id);
                $this->audit->log($actor, 'catalogue.code_revoked', 'wholesale_customer', $code->customer_id, [
                    'business' => $code->customer?->business_name, 'code' => $code->display,
                ]);
            });
        }

        return $code->fresh();
    }

    /** @return \Illuminate\Database\Eloquent\Collection<int, WholesaleAccessCode> */
    public function codesFor(User $actor, string $customerId)
    {
        $this->need($actor, 'catalogue.codes');

        return WholesaleAccessCode::with('country')->where('customer_id', $customerId)->orderByDesc('created_at')->get();
    }

    // ───────────────────────── the buyer's side ─────────────────────────

    /**
     * Checks a code and, if everything about it is in order, opens a session.
     *
     * Every refusal is its own error code so the catalogue can say something useful — "that code has expired" is
     * worth saying, while a code that was simply never issued says only that it was not recognised.
     *
     * @return array{token: string, session: WholesaleSession, customer: WholesaleCustomer, country: CatalogueCountry|null}
     */
    public function unlock(string $plain, ?string $countryIdOrIso, string $ip = '', string $userAgent = ''): array
    {
        $plain = $this->normalise($plain);
        if ($plain === '') {
            throw new AppException('code_invalid');
        }

        $code = WholesaleAccessCode::with(['customer', 'country'])->where('fingerprint', $this->fingerprint($plain))->first();

        // bcrypt is checked even when the fingerprint found nothing, so a wrong code takes the same time as a right
        // one and the reply cannot be used to tell "never issued" from "wrong"
        $ok = $code ? Hash::check($plain, $code->hash) : Hash::check($plain, self::NO_SUCH_CODE);
        if (! $code || ! $ok) {
            throw new AppException('code_invalid');
        }

        $now = Time::nowMs();
        if ($code->revoked_at !== null) {
            throw new AppException('code_revoked');
        }
        if (! $code->active) {
            throw new AppException('code_revoked');
        }
        if ($code->isExpired($now)) {
            throw new AppException('code_expired');
        }

        $customer = $code->customer;
        if (! $customer || ! $customer->isActive()) {
            throw new AppException('customer_inactive');
        }

        $country = $this->resolveCountry($code, $customer, $countryIdOrIso);

        return DB::transaction(function () use ($code, $customer, $country, $ip, $userAgent, $now) {
            $token = Str::random(64);
            $session = WholesaleSession::create([
                'customer_id' => $customer->id,
                'code_id' => $code->id,
                'token_hash' => hash('sha256', $token),
                'country_id' => $country?->id,
                'ip' => substr($ip, 0, 45),
                'user_agent' => substr($userAgent, 0, 255),
                'started_at' => $now,
                'last_seen_at' => $now,
                'expires_at' => $now + self::SESSION_DAYS * 86400_000,
            ]);
            $code->update(['uses' => $code->uses + 1, 'last_used_at' => $now]);

            $this->audit->log(null, 'catalogue.unlocked', 'wholesale_customer', $customer->id, [
                'business' => $customer->business_name, 'code' => $code->display, 'country' => $country?->iso2,
            ]);

            return ['token' => $token, 'session' => $session, 'customer' => $customer, 'country' => $country];
        });
    }

    /**
     * Which country this buyer is authorised for.
     *
     * A code may be tied to one country; then that is the answer whatever the visitor picked, and asking for
     * another is refused rather than quietly switched — the prices differ, so it matters. A code with no country
     * of its own follows the business's country, and a business with no country follows the visitor's choice.
     */
    private function resolveCountry(WholesaleAccessCode $code, WholesaleCustomer $customer, ?string $asked): ?CatalogueCountry
    {
        $wanted = $this->geography->openCountry($asked);

        $fixed = $code->country_id ? CatalogueCountry::find($code->country_id) : ($customer->country_id ? CatalogueCountry::find($customer->country_id) : null);
        if (! $fixed) {
            return $wanted;
        }
        if ($wanted && $wanted->id !== $fixed->id) {
            throw new AppException('code_country', ['country' => $fixed->nameIn('en'), 'iso2' => $fixed->iso2]);
        }

        return $fixed;
    }

    /** The session behind a token, or null when there is none, it has run out, or it has been closed. */
    public function session(?string $token): ?WholesaleSession
    {
        if (! $token) {
            return null;
        }

        $session = WholesaleSession::with(['customer', 'country'])->where('token_hash', hash('sha256', $token))->first();
        if (! $session || ! $session->isLive()) {
            return null;
        }
        // a business put on hold loses its open sessions as well — checked here too, so nothing can slip through
        if (! $session->customer || ! $session->customer->isActive()) {
            return null;
        }

        // not written on every request: once a day is enough to tell a live session from an abandoned one
        if ($session->last_seen_at < Time::nowMs() - 86400_000) {
            $session->forceFill(['last_seen_at' => Time::nowMs()])->saveQuietly();
        }

        return $session;
    }

    /** The buyer signing out of their own catalogue. */
    public function lock(?string $token): void
    {
        $session = $this->session($token);
        $session?->update(['revoked_at' => Time::nowMs()]);
    }

    // ───────────────────────── plumbing ─────────────────────────

    /** A fresh code, unique across every code ever issued. */
    private function mint(): string
    {
        for ($try = 0; $try < 10; $try++) {
            $body = '';
            for ($i = 0; $i < self::LENGTH; $i++) {
                $body .= self::ALPHABET[random_int(0, strlen(self::ALPHABET) - 1)];
            }
            $plain = self::PREFIX.$body;
            if (! WholesaleAccessCode::where('fingerprint', $this->fingerprint($plain))->exists()) {
                return $plain;
            }
        }

        throw new AppException('code_generation_failed');
    }

    /** Keyed digest, so the database alone cannot be searched for a code. */
    private function fingerprint(string $plain): string
    {
        return hash_hmac('sha256', $plain, (string) config('app.key'));
    }

    /** People type codes with spaces, in lower case, and sometimes without the LAT-. All of those are the same code. */
    private function normalise(string $plain): string
    {
        $clean = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $plain) ?? '');
        if ($clean === '') {
            return '';
        }
        $prefix = rtrim(self::PREFIX, '-');
        if (str_starts_with($clean, $prefix)) {
            $clean = substr($clean, strlen($prefix));
        }

        return self::PREFIX.$clean;
    }

    private function closeSessionsFor(string $codeId): void
    {
        WholesaleSession::where('code_id', $codeId)->whereNull('revoked_at')->update(['revoked_at' => Time::nowMs()]);
    }
}
