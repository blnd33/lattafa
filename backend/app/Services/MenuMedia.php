<?php

namespace App\Services;

use App\Exceptions\AppException;
use App\Models\User;
use App\Services\Concerns\RequiresPermission;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * The photos and videos behind the top of the customer menu (admin panel → Customer menu). With more than one they take
 * turns. They are uploaded in pieces of CHUNK bytes, so a video gets through any server's upload limit (PHP and Nginx
 * defaults are 2–20 MB), and a dropped connection can carry on where it stopped.
 *
 * Stored in settings `menu.hero` as [{id, type, path, poster}]; the files live on the public disk under menu/hero/.
 */
class MenuMedia
{
    use RequiresPermission;

    public const MAX_ITEMS = 6;

    public const CHUNK = 2 * 1024 * 1024;

    /** mime → [type, file extension] — only formats every phone browser can show */
    public const TYPES = [
        'image/jpeg' => ['image', 'jpg'], 'image/png' => ['image', 'png'], 'image/webp' => ['image', 'webp'],
        'video/mp4' => ['video', 'mp4'], 'video/webm' => ['video', 'webm'],
    ];

    public const LIMIT = ['image' => 10 * 1024 * 1024, 'video' => 60 * 1024 * 1024];

    private const PENDING = 'menu-uploads'; // on the private local disk

    public function __construct(private SettingsService $settings, private AuditService $audit) {}

    /** @return array<int, array{id: string, type: string, src: string, poster: string|null}> as the menu shows them */
    public function items(): array
    {
        return array_map(fn (array $m) => [
            'id' => $m['id'], 'type' => $m['type'], 'src' => self::url($m['path']), 'poster' => $m['poster'] ? self::url($m['poster']) : null,
        ], $this->stored());
    }

    /** Starts an upload. @return array{uploadId: string, chunkBytes: int} */
    public function start(User $actor, string $mime, int $size): array
    {
        $this->need($actor, 'settings.edit');
        [$type] = self::TYPES[$mime] ?? throw new AppException('media_type');
        if ($size < 1 || $size > self::LIMIT[$type]) {
            throw new AppException('media_too_big', ['mb' => self::LIMIT[$type] / 1024 / 1024]);
        }
        if (count($this->stored()) >= self::MAX_ITEMS) {
            throw new AppException('media_full', ['n' => self::MAX_ITEMS]);
        }
        $disk = Storage::disk('local');
        foreach ($disk->files(self::PENDING) as $old) { // uploads left unfinished for a day are thrown away
            if ($disk->lastModified($old) < time() - 86400) {
                $disk->delete($old);
            }
        }
        $id = (string) Str::uuid7();
        $disk->put(self::PENDING."/$id.json", json_encode(['mime' => $mime, 'size' => $size, 'user' => $actor->id]));
        $disk->put(self::PENDING."/$id.part", '');

        return ['uploadId' => $id, 'chunkBytes' => self::CHUNK];
    }

    /**
     * Adds the next piece. `$at` must be what the server already has (a repeated piece is simply refused with the right
     * place, so the browser can carry on from there). @param resource $body
     */
    public function append(User $actor, string $id, int $at, $body): int
    {
        [$meta, $part] = $this->pending($actor, $id);
        clearstatcache(true, $part);
        $have = filesize($part);
        if ($at !== $have) {
            throw new AppException('media_offset', ['at' => $have], 409);
        }
        $out = fopen($part, 'ab');
        $written = stream_copy_to_stream($body, $out, self::CHUNK + 1);
        fclose($out);
        clearstatcache(true, $part);
        if ($written === false || $written > self::CHUNK || filesize($part) > $meta['size']) {
            $this->drop($id);
            throw new AppException('media_broken');
        }

        return filesize($part);
    }

    /** Checks the whole file really is the photo/video it claimed to be, then puts it on the menu. */
    public function finish(User $actor, string $id, ?string $poster): void
    {
        [$meta, $part] = $this->pending($actor, $id);
        clearstatcache(true, $part);
        if (filesize($part) !== $meta['size']) {
            throw new AppException('media_broken');
        }
        $real = self::sniff($part);
        if ($real === null || self::TYPES[$real][0] !== self::TYPES[$meta['mime']][0]) {
            $this->drop($id);
            throw new AppException('media_type');
        }
        if (count($this->stored()) >= self::MAX_ITEMS) {
            $this->drop($id);
            throw new AppException('media_full', ['n' => self::MAX_ITEMS]);
        }
        [$type, $ext] = self::TYPES[$real];
        $path = "menu/hero/$id.$ext";
        $public = Storage::disk('public');
        $in = fopen($part, 'rb');
        $public->writeStream($path, $in);
        fclose($in);
        $this->drop($id);

        // a video's first frame, taken in the admin's browser: shown while the video loads (and instead of it on "data saver")
        $posterPath = null;
        if ($type === 'video' && $poster && preg_match('#^data:image/(jpeg|webp);base64,([A-Za-z0-9+/=]+)$#', $poster, $m)) {
            $bytes = base64_decode($m[2], true);
            if ($bytes !== false && strlen($bytes) <= 2 * 1024 * 1024 && self::sniffBytes($bytes) === 'image/'.$m[1]) {
                $posterPath = "menu/hero/$id-poster.".($m[1] === 'jpeg' ? 'jpg' : 'webp');
                $public->put($posterPath, $bytes);
            }
        }

        $this->save([...$this->stored(), ['id' => $id, 'type' => $type, 'path' => $path, 'poster' => $posterPath]], $actor);
        $this->audit->log($actor, 'menu.media_add', 'menu', $id, ['type' => $type, 'bytes' => $meta['size']]);
    }

    public function delete(User $actor, string $id): void
    {
        $this->need($actor, 'settings.edit');
        $items = $this->stored();
        $item = collect($items)->firstWhere('id', $id) ?? throw AppException::notFound();
        Storage::disk('public')->delete(array_filter([$item['path'], $item['poster']]));
        $this->save(array_values(array_filter($items, fn ($m) => $m['id'] !== $id)), $actor);
        $this->audit->log($actor, 'menu.media_delete', 'menu', $id, ['type' => $item['type']]);
    }

    /** Puts the photos/videos in the given order (ids not listed keep their place at the end). @param array<int, string> $ids */
    public function reorder(User $actor, array $ids): void
    {
        $this->need($actor, 'settings.edit');
        $items = $this->stored();
        $rank = array_flip($ids);
        usort($items, fn ($a, $b) => ($rank[$a['id']] ?? PHP_INT_MAX) <=> ($rank[$b['id']] ?? PHP_INT_MAX));
        $this->save($items, $actor);
        $this->audit->log($actor, 'menu.media_order', 'menu', 'hero', ['order' => array_column($items, 'id')]);
    }

    /** @return array<int, array{id: string, type: string, path: string, poster: string|null}> */
    private function stored(): array
    {
        return array_values($this->settings->get()['menu']['hero'] ?? []);
    }

    private function save(array $items, User $actor): void
    {
        // the list replaces the old one (lists are not merged), the other menu settings stay as they are
        $this->settings->update($actor, ['menu' => ['hero' => array_values($items)]], log: false); // the add/delete/order entry says it
    }

    /** @return array{0: array{mime: string, size: int, user: string}, 1: string} */
    private function pending(User $actor, string $id): array
    {
        $this->need($actor, 'settings.edit');
        $disk = Storage::disk('local');
        $meta = json_decode((string) $disk->get(self::PENDING."/$id.json"), true);
        if (! $meta || ! $disk->exists(self::PENDING."/$id.part") || $meta['user'] !== $actor->id) {
            throw AppException::notFound();
        }

        return [$meta, $disk->path(self::PENDING."/$id.part")];
    }

    private function drop(string $id): void
    {
        Storage::disk('local')->delete([self::PENDING."/$id.json", self::PENDING."/$id.part"]);
    }

    /** Same domain as the menu, so the address keeps working whatever APP_URL says. */
    private static function url(string $path): string
    {
        return '/storage/'.$path;
    }

    /** What the file really is, from its first bytes (never trusting the name or the browser). */
    private static function sniff(string $file): ?string
    {
        $h = fopen($file, 'rb');
        $head = (string) fread($h, 32);
        fclose($h);

        return self::sniffBytes($head);
    }

    private static function sniffBytes(string $b): ?string
    {
        return match (true) {
            str_starts_with($b, "\xFF\xD8\xFF") => 'image/jpeg',
            str_starts_with($b, "\x89PNG\r\n\x1A\n") => 'image/png',
            str_starts_with($b, 'RIFF') && substr($b, 8, 4) === 'WEBP' => 'image/webp',
            substr($b, 4, 4) === 'ftyp' && ! in_array(substr($b, 8, 4), ['qt  ', 'heic', 'heix', 'mif1', 'msf1'], true) => 'video/mp4',
            str_starts_with($b, "\x1A\x45\xDF\xA3") => 'video/webm',
            default => null,
        };
    }
}
