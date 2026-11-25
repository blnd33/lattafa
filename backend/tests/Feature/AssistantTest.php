<?php

namespace Tests\Feature;

use Anthropic\Client;
use GuzzleHttp\Psr7\Response;
use Psr\Http\Client\ClientInterface;
use Psr\Http\Message\RequestInterface;
use Psr\Http\Message\ResponseInterface;
use Tests\ApiTestCase;

/**
 * Admin panel → Assistant. Claude is replaced by a fake that answers from a script, so these tests check what the
 * shop sends and does — the questions, the tools, the figures, who may use it — without a key or the network.
 */
class AssistantTest extends ApiTestCase
{
    /** @var array<int, array<string, mixed>> what the fake Claude received, one decoded body per call */
    private array $sent = [];

    /** @param array<int, array<string, mixed>> $replies the fake Claude's answers, in order (Messages API JSON) */
    private function claude(array $replies, int $status = 200): void
    {
        config(['services.anthropic.key' => 'sk-ant-api03-test-key-'.str_repeat('x', 40), 'services.anthropic.model' => 'claude-opus-5-5']);
        $fake = new class($replies, $status, $this->sent) implements ClientInterface
        {
            public function __construct(private array $replies, private int $status, private array &$sent) {}

            public function sendRequest(RequestInterface $request): ResponseInterface
            {
                $this->sent[] = json_decode((string) $request->getBody(), true) + ['_headers' => $request->getHeaders()];
                $body = array_shift($this->replies) ?? ['type' => 'error', 'error' => ['type' => 'api_error', 'message' => 'no more replies']];

                return new Response($this->status, ['Content-Type' => 'application/json'], json_encode($body));
            }
        };
        $this->app->bind(Client::class, fn () => new Client(apiKey: 'sk-ant-test', requestOptions: ['transporter' => $fake, 'maxRetries' => 0]));
    }

    private static function reply(array $content, string $stop = 'end_turn'): array
    {
        return ['id' => 'msg_'.uniqid(), 'type' => 'message', 'role' => 'assistant', 'model' => 'claude-opus-5-5', 'content' => $content,
            'stop_reason' => $stop, 'stop_sequence' => null, 'usage' => ['input_tokens' => 1200, 'output_tokens' => 80, 'cache_read_input_tokens' => 900]];
    }

    /** The admin panel signs in with a password and no device. */
    private function asAdminPanel(string $username = 'owner', string $password = 'Owner1234'): void
    {
        $res = $this->api('POST', 'auth/login', ['username' => $username, 'password' => $password, 'app' => 'admin'], [])->assertOk();
        $this->auth = ['Authorization' => 'Bearer '.$res->json('token')];
    }

    /** @return array<int, array<string, mixed>> the streamed lines */
    private function ask(array $messages): array
    {
        $res = $this->api('POST', 'assistant/chat', ['messages' => $messages])->assertOk();

        return array_map(fn ($l) => json_decode($l, true), array_values(array_filter(explode("\n", $res->streamedContent()))));
    }

    public function test_it_answers_from_the_live_figures(): void
    {
        $this->shop();
        $kh = $this->variantOf('Khamrah');
        $this->cashierWithShift();
        $this->checkout($kh, 3, [['method' => 'cash_iqd', 'tendered' => 3 * $kh->retail_iqd]])->assertCreated();
        $this->asAdminPanel();
        $today = now(config('app.timezone'))->format('Y-m-d');

        $this->claude([
            self::reply([
                ['type' => 'text', 'text' => 'Let me check.'],
                ['type' => 'tool_use', 'id' => 'tu_1', 'name' => 'run_report', 'input' => ['report' => 'sales-by-product', 'from' => $today, 'to' => $today]],
                ['type' => 'tool_use', 'id' => 'tu_2', 'name' => 'get_overview', 'input' => ['period' => 'today']],
            ], 'tool_use'),
            self::reply([['type' => 'text', 'text' => 'Khamrah is your best seller today: 3 bottles.']]),
        ]);

        $lines = $this->ask([['role' => 'user', 'content' => 'What is my best seller today?']]);
        $this->assertSame([['type' => 'tool', 'name' => 'run_report'], ['type' => 'tool', 'name' => 'get_overview']], array_slice($lines, 0, 2));
        $this->assertSame(['answer', 'Khamrah is your best seller today: 3 bottles.'], [$lines[2]['type'], $lines[2]['text']]);
        $this->assertSame(2400, $lines[2]['usage']['input']);

        // what went to Claude: the model, caching, refusal fallbacks, the tools, today's date after the question
        $first = $this->sent[0];
        $this->assertSame(['claude-opus-5-5', 'default', 'medium'], [$first['model'], $first['fallbacks'], $first['output_config']['effort']]);
        $this->assertSame(['type' => 'ephemeral'], $first['cache_control']);
        $this->assertContains('server-side-fallback-2026-07-01', explode(',', $first['_headers']['anthropic-beta'][0] ?? ''));
        $this->assertContains('run_report', array_column($first['tools'], 'name'));
        $this->assertSame('system', end($first['messages'])['role']);
        $this->assertStringContainsString("Today is $today", end($first['messages'])['content']);

        // both tool results came back together, with the real figures
        $results = end($this->sent[1]['messages'])['content'];
        $this->assertSame(['tu_1', 'tu_2'], array_column($results, 'tool_use_id'));
        $report = json_decode($results[0]['content'], true);
        $row = collect($report['rows'])->firstWhere('sku', $kh->sku);
        $this->assertSame([3, 3 * $kh->retail_iqd], [$row['units'], $row['revenue']]);
        $this->assertSame(3 * $kh->retail_iqd, json_decode($results[1]['content'], true)['totals']['revenueIQD']);
    }

    public function test_a_tool_the_person_may_not_use_is_explained_not_shown(): void
    {
        $this->shop();
        $role = $this->api('POST', 'roles', ['name' => 'Asker', 'description' => '', 'permissions' => ['assistant.use', 'reports.view'], 'apps' => ['admin']])->assertCreated()->json('role.id');
        $this->makeUser('Lana', 'lana', 'cashier', '4242', ['roleId' => $role]);
        $this->asAdminPanel('lana', 'Passw0rd!x');
        $this->claude([
            self::reply([['type' => 'tool_use', 'id' => 'tu_1', 'name' => 'run_report', 'input' => ['report' => 'profit-loss', 'from' => '2026-11-01', 'to' => '2026-11-25']]], 'tool_use'),
            self::reply([['type' => 'text', 'text' => 'You do not have access to profit.']]),
        ]);
        $lines = $this->ask([['role' => 'user', 'content' => 'What was my profit this month?']]);
        $this->assertSame('answer', end($lines)['type']);
        $result = end($this->sent[1]['messages'])['content'][0];
        $this->assertTrue($result['is_error']);
        $this->assertStringContainsString('reports.financial', $result['content']);
        $this->assertStringNotContainsString('net_profit', $result['content']);
    }

    public function test_only_the_admin_panel_and_only_those_allowed(): void
    {
        $this->shop();
        $this->claude([]);
        // the owner on a till (a device sign-in) is refused, even with every permission
        $this->api('GET', 'assistant/status')->assertStatus(403)->assertJsonPath('error.code', 'assistant_admin_only');
        $this->api('POST', 'assistant/chat', ['messages' => [['role' => 'user', 'content' => 'hi']]])->assertStatus(403);

        // an admin-panel role without the permission is refused
        $role = $this->api('POST', 'roles', ['name' => 'Viewer', 'description' => '', 'permissions' => ['reports.view'], 'apps' => ['admin']])->assertCreated()->json('role.id');
        $this->makeUser('Dara', 'dara', 'cashier', '4343', ['roleId' => $role]);
        $this->asAdminPanel('dara', 'Passw0rd!x');
        $this->api('GET', 'assistant/status')->assertStatus(403)->assertJsonPath('error.params.permission', 'assistant.use');

        // the owner in the admin panel may; without a key it says it is not set up
        $this->asAdminPanel();
        $this->api('GET', 'assistant/status')->assertOk()->assertJsonPath('configured', true)->assertJsonPath('model', 'claude-opus-5-5');
        config(['services.anthropic.key' => '']);
        $this->api('GET', 'assistant/status')->assertOk()->assertJsonPath('configured', false);
        config(['services.anthropic.key' => 'sk-ant-...']);                                   // the placeholder from the guide
        $this->api('GET', 'assistant/status')->assertOk()->assertJsonPath('configured', false);
        $this->api('POST', 'assistant/chat', ['messages' => [['role' => 'user', 'content' => 'hi']]])->assertStatus(503)->assertJsonPath('error.code', 'assistant_not_configured');
    }

    public function test_every_tool_reads_the_shop(): void
    {
        $this->shop();
        $kh = $this->variantOf('Khamrah');
        $noor = $this->customerNamed('Al-Noor Perfumes');
        $this->cashierWithShift();
        $this->checkout($kh, 1, [['method' => 'debt', 'tendered' => $kh->retail_iqd]], ['customerId' => $noor->id])->assertCreated();
        $this->asAdminPanel();
        $owner = \App\Models\User::where('username', 'owner')->first();
        $tools = app(\App\Services\Assistant\AssistantTools::class);
        $today = now(config('app.timezone'))->format('Y-m-d');
        $run = function (string $name, array $in) use ($tools, $owner) {
            [$json, $error] = $tools->run($owner, $name, $in);
            $this->assertFalse($error, "$name: $json");

            return json_decode($json, true);
        };

        $this->assertSame($kh->retail_iqd, $run('get_overview', ['period' => 'today'])['totals']['creditIQD']);
        foreach (array_keys(\App\Services\ReportCenter::REPORTS) as $report) {
            $this->assertArrayHasKey('rows', $run('run_report', ['report' => $report, 'from' => $today, 'to' => $today]), $report);
        }
        $this->assertGreaterThan(0, $run('get_debts', ['period' => 'month'])['receivable']['totalIQD']);
        $this->assertSame(0, $run('get_expenses', ['from' => '2000-01-01', 'to' => $today])['count']);
        $p = $run('find_products', ['query' => 'khamrah']);
        $this->assertSame('Khamrah', $p['products'][0]['name']);
        $this->assertArrayHasKey('costIQD', $p['products'][0]['sizes'][0]);            // the owner may see costs
        $c = $run('find_customers', ['query' => 'Al-Noor', 'owing_only' => false]);
        $this->assertSame([1, $noor->fresh()->balance_iqd], [$c['count'], $c['customers'][0]['owesIQD']]);
        $this->assertSame('sale', $c['statement'][0]['kind']);
        $this->assertArrayHasKey('delegates', $run('get_delegates', ['name' => '', 'from' => $today, 'to' => $today]));
        $this->assertSame(0, $run('get_wholesale_orders', ['status' => '', 'query' => ''])['count']);

        // wrong input is reported to the model, never thrown
        [$json, $error] = $tools->run($owner, 'run_report', ['report' => 'sales-by-day', 'from' => 'yesterday', 'to' => $today]);
        $this->assertTrue($error);
        $this->assertStringContainsString('YYYY-MM-DD', $json);
        $this->assertTrue($tools->run($owner, 'delete_everything', [])[1]);
    }

    public function test_bad_requests_and_api_errors(): void
    {
        $this->shop();
        $this->asAdminPanel();
        $this->claude([]);
        $this->api('POST', 'assistant/chat', ['messages' => [['role' => 'assistant', 'content' => 'hi']]])->assertStatus(422);
        $this->api('POST', 'assistant/chat', ['messages' => [['role' => 'user', 'content' => str_repeat('x', 8001)]]])->assertStatus(422);

        // a refused key becomes a message the screen can explain
        $this->claude([['type' => 'error', 'error' => ['type' => 'authentication_error', 'message' => 'invalid x-api-key']]], 401);
        $this->assertSame([['type' => 'error', 'code' => 'assistant_bad_key']], $this->ask([['role' => 'user', 'content' => 'hi']]));
    }
}
