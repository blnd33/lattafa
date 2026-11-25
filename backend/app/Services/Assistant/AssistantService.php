<?php

namespace App\Services\Assistant;

use Anthropic\Beta\Messages\BetaMessage;
use Anthropic\Beta\Messages\BetaToolUseBlock;
use Anthropic\Client;
use Anthropic\Core\Exceptions\APIConnectionException;
use Anthropic\Core\Exceptions\APIStatusException;
use Anthropic\Core\Exceptions\AuthenticationException;
use Anthropic\Core\Exceptions\PaymentRequiredException;
use Anthropic\Core\Exceptions\PermissionDeniedException;
use Anthropic\Core\Exceptions\RateLimitException;
use App\Exceptions\AppException;
use App\Models\User;
use App\Support\Time;
use Illuminate\Support\Facades\Log;

/**
 * Admin panel → Assistant: the owner asks about the shop in their own words (English, Arabic or Kurdish) and Claude
 * answers from the live figures, which it reads through {@see AssistantTools} as the person asking.
 *
 * The conversation is kept by the browser and sent whole with every question (text only); this class runs one turn:
 * ask the model, run the tools it asks for, give it the results, until it answers. Nothing here can change data.
 */
class AssistantService
{
    /** a turn that keeps asking for tools is stopped after this many rounds */
    private const MAX_ROUNDS = 10;

    /** models that take server-side refusal fallbacks (`fallbacks: "default"`) */
    private const FALLBACK_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-2', 'claude-fable-5-1', 'claude-opus-5'];

    private const SYSTEM = <<<'TXT'
You are the business assistant inside the admin panel of Lattafa, a perfume shop in Duhok, Iraq. The shop sells
Lattafa and other Arabic perfumes in the shop (point of sale), through field delegates who sell to other shops from
their vans, and through a wholesale catalogue where shops abroad order. You answer the owner's and managers'
questions about how the business is doing: sales, best and worst sellers, profit, stock, debts both ways, expenses,
delegates, customers and wholesale orders.

How to work:
- Every figure you give must come from the tools, fetched for this question. Never estimate or remember a number.
  If the tools cannot answer something, say what is missing.
- Pick the period the question means. "Today", "this week" and "this month" are in the shop's calendar; the current
  date and time are given in a system message. When the question names no period, use a sensible one and say which.
- When a tool reports a missing permission, tell the person they cannot see that part; do not work around it.
- You can only read. If asked to change something (a price, a sale, stock), explain where in the admin panel to do it.

How to answer:
- Answer in the language of the question: English, Arabic, or Kurdish (Sorani, Arabic script).
- Lead with the answer, then the few figures that support it. Keep it short; offer to go deeper.
- Money is in Iraqi dinars unless a figure is in dollars: write "1,250,000 IQD" or "$1,250.50", digits as 0-9 in
  every language, with thousands separators.
- Use a small Markdown table only when comparing several items; otherwise short paragraphs or bullet points.
- "Sales" includes bills sold on debt; when it matters, say how much was paid and how much went on customers' accounts.
- Point out what needs attention (low stock, old debts, sizes sold without a cost price, which makes profit wrong).
TXT;

    public function __construct(private AssistantTools $tools) {}

    /** Is a key configured on the server? */
    public static function configured(): bool
    {
        return (string) config('services.anthropic.key') !== '';
    }

    public static function model(): string
    {
        return (string) config('services.anthropic.model', 'claude-opus-5-5');
    }

    /**
     * One question. `$history` is the conversation so far, oldest first, ending with the new question:
     * [{role: user|assistant, content: string}]. `$emit` receives progress events as the turn runs:
     * {type: "tool", name} before each tool runs, then {type: "answer", text, usage} at the end.
     *
     * @param  array<int, array{role: string, content: string}>  $history
     * @param  callable(array<string, mixed>): void  $emit
     */
    public function answer(User $actor, array $history, callable $emit): void
    {
        $client = app(Client::class);
        $messages = array_map(fn ($m) => ['role' => $m['role'], 'content' => $m['content']], $history);
        // the date changes every minute, so it goes after the question rather than in the (cached) system prompt
        $now = Time::at(Time::nowMs());
        $messages[] = ['role' => 'system', 'content' => 'Now: '.$now->format('l j F Y, H:i').' shop time ('.config('app.timezone').'). '
            .'Today is '.$now->format('Y-m-d').'. Asked by '.$actor->name.' ('.($actor->role->name ?? 'user').').'];

        $usage = ['input' => 0, 'output' => 0, 'cacheRead' => 0];
        for ($round = 1; ; $round++) {
            $response = $this->ask($client, $messages);
            $usage['input'] += (int) $response->usage->inputTokens;
            $usage['output'] += (int) $response->usage->outputTokens;
            $usage['cacheRead'] += (int) ($response->usage->cacheReadInputTokens ?? 0);

            if ($response->stopReason === 'refusal') {
                throw new AppException('assistant_refused', [], 422);
            }
            $calls = array_values(array_filter($response->content, fn ($b) => $b instanceof BetaToolUseBlock));
            if ($response->stopReason !== 'tool_use' || ! $calls) {
                $text = $this->text($response);
                if ($response->stopReason === 'max_tokens') {
                    $text .= "\n\n…";
                }
                $emit(['type' => 'answer', 'text' => $text, 'usage' => $usage]);

                return;
            }
            if ($round >= self::MAX_ROUNDS) {
                $emit(['type' => 'answer', 'text' => $this->text($response) ?: '…', 'usage' => $usage, 'stopped' => true]);

                return;
            }

            // every tool the model asked for in this round, answered together in one message
            $results = [];
            foreach ($calls as $call) {
                $emit(['type' => 'tool', 'name' => $call->name]);
                [$content, $isError] = $this->tools->run($actor, $call->name, (array) $call->input);
                $results[] = ['type' => 'tool_result', 'toolUseID' => $call->id, 'content' => $content] + ($isError ? ['isError' => true] : []);
            }
            $messages[] = ['role' => 'assistant', 'content' => $response->content];
            $messages[] = ['role' => 'user', 'content' => $results];
        }
    }

    private function ask(Client $client, array $messages): BetaMessage
    {
        $model = self::model();
        $fallback = in_array($model, self::FALLBACK_MODELS, true);
        try {
            return $client->beta->messages->create(
                maxTokens: 16000,
                messages: $messages,
                model: $model,
                // tools and the system prompt never change, so everything up to the conversation is read from the cache
                cacheControl: ['type' => 'ephemeral'],
                fallbacks: $fallback ? 'default' : null,
                outputConfig: ['effort' => (string) config('services.anthropic.effort', 'medium')],
                system: [['type' => 'text', 'text' => self::SYSTEM]],
                tools: $this->tools->definitions(),
                betas: $fallback ? ['server-side-fallback-2026-07-01'] : null,
            );
        } catch (AuthenticationException|PermissionDeniedException $e) {
            Log::warning('assistant: the API key was refused', ['error' => $e->getMessage()]);
            throw new AppException('assistant_bad_key', [], 503);
        } catch (PaymentRequiredException $e) {
            throw new AppException('assistant_no_credit', [], 503);
        } catch (RateLimitException $e) {
            throw new AppException('assistant_busy', [], 503);
        } catch (APIStatusException $e) {
            Log::error('assistant: the API answered with an error', ['status' => $e->status ?? null, 'error' => $e->getMessage()]);
            throw new AppException('assistant_failed', [], 503);
        } catch (APIConnectionException $e) {
            throw new AppException('assistant_unreachable', [], 503);
        }
    }

    private function text(BetaMessage $m): string
    {
        $parts = [];
        foreach ($m->content as $block) {
            if (($block->type ?? null) === 'text') {
                $parts[] = $block->text;
            }
        }

        return trim(implode("\n\n", $parts));
    }
}
