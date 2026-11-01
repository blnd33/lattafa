<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use PDO;
use Tests\TestCase;

/**
 * `php artisan lattafa:backup` against a real database file (not the in-memory test database, which has nothing to copy).
 * Runs whatever database the suite runs on: with PostgreSQL it also makes a real pg_dump when one can be found.
 */
class BackupTest extends TestCase
{
    private string $dir;

    protected function setUp(): void
    {
        parent::setUp();
        $this->dir = sys_get_temp_dir().'/lattafa-backup-test-'.uniqid();
        File::ensureDirectoryExists($this->dir.'/backups');
        config(['backup.path' => $this->dir.'/backups', 'backup.keep_days' => 14]);
    }

    protected function tearDown(): void
    {
        DB::disconnect();
        File::deleteDirectory($this->dir);
        parent::tearDown();
    }

    private function useSqliteFile(): void
    {
        touch($this->dir.'/shop.sqlite');
        config(['database.default' => 'sqlite', 'database.connections.sqlite.database' => $this->dir.'/shop.sqlite']);
        DB::purge('sqlite');
        $this->artisan('migrate', ['--force' => true])->assertSuccessful();
        DB::table('settings')->insert(['key' => 'backup-probe', 'value' => json_encode('kept')]);
    }

    private function backups(): array
    {
        return collect(File::files($this->dir.'/backups'))->map->getFilename()->sort()->values()->all();
    }

    public function test_a_full_copy_is_saved_and_old_copies_are_removed(): void
    {
        $this->useSqliteFile();
        $old = 'lattafa-'.now()->subDays(20)->format('Y-m-d-His').'.sqlite';
        $recent = 'lattafa-'.now()->subDays(3)->format('Y-m-d-His').'.sqlite';
        foreach ([$old, $recent, 'notes.txt'] as $f) {
            file_put_contents($this->dir.'/backups/'.$f, 'x');
        }

        $this->artisan('lattafa:backup')->expectsOutputToContain('KB). 1 old backup(s) removed.')->assertSuccessful();

        $files = $this->backups();
        $this->assertNotContains($old, $files);          // past the 14 days
        $this->assertContains($recent, $files);           // still inside them
        $this->assertContains('notes.txt', $files);       // not ours: never touched
        $new = collect($files)->first(fn ($f) => preg_match('/^lattafa-\d{4}-\d{2}-\d{2}-\d{6}\.sqlite$/', $f) && $f !== $recent);
        $this->assertNotNull($new);

        // the copy is a complete, working database
        $copy = new PDO('sqlite:'.$this->dir.'/backups/'.$new);
        $this->assertSame('"kept"', $copy->query("select value from settings where key = 'backup-probe'")->fetchColumn());
        $this->assertGreaterThan(20, (int) $copy->query("select count(*) from sqlite_master where type = 'table'")->fetchColumn());
        $copy = null;
    }

    public function test_a_failed_backup_says_so_and_keeps_the_old_copies(): void
    {
        config(['database.default' => 'sqlite', 'database.connections.sqlite.database' => ':memory:']);
        DB::purge('sqlite');
        $old = 'lattafa-'.now()->subDays(20)->format('Y-m-d-His').'.sqlite';
        file_put_contents($this->dir.'/backups/'.$old, 'x');

        $this->artisan('lattafa:backup')->expectsOutputToContain('Backup FAILED')->assertFailed();
        $this->assertSame([$old], $this->backups());
    }

    public function test_a_second_backup_in_the_same_second_never_replaces_the_first(): void
    {
        $this->useSqliteFile();
        $this->travelTo(now()->startOfSecond()); // the clock stands still: both runs get the same time stamp
        $this->artisan('lattafa:backup')->assertSuccessful();
        $this->artisan('lattafa:backup')->assertSuccessful();
        $files = $this->backups();
        $this->assertCount(2, $files);
        $this->assertCount(1, preg_grep('/^lattafa-\d{4}-\d{2}-\d{2}-\d{6}-2\.sqlite$/', $files)); // the second got its own name

        // and a failing third run removes only its own half-made file
        config(['database.connections.sqlite.database' => ':memory:']);
        DB::purge('sqlite');
        $this->artisan('lattafa:backup')->assertFailed();
        $this->assertSame($files, $this->backups());
    }

    public function test_postgresql_is_saved_with_pg_dump(): void
    {
        if (config('database.default') !== 'pgsql') {
            $this->markTestSkipped('The suite runs on SQLite; run it on PostgreSQL to check pg_dump.');
        }
        $this->artisan('migrate', ['--force' => true])->assertSuccessful();
        exec(escapeshellarg((string) config('backup.pg_dump')).' --version 2>&1', $out, $code);
        if ($code !== 0) {
            $this->markTestSkipped('pg_dump was not found; set BACKUP_PG_DUMP to its full path.');
        }

        $this->artisan('lattafa:backup')->expectsOutputToContain('Backup saved')->assertSuccessful();
        [$file] = $this->backups();
        $this->assertMatchesRegularExpression('/^lattafa-\d{4}-\d{2}-\d{2}-\d{6}\.dump$/', $file);
        $this->assertSame('PGDMP', file_get_contents($this->dir.'/backups/'.$file, false, null, 0, 5)); // pg_dump's own format

        config(['database.connections.pgsql.password' => 'wrong-on-purpose', 'database.connections.pgsql.database' => 'no_such_database']);
        DB::purge('pgsql');
        $this->artisan('lattafa:backup')->expectsOutputToContain('Backup FAILED')->assertFailed();
        $this->assertSame([$file], $this->backups()); // the half-made file was cleaned up
    }
}
