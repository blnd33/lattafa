<?php

namespace App\Services\Catalogue;

use App\Exceptions\AppException;
use App\Models\CatalogueLanguage;
use App\Models\CatalogueProductTranslation;
use App\Models\CatalogueTranslation;
use App\Models\Product;
use App\Models\User;
use App\Services\AuditService;
use App\Services\Concerns\RequiresPermission;
use App\Support\CatalogueStrings;
use Illuminate\Support\Facades\DB;

/**
 * The catalogue's words, in whatever language it is being read in.
 *
 * Two different things are translated here. The catalogue's own interface — buttons, labels, the messages a buyer
 * sees when a code is refused — is a list of keys the owner fills in from the admin panel. A perfume's name and
 * description are the shop's own, and a translation only ever *overrides* them: anything not translated falls back
 * to the product's text rather than showing a blank, and nothing is ever machine-translated into a language the
 * shop has not written.
 */
class TranslationService
{
    use RequiresPermission;

    public function __construct(private AuditService $audit) {}

    /**
     * Every word the catalogue needs in one language: English underneath, the language's own rows on top.
     *
     * @return array<string, string>
     */
    public function dictionary(string $language): array
    {
        $base = CatalogueStrings::EN;
        $rows = CatalogueTranslation::whereIn('language_code', array_unique(['en', $language]))->get();

        // English rows first, so the asked-for language wins where both exist
        foreach ($rows->sortBy(fn (CatalogueTranslation $t) => $t->language_code === $language ? 1 : 0) as $row) {
            if ($row->value !== '') {
                $base[$row->key] = $row->value;
            }
        }

        return $base;
    }

    /**
     * The translations screen for one language: every key the catalogue knows, what English says, and what this
     * language says (empty when it has not been written yet).
     *
     * @return array{language: string, done: int, total: int, rows: array<int, array{key: string, en: string, value: string}>}
     */
    public function sheet(User $actor, string $language): array
    {
        $this->need($actor, 'catalogue.view');
        $this->language($language);

        $english = $this->dictionary('en');
        $own = CatalogueTranslation::where('language_code', $language)->pluck('value', 'key');

        $rows = [];
        foreach (CatalogueStrings::keys() as $key) {
            $rows[] = ['key' => $key, 'en' => $english[$key] ?? '', 'value' => (string) ($own[$key] ?? '')];
        }

        return [
            'language' => $language,
            'done' => count(array_filter($rows, fn (array $r) => $r['value'] !== '')),
            'total' => count($rows),
            'rows' => $rows,
        ];
    }

    /**
     * How far each enabled language has got. The owner can see at a glance what is still missing, which is the
     * whole point of §7's "identify incomplete translations".
     *
     * @return array<int, array{language: string, name: string, native: string, done: int, total: int}>
     */
    public function completeness(User $actor): array
    {
        $this->need($actor, 'catalogue.view');

        $total = count(CatalogueStrings::keys());
        $known = CatalogueStrings::keys();
        $filled = CatalogueTranslation::whereIn('key', $known)->where('value', '<>', '')
            ->selectRaw('language_code, count(*) as n')->groupBy('language_code')->pluck('n', 'language_code');

        return CatalogueLanguage::orderBy('sort')->orderBy('code')->get()->map(fn (CatalogueLanguage $l) => [
            'language' => $l->code,
            'name' => $l->name,
            'native' => $l->native,
            // English ships complete in code; everything else is counted from what has been written
            'done' => $l->code === 'en' ? $total : (int) ($filled[$l->code] ?? 0),
            'total' => $total,
        ])->all();
    }

    /**
     * Writes one language's words. An empty value removes the row, so the key falls back to English again rather
     * than showing an empty button.
     *
     * @param array<string, string> $values
     */
    public function save(User $actor, string $language, array $values): int
    {
        $this->need($actor, 'catalogue.translations');
        $this->language($language);

        $known = array_flip(CatalogueStrings::keys());
        $changed = 0;

        DB::transaction(function () use ($language, $values, $known, &$changed) {
            foreach ($values as $key => $value) {
                if (! isset($known[$key])) {
                    continue;   // a key the catalogue does not use — silently ignored, never stored
                }
                $value = trim((string) $value);
                $row = CatalogueTranslation::where('language_code', $language)->where('key', $key)->first();

                if ($value === '') {
                    if ($row) {
                        $row->delete();
                        $changed++;
                    }

                    continue;
                }
                if (! $row) {
                    CatalogueTranslation::create(['language_code' => $language, 'key' => $key, 'value' => $value]);
                    $changed++;
                } elseif ($row->value !== $value) {
                    $row->update(['value' => $value]);
                    $changed++;
                }
            }
        });

        if ($changed) {
            $this->audit->log($actor, 'catalogue.translated', 'catalogue_language', $language, ['changed' => $changed]);
        }

        return $changed;
    }

    // ───────────────────────── a perfume's own words ─────────────────────────

    /**
     * A perfume's name, description and notes in one language: its translation where there is one, the product's
     * own text where there is not.
     *
     * @return array{name: string, description: string, notes: array<string, array<int, string>>}
     */
    public function productText(Product $product, string $language, ?CatalogueProductTranslation $override = null): array
    {
        $override ??= $product->relationLoaded('catalogueTranslations')
            ? $product->catalogueTranslations->firstWhere('language_code', $language)
            : CatalogueProductTranslation::where('product_id', $product->id)->where('language_code', $language)->first();

        $pick = function (array $texts) use ($language): string {
            // the product's own text is keyed by the POS's languages (en/ar/ku); anything else falls back to English
            return (string) ($texts[$language] ?? $texts['en'] ?? $texts['ar'] ?? $texts['ku'] ?? '');
        };

        return [
            'name' => $override?->display_name ?: $pick($product->name ?? []),
            'description' => $override?->description ?: $pick($product->description ?? []),
            'notes' => $override?->notes ?: ($product->notes ?? ['top' => [], 'heart' => [], 'base' => []]),
        ];
    }

    private function language(string $code): CatalogueLanguage
    {
        $language = CatalogueLanguage::find($code);
        if (! $language) {
            throw new AppException('language_unknown');
        }

        return $language;
    }
}
