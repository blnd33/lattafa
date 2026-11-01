<?php

namespace Tests\Feature;

use Tests\TestCase;

/** One domain: the API and the three web apps (menu, POS, delegate) are served by this application. */
class ExampleTest extends TestCase
{
    public function test_the_domain_root_opens_the_pos(): void
    {
        $this->get('/')->assertRedirect('/pos/')->assertHeader('Location', '/pos/');
    }

    public function test_an_address_of_its_own_can_open_another_app(): void
    {
        // APP_HOME (e.g. one local port per app, scripts/serve.mjs): "/" opens that app, with its final slash kept
        config(['app.home' => 'menu']);
        $this->get('/')->assertHeader('Location', '/menu/');
        config(['app.home' => 'delegate']);
        $this->get('/')->assertHeader('Location', '/delegate/');
    }

    public function test_every_app_knows_where_the_others_are(): void
    {
        // one domain: just the paths
        $this->getJson('/api/v1/apps')->assertOk()->assertExactJson(['menu' => '/menu/', 'pos' => '/pos/', 'delegate' => '/delegate/', 'admin' => '/admin/']);
        // an address per app (e.g. one local port each)
        config(['app.addresses.pos' => 'http://localhost:8002/', 'app.addresses.admin' => 'http://localhost:8004/']);
        $this->getJson('/api/v1/apps')->assertJsonPath('pos', 'http://localhost:8002/')->assertJsonPath('admin', 'http://localhost:8004/')->assertJsonPath('menu', '/menu/');
    }

    public function test_the_app_pages_need_no_session(): void
    {
        // .env.example ships SESSION_DRIVER=database, but there is no sessions table: the pages must not touch it
        config(['session.driver' => 'database']);
        $res = $this->get('/')->assertRedirect('/pos/');
        $this->assertSame([], $res->headers->getCookies());
    }

    public function test_each_web_app_is_served_from_its_own_path(): void
    {
        $made = [];
        foreach (['pos', 'delegate', 'menu', 'admin'] as $app) {
            $file = public_path($app.'/index.html');
            if (! is_file($file)) { // not built in this checkout — use a stand-in page
                @mkdir(dirname($file), 0777, true);
                file_put_contents($file, "<!doctype html><title>$app</title>");
                $made[] = $file;
            }
        }
        try {
            foreach (['pos', 'delegate', 'menu', 'admin'] as $app) {
                $res = $this->get('/'.$app)->assertOk();
                $this->assertStringContainsString('text/html', (string) $res->headers->get('Content-Type'));
                $this->assertStringContainsString('<!doctype html>', strtolower((string) $res->baseResponse->getFile()->getContent()));
            }
            $this->get('/administrator')->assertNotFound(); // only the apps themselves
        } finally {
            foreach ($made as $f) {
                @unlink($f);
                @rmdir(dirname($f));
            }
        }
    }
}
