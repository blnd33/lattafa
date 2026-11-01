<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Database\Connection;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Process;
use RuntimeException;
use Throwable;

/**
 * A full copy of the database, written to config('backup.path') as lattafa-YYYY-MM-DD-HHMMSS.dump (PostgreSQL,
 * pg_dump custom format) or .sqlite (SQLite). Runs every night through the scheduler (routes/console.php). Old copies
 * are removed only after a new one has succeeded, so a failing backup never eats the good ones.
 */
class Backup extends Command
{
    protected $signature = 'lattafa:backup';

    protected $description = 'Save a full copy of the database to the backups folder and remove old copies';

    /** lattafa-2026-10-09-030000.dump (a second backup in the same second: lattafa-2026-10-09-030000-2.dump) */
    private const NAME = '/^lattafa-(\d{4}-\d{2}-\d{2}-\d{6})(?:-\d+)?\.(dump|sqlite)$/';

    /** A name no earlier backup has: a failed run must never overwrite (and then delete) a good copy. */
    private function freshName(string $dir): string
    {
        $base = "{$dir}/lattafa-".now()->format('Y-m-d-His');
        for ($n = 1, $name = $base; File::exists("{$name}.dump") || File::exists("{$name}.sqlite"); $name = $base.'-'.(++$n));

        return $name;
    }

    public function handle(): int
    {
        $dir = rtrim((string) config('backup.path'), '/\\');
        try {
            File::ensureDirectoryExists($dir);
            $base = $this->freshName($dir);
            $conn = DB::connection();
            $file = match ($conn->getDriverName()) {
                'pgsql' => $this->pgDump($conn, "{$base}.dump"),
                'sqlite' => $this->sqliteCopy($conn, "{$base}.sqlite"),
                default => throw new RuntimeException("Backups of {$conn->getDriverName()} databases are not supported."),
            };
        } catch (Throwable $e) {
            report($e); // lands in the log, so a failing nightly backup does not go unnoticed
            $this->error('Backup FAILED: '.$e->getMessage());

            return self::FAILURE;
        }

        $removed = $this->prune($dir, basename($file));
        $this->info(sprintf('Backup saved: %s (%s).%s', $file, self::size((int) filesize($file)), $removed ? " {$removed} old backup(s) removed." : ''));

        return self::SUCCESS;
    }

    private function pgDump(Connection $conn, string $path): string
    {
        $cfg = $conn->getConfig();
        $result = Process::timeout(1800)
            ->env(['PGPASSWORD' => (string) ($cfg['password'] ?? '')]) // never on the command line, where other users could read it
            ->run([
                (string) config('backup.pg_dump'), '--format=custom', '--no-owner', '--no-privileges',
                '--host='.$cfg['host'], '--port='.$cfg['port'], '--username='.$cfg['username'], '--file='.$path, (string) $cfg['database'],
            ]);
        if (! $result->successful() || ! is_file($path) || filesize($path) === 0) {
            File::delete($path);
            throw new RuntimeException(trim($result->errorOutput()) ?: 'pg_dump did not finish.');
        }

        return $path;
    }

    private function sqliteCopy(Connection $conn, string $path): string
    {
        $db = (string) $conn->getConfig('database');
        if ($db === ':memory:' || $db === '') {
            throw new RuntimeException('The database only lives in memory: there is nothing to back up.');
        }
        // a consistent copy even while the shop is writing to it (unlike copying the file)
        $conn->statement('VACUUM INTO ?', [$path]);

        return $path;
    }

    /** Removes backups older than keep_days, judged by the date in their name; never the one just made. */
    private function prune(string $dir, string $keep): int
    {
        $cutoff = now()->subDays(max(1, (int) config('backup.keep_days')));
        $removed = 0;
        foreach (File::files($dir) as $f) {
            $name = $f->getFilename();
            if ($name === $keep || ! preg_match(self::NAME, $name, $m)) {
                continue;
            }
            if (Carbon::createFromFormat('Y-m-d-His', $m[1])->lt($cutoff) && File::delete($f->getPathname())) {
                $removed++;
            }
        }

        return $removed;
    }

    private static function size(int $bytes): string
    {
        return $bytes >= 1_048_576 ? round($bytes / 1_048_576, 1).' MB' : max(1, (int) round($bytes / 1024)).' KB';
    }
}
