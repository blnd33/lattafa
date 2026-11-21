<?php

namespace App\Services\Catalogue;

use App\Exceptions\AppException;
use App\Models\CatalogueSetting;
use App\Models\User;
use App\Services\AuditService;
use App\Services\Concerns\RequiresPermission;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * How the catalogue looks, and what it says about the house.
 *
 * ## Colours and type are provisional, and say so
 *
 * The defaults below are the house theme this system already uses — ivory, charcoal, muted gold, Playfair and
 * Poppins. They are **not** Lattafa's official brand kit, which has not been supplied, and the brief is firm that
 * none may be invented. `brand.provisional` stays true until somebody turns it off, and the catalogue's footer
 * says as much while it is.
 *
 * ## The homepage is sections, in the owner's order
 *
 * Each one can be switched off and moved. The catalogue draws what is listed here, in this order, and nothing
 * else — so an owner who wants the collection first and the story last simply says so.
 *
 * ## Photographs, not video
 *
 * Hero and collection pictures are single uploads of ordinary images, the same way product photos already work,
 * and the bytes are checked rather than the label. The QR menu's chunked uploader exists because that hero takes
 * *video*; the catalogue's does not, and a second copy of that machinery for no gain would be worse than saying
 * plainly that this takes photographs.
 */
class AppearanceService
{
    use RequiresPermission;

    /** The sections the catalogue knows how to draw, in the order it offers them. */
    public const SECTIONS = ['hero', 'kinds', 'collections', 'featured', 'new', 'story', 'how'];

    private const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

    public function __construct(private AuditService $audit) {}

    /**
     * Everything the catalogue needs to draw itself, defaults filled in.
     *
     * @return array<string, mixed>
     */
    public function all(): array
    {
        $stored = CatalogueSetting::all()->pluck('value', 'key')->all();

        return [
            'brand' => ($stored['brand'] ?? []) + self::defaultBrand(),
            'homepage' => ($stored['homepage'] ?? []) + self::defaultHomepage(),
            'footer' => ($stored['footer'] ?? []) + self::defaultFooter(),
        ];
    }

    /** What the catalogue is shown — the same thing, but only the parts a visitor has any business seeing. */
    public function open(): array
    {
        $all = $this->all();

        return [
            'brand' => $all['brand'],
            // only the sections that are switched on, in the owner's order
            'sections' => array_values(array_filter(
                $all['homepage']['sections'],
                fn (array $s) => ($s['on'] ?? true) === true && in_array($s['key'], self::SECTIONS, true),
            )),
            'headline' => $all['homepage']['headline'] ?? '',
            'lead' => $all['homepage']['lead'] ?? '',
            'hero' => $all['homepage']['hero'] ?? null,
            'footer' => $all['footer'],
        ];
    }

    public function read(User $actor): array
    {
        $this->need($actor, 'catalogue.view');

        return $this->all();
    }

    /**
     * Saves one part of it. Anything left out is left alone, so two screens cannot overwrite each other.
     *
     * @param  array<string, mixed>  $patch
     */
    public function save(User $actor, string $key, array $patch): array
    {
        $this->need($actor, 'catalogue.appearance');
        if (! in_array($key, ['brand', 'homepage', 'footer'], true)) {
            throw new AppException('appearance_unknown', ['key' => $key]);
        }

        $current = $this->all()[$key];

        if ($key === 'homepage') {
            $patch = $this->cleanHomepage($patch, $current);
        }
        if ($key === 'brand') {
            $patch = $this->cleanBrand($patch, $current);
        }

        CatalogueSetting::updateOrCreate(['key' => $key], ['value' => array_replace($current, $patch)]);
        $this->audit->log($actor, 'catalogue.appearance_saved', 'catalogue_appearance', $key, ['what' => $key]);

        return $this->all();
    }

    /**
     * The picture behind the top of the homepage. `null` takes it away.
     *
     * The bytes decide what it is, not the label — nothing script-shaped ends up on the public disk.
     */
    public function setHero(User $actor, ?string $dataUrl): array
    {
        $this->need($actor, 'catalogue.appearance');

        $homepage = $this->all()['homepage'];
        $was = $homepage['hero'] ?? null;

        $homepage['hero'] = $dataUrl === null || $dataUrl === ''
            ? null
            : Storage::disk('public')->url($this->store($dataUrl, 'catalogue/hero'));

        if ($was && $homepage['hero'] !== $was) {
            $this->forget($was);
        }

        CatalogueSetting::updateOrCreate(['key' => 'homepage'], ['value' => $homepage]);
        $this->audit->log($actor, 'catalogue.appearance_saved', 'catalogue_appearance', 'hero', ['what' => 'hero']);

        return $this->all();
    }

    /**
     * Stores a data-URL image on the public disk and returns its path.
     *
     * Lifted from how product photos are already stored (`CatalogService::storeImage`): the label on a data URL is
     * whatever the sender typed, so the bytes are read instead.
     */
    public function store(string $dataUrl, string $folder): string
    {
        if (! preg_match('#^data:image/(png|jpe?g|webp|gif);base64,(.+)$#s', $dataUrl, $m)) {
            throw new AppException('image_invalid');
        }
        $bytes = base64_decode($m[2], true);
        if ($bytes === false || strlen($bytes) > self::MAX_IMAGE_BYTES) {
            throw new AppException('image_invalid');
        }
        $mime = @getimagesizefromstring($bytes)['mime'] ?? null;
        $ext = ['image/png' => 'png', 'image/jpeg' => 'jpg', 'image/webp' => 'webp', 'image/gif' => 'gif'][$mime]
            ?? throw new AppException('image_invalid');

        $path = trim($folder, '/').'/'.Str::lower(Str::random(10)).'.'.$ext;
        Storage::disk('public')->put($path, $bytes);

        return $path;
    }

    /** Removes a file we put on the public disk, given either its path or the URL we handed out. */
    public function forget(?string $pathOrUrl): void
    {
        if (! $pathOrUrl) {
            return;
        }
        $base = Storage::disk('public')->url('');
        $path = str_starts_with($pathOrUrl, $base) ? substr($pathOrUrl, strlen($base)) : $pathOrUrl;
        if ($path && ! str_contains($path, '..')) {
            Storage::disk('public')->delete(ltrim($path, '/'));
        }
    }

    // ───────────────────────── what a sensible catalogue starts as ─────────────────────────

    /** @return array<string, mixed> */
    public static function defaultBrand(): array
    {
        return [
            // the house theme this system already uses — NOT Lattafa's own kit, which nobody has supplied
            'ink' => '#1A1714',
            'ivory' => '#FBF8F2',
            'gold' => '#D4A548',
            'wordmark' => 'LATTAFA',
            'tagline' => 'Est. Duhok',
            // the catalogue says so, in its own footer, until somebody turns this off
            'provisional' => true,
        ];
    }

    /** @return array<string, mixed> */
    public static function defaultHomepage(): array
    {
        return [
            'headline' => '',          // empty = the catalogue's own translated words
            'lead' => '',
            'hero' => null,
            'sections' => array_map(fn (string $key) => ['key' => $key, 'on' => true], self::SECTIONS),
        ];
    }

    /** @return array<string, mixed> */
    public static function defaultFooter(): array
    {
        return ['note' => '', 'email' => '', 'phone' => '', 'instagram' => '', 'website' => ''];
    }

    /** Keeps the section list to things the catalogue can actually draw, with none missing and none twice. */
    private function cleanHomepage(array $patch, array $current): array
    {
        if (! array_key_exists('sections', $patch)) {
            return $patch;
        }

        $seen = [];
        $out = [];
        foreach ((array) $patch['sections'] as $section) {
            $key = is_array($section) ? ($section['key'] ?? '') : '';
            if (! in_array($key, self::SECTIONS, true) || isset($seen[$key])) {
                continue;
            }
            $seen[$key] = true;
            $out[] = ['key' => $key, 'on' => ($section['on'] ?? true) === true];
        }
        // anything the owner's list left out keeps its current setting rather than vanishing
        foreach ($current['sections'] ?? [] as $section) {
            if (! isset($seen[$section['key']])) {
                $out[] = $section;
            }
        }

        $patch['sections'] = $out;

        return $patch;
    }

    /** A colour has to be a colour; anything else keeps what was there. */
    private function cleanBrand(array $patch, array $current): array
    {
        foreach (['ink', 'ivory', 'gold'] as $key) {
            if (array_key_exists($key, $patch) && ! preg_match('/^#[0-9a-fA-F]{6}$/', (string) $patch[$key])) {
                $patch[$key] = $current[$key];
            }
        }

        return $patch;
    }
}
