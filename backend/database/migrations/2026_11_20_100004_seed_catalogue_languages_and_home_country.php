<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * A catalogue with no language and no country cannot open at all, so it starts with the languages the shop already
 * speaks and with its own country. Everything here is an ordinary row: the owner enables Turkish, adds Germany and
 * turns Iraq off again from the admin panel, without a developer.
 *
 * Only English, Arabic and Kurdish Sorani start enabled — those are the three the rest of the system already has
 * words for. Badini, Turkish, German and French are listed ready to be switched on once they are translated.
 */
return new class extends Migration
{
    private const LANGUAGES = [
        ['code' => 'en', 'name' => 'English', 'native' => 'English', 'rtl' => false, 'enabled' => true, 'sort' => 1],
        ['code' => 'ar', 'name' => 'Arabic', 'native' => 'العربية', 'rtl' => true, 'enabled' => true, 'sort' => 2],
        ['code' => 'ckb', 'name' => 'Kurdish (Sorani)', 'native' => 'کوردی سۆرانی', 'rtl' => true, 'enabled' => true, 'sort' => 3],
        ['code' => 'kmr', 'name' => 'Kurdish (Badini)', 'native' => 'کوردی بادینی', 'rtl' => true, 'enabled' => false, 'sort' => 4],
        ['code' => 'tr', 'name' => 'Turkish', 'native' => 'Türkçe', 'rtl' => false, 'enabled' => false, 'sort' => 5],
        ['code' => 'de', 'name' => 'German', 'native' => 'Deutsch', 'rtl' => false, 'enabled' => false, 'sort' => 6],
        ['code' => 'fr', 'name' => 'French', 'native' => 'Français', 'rtl' => false, 'enabled' => false, 'sort' => 7],
    ];

    public function up(): void
    {
        $now = now();

        foreach (self::LANGUAGES as $lang) {
            if (! DB::table('catalogue_languages')->where('code', $lang['code'])->exists()) {
                DB::table('catalogue_languages')->insert($lang + ['created_at' => $now, 'updated_at' => $now]);
            }
        }

        // The shop's own country, so the catalogue opens the day it is switched on.
        if (! DB::table('catalogue_countries')->where('iso2', 'IQ')->exists()) {
            DB::table('catalogue_countries')->insert([
                'id' => (string) Str::uuid(),
                'iso2' => 'IQ',
                // json_encode's default escaping, to match what Eloquent's json cast writes
                'name' => json_encode(['en' => 'Iraq', 'ar' => 'العراق', 'ckb' => 'عێراق', 'kmr' => 'عێراق', 'tr' => 'Irak', 'de' => 'Irak', 'fr' => 'Irak']),
                'language_code' => 'ar',
                'enabled' => true,
                'is_default' => true,
                'sort' => 1,
                'min_order_cents' => 0,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }
    }

    public function down(): void
    {
        DB::table('catalogue_countries')->where('iso2', 'IQ')->delete();
        DB::table('catalogue_languages')->whereIn('code', array_column(self::LANGUAGES, 'code'))->delete();
    }
};
