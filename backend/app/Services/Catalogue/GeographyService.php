<?php

namespace App\Services\Catalogue;

use App\Exceptions\AppException;
use App\Models\CatalogueCountry;
use App\Models\CatalogueLanguage;
use App\Models\User;
use App\Models\WholesaleCustomer;
use App\Services\AuditService;
use App\Services\Concerns\RequiresPermission;
use Illuminate\Support\Facades\DB;

/**
 * The countries the wholesale catalogue is open in and the languages it is read in.
 *
 * Both are ordinary rows: the owner adds Turkey, points it at Turkish and sets its smallest order from the admin
 * panel, and the catalogue opens there without a line of code changing. Nothing in this file knows the name of a
 * single country.
 */
class GeographyService
{
    use RequiresPermission;

    public function __construct(private AuditService $audit) {}

    // ───────────────────────── what a visitor sees ─────────────────────────

    /**
     * The countries and languages a visitor may choose between — enabled ones only, in the owner's order.
     *
     * @return array{countries: array<int, array<string, mixed>>, languages: array<int, array<string, mixed>>, defaultCountryId: string|null}
     */
    public function open(): array
    {
        $countries = CatalogueCountry::where('enabled', true)->orderBy('sort')->orderBy('iso2')->get();
        $languages = CatalogueLanguage::where('enabled', true)->orderBy('sort')->orderBy('code')->get();

        // a country pointed at a language that has since been switched off would open in nothing
        $live = $languages->pluck('code')->all();
        $countries = $countries->filter(fn (CatalogueCountry $c) => in_array($c->language_code, $live, true))->values();

        return [
            'countries' => $countries->map(fn (CatalogueCountry $c) => [
                'id' => $c->id, 'iso2' => $c->iso2, 'name' => $c->name, 'language' => $c->language_code,
                'minOrderCents' => $c->min_order_cents, 'isDefault' => $c->is_default,
            ])->all(),
            'languages' => $languages->map(fn (CatalogueLanguage $l) => [
                'code' => $l->code, 'name' => $l->name, 'native' => $l->native, 'rtl' => $l->rtl,
            ])->all(),
            'defaultCountryId' => $countries->firstWhere('is_default', true)?->id ?? $countries->first()?->id,
        ];
    }

    /** The country a visitor asked for, by id or ISO code — only if it is open. */
    public function openCountry(?string $idOrIso): ?CatalogueCountry
    {
        if (! $idOrIso) {
            return null;
        }
        $key = strtoupper($idOrIso);

        return CatalogueCountry::where('enabled', true)
            ->where(fn ($q) => $q->where('id', $idOrIso)->orWhere('iso2', $key))
            ->first();
    }

    // ───────────────────────── countries, from the admin panel ─────────────────────────

    /** @return \Illuminate\Database\Eloquent\Collection<int, CatalogueCountry> */
    public function countries(User $actor)
    {
        $this->need($actor, 'catalogue.view');

        return CatalogueCountry::withCount('customers')->orderBy('sort')->orderBy('iso2')->get();
    }

    /**
     * Adds a country or changes one. `id` present = change.
     *
     * @param array{id?: string|null, iso2: string, name: array<string, string>, language: string, enabled?: bool, isDefault?: bool, sort?: int, minOrderCents?: int} $in
     */
    public function saveCountry(User $actor, array $in): CatalogueCountry
    {
        $this->need($actor, 'catalogue.countries');

        $iso = strtoupper(trim($in['iso2'] ?? ''));
        if (! preg_match('/^[A-Z]{2}$/', $iso)) {
            throw new AppException('country_iso_invalid');
        }

        $language = CatalogueLanguage::find($in['language'] ?? '');
        if (! $language) {
            throw new AppException('language_unknown');
        }

        $names = array_filter(array_map('trim', $in['name'] ?? []), fn (string $v) => $v !== '');
        if (! $names) {
            throw new AppException('country_name_required');
        }

        $clash = CatalogueCountry::where('iso2', $iso)->when($in['id'] ?? null, fn ($q, $id) => $q->whereKeyNot($id))->exists();
        if ($clash) {
            throw new AppException('country_exists', ['iso2' => $iso]);
        }

        $enabled = (bool) ($in['enabled'] ?? true);
        $attrs = [
            'iso2' => $iso,
            'name' => $names,
            'language_code' => $language->code,
            'enabled' => $enabled,
            'sort' => (int) ($in['sort'] ?? 0),
            'min_order_cents' => max(0, (int) ($in['minOrderCents'] ?? 0)),
        ];

        return DB::transaction(function () use ($actor, $in, $attrs, $enabled) {
            $country = isset($in['id']) ? CatalogueCountry::findOrFail($in['id']) : new CatalogueCountry();
            $isNew = ! $country->exists;
            $country->fill($attrs)->save();

            // exactly one default, and never a country nobody can reach
            if (($in['isDefault'] ?? false) && $enabled) {
                CatalogueCountry::whereKeyNot($country->id)->update(['is_default' => false]);
                $country->update(['is_default' => true]);
            } elseif ($country->is_default && ! $enabled) {
                $country->update(['is_default' => false]);
            }
            $this->ensureOneDefault();

            $this->audit->log($actor, $isNew ? 'catalogue.country_added' : 'catalogue.country_updated', 'catalogue_country', $country->id, [
                'iso2' => $country->iso2, 'language' => $country->language_code, 'enabled' => $country->enabled,
            ]);

            return $country->fresh();
        });
    }

    public function deleteCountry(User $actor, string $id): void
    {
        $this->need($actor, 'catalogue.countries');
        $country = CatalogueCountry::findOrFail($id);

        // Wholesale customers are tied to a country, and so are their agreed prices and their orders. Removing one
        // under them would quietly change what they are charged, so it is refused while anyone is assigned to it.
        if (WholesaleCustomer::where('country_id', $id)->exists()) {
            throw new AppException('country_in_use', ['iso2' => $country->iso2]);
        }

        DB::transaction(function () use ($actor, $country) {
            $country->delete();
            $this->ensureOneDefault();
            $this->audit->log($actor, 'catalogue.country_deleted', 'catalogue_country', $country->id, ['iso2' => $country->iso2]);
        });
    }

    // ───────────────────────── languages ─────────────────────────

    /** @return \Illuminate\Database\Eloquent\Collection<int, CatalogueLanguage> */
    public function languages(User $actor)
    {
        $this->need($actor, 'catalogue.view');

        return CatalogueLanguage::orderBy('sort')->orderBy('code')->get();
    }

    /**
     * Adds a language or changes one. The code is the key, so changing it is adding a new one.
     *
     * @param array{code: string, name?: string, native?: string, rtl?: bool, enabled?: bool, sort?: int} $in
     */
    public function saveLanguage(User $actor, array $in): CatalogueLanguage
    {
        $this->need($actor, 'catalogue.countries');

        $code = strtolower(trim($in['code'] ?? ''));
        if (! preg_match('/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/', $code)) {
            throw new AppException('language_code_invalid');
        }

        $existing = CatalogueLanguage::find($code);
        $enabled = (bool) ($in['enabled'] ?? $existing?->enabled ?? false);

        // the catalogue has to be readable in something
        if ($existing && $existing->enabled && ! $enabled && CatalogueLanguage::where('enabled', true)->count() <= 1) {
            throw new AppException('language_last_enabled');
        }
        // and a country already open in it must not be left speechless
        if ($existing && ! $enabled && CatalogueCountry::where('language_code', $code)->where('enabled', true)->exists()) {
            throw new AppException('language_in_use', ['code' => $code]);
        }

        $language = CatalogueLanguage::updateOrCreate(['code' => $code], [
            'name' => trim($in['name'] ?? $existing?->name ?? strtoupper($code)),
            'native' => trim($in['native'] ?? $existing?->native ?? strtoupper($code)),
            'rtl' => (bool) ($in['rtl'] ?? $existing?->rtl ?? false),
            'enabled' => $enabled,
            'sort' => (int) ($in['sort'] ?? $existing?->sort ?? 0),
        ]);

        $this->audit->log($actor, $existing ? 'catalogue.language_updated' : 'catalogue.language_added', 'catalogue_language', $code, [
            'enabled' => $enabled,
        ]);

        return $language;
    }

    public function deleteLanguage(User $actor, string $code): void
    {
        $this->need($actor, 'catalogue.countries');
        $language = CatalogueLanguage::findOrFail($code);

        if (CatalogueCountry::where('language_code', $code)->exists()) {
            throw new AppException('language_in_use', ['code' => $code]);
        }
        if ($language->enabled && CatalogueLanguage::where('enabled', true)->count() <= 1) {
            throw new AppException('language_last_enabled');
        }

        $language->delete();   // its translations go with it (cascade)
        $this->audit->log($actor, 'catalogue.language_deleted', 'catalogue_language', $code, []);
    }

    /** Keeps exactly one enabled country marked as the one a visitor is offered first. */
    private function ensureOneDefault(): void
    {
        $defaults = CatalogueCountry::where('enabled', true)->where('is_default', true)->orderBy('sort')->get();

        if ($defaults->count() === 1) {
            return;
        }
        if ($defaults->count() > 1) {
            CatalogueCountry::whereKeyNot($defaults->first()->id)->update(['is_default' => false]);

            return;
        }
        $first = CatalogueCountry::where('enabled', true)->orderBy('sort')->orderBy('iso2')->first();
        $first?->update(['is_default' => true]);
    }
}
