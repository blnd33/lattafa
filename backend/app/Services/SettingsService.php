<?php

namespace App\Services;

use App\Exceptions\AppException;
use App\Models\Setting;
use App\Models\User;

/**
 * Shop-wide settings (one JSON document). The shape matches the POS `AppSettings` (minus the per-device
 * `device` block, which lives in the `devices` table).
 */
class SettingsService
{
    public function __construct(private AuditService $audit) {}

    /** @return array<string, mixed> */
    public static function defaults(): array
    {
        return [
            'setupDone' => false,
            'store' => ['name' => 'Lattafa Perfumes', 'tagline' => 'Duhok · Iraq', 'address' => 'Duhok, Kurdistan Region, Iraq', 'phone' => '', 'city' => 'Duhok'],
            'receipt' => [
                'header' => '',
                'footer' => ['en' => 'Thank you for choosing Lattafa', 'ar' => 'شكراً لاختياركم لطافة', 'ku' => 'سوپاس بۆ هەڵبژاردنی لەتافە'],
                'showLogo' => true, 'showQr' => true, 'qrUrl' => '', 'paperMm' => 80, 'autoPrint' => false, 'copies' => 1,
            ],
            'currency' => ['rate' => 1460, 'rounding' => 250, 'usdEnabled' => true],
            'tax' => ['pct' => 0],
            'loyalty' => ['enabled' => true, 'pointsPer1000IQD' => 1, 'pointValueIQD' => 10],
            'sales' => ['requireShift' => false, 'allowNegativeStock' => false, 'giftWrapFeeIQD' => 2000, 'defaultCustomerCreditIQD' => 0, 'returnWindowDays' => 14],
            'security' => ['autoLockMinutes' => 10, 'maxFailedAttempts' => 5, 'lockoutSeconds' => 60],
            // the customer menu: prices shown, sold-out perfumes hidden, the WhatsApp number orders go to (empty = the shop phone),
            // photos/videos behind its top (see MenuMedia) and how much they are darkened
            'menu' => ['showPrices' => true, 'hideSoldOut' => false, 'whatsapp' => '', 'heroDim' => 45, 'hero' => []],
        ];
    }

    /** @return array<string, mixed> stored settings merged over the defaults */
    public function get(): array
    {
        $row = Setting::find('app');

        return self::merge(self::defaults(), $row?->value ?? []);
    }

    /**
     * @param array<string, mixed> $patch
     * @param bool $log false when the caller writes its own, clearer activity-log entry (the customer menu does)
     */
    public function update(User $actor, array $patch, bool $log = true): array
    {
        if (! $actor->can('settings.edit')) {
            throw AppException::forbidden('settings.edit');
        }
        unset($patch['setupDone']);
        $before = $this->get();
        $next = self::merge($before, $patch);
        Setting::updateOrCreate(['key' => 'app'], ['value' => $next]);
        if ($log) {
            $this->audit->log($actor, 'settings.update', 'settings', 'app', ['keys' => array_keys($patch), 'changes' => self::changes($before, $next)]);
        }

        return $next;
    }

    /** Used during first-run setup (nobody is signed in yet). */
    public function save(array $settings): void
    {
        Setting::updateOrCreate(['key' => 'app'], ['value' => $settings]);
    }

    public function isSetupDone(): bool
    {
        return (bool) ($this->get()['setupDone'] ?? false);
    }

    /**
     * For the activity log: every value that changed, as "currency.rate" => [old, new] (long texts shortened, lists only
     * marked as changed), at most 25.
     *
     * @return array<string, array{0: mixed, 1: mixed}>
     */
    public static function changes(array $old, array $new, string $prefix = ''): array
    {
        $out = [];
        foreach (array_unique([...array_keys($old), ...array_keys($new)]) as $k) {
            $a = $old[$k] ?? null;
            $b = $new[$k] ?? null;
            if ($a === $b) {
                continue;
            }
            if (is_array($a) && is_array($b) && ! array_is_list($a) && ! array_is_list($b)) {
                $out += self::changes($a, $b, $prefix.$k.'.');
            } else {
                $short = fn ($v) => is_array($v) ? '['.count($v).']' : (is_string($v) && mb_strlen($v) > 60 ? mb_substr($v, 0, 57).'…' : $v);
                $out[$prefix.$k] = [$short($a), $short($b)];
            }
            if (count($out) >= 25) {
                break;
            }
        }

        return $out;
    }

    /** Recursive merge where scalars/lists in $patch replace, and associative arrays merge. */
    public static function merge(array $base, array $patch): array
    {
        foreach ($patch as $k => $v) {
            if (is_array($v) && isset($base[$k]) && is_array($base[$k]) && ! array_is_list($v) && ! array_is_list($base[$k])) {
                $base[$k] = self::merge($base[$k], $v);
            } else {
                $base[$k] = $v;
            }
        }

        return $base;
    }
}
