<?php

namespace App\Http\Controllers\Api\V1;

use App\Exceptions\AppException;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\Assistant\AssistantService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Admin panel → Assistant. Only for people holding `assistant.use`, and only from the admin panel: a till or a
 * delegate's phone signs in as a device and is refused, whoever is using it.
 */
class AssistantController extends Controller
{
    public function __construct(private AssistantService $assistant) {}

    /** Can this person use it here, and is it set up? */
    public function status(Request $r): JsonResponse
    {
        $this->gate($r->user(), $r);

        return response()->json(['configured' => AssistantService::configured(), 'model' => AssistantService::configured() ? AssistantService::model() : null]);
    }

    /**
     * `{messages: [{role: user|assistant, content}]}` — the conversation, ending with the new question. Answers with a
     * stream of JSON lines: {type: "tool", name} while it reads the figures, then {type: "answer", text} or
     * {type: "error", code}. The lines keep the connection busy, so a long answer is not cut by the web server.
     */
    public function chat(Request $r): StreamedResponse
    {
        $actor = $r->user();
        $this->gate($actor, $r);
        if (! AssistantService::configured()) {
            throw new AppException('assistant_not_configured', [], 503);
        }
        $d = $r->validate([
            'messages' => ['required', 'array', 'min:1', 'max:40'],
            'messages.*.role' => ['required', 'in:user,assistant'],
            'messages.*.content' => ['required', 'string', 'max:8000'],
        ]);
        $history = array_values($d['messages']);
        if (end($history)['role'] !== 'user' || $history[0]['role'] !== 'user') {
            throw new AppException('validation', ['field' => 'messages']);
        }

        return response()->stream(function () use ($actor, $history) {
            @set_time_limit(300);
            $send = function (array $event) {
                echo json_encode($event, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)."\n";
                if (ob_get_level() > 0) {
                    @ob_flush();
                }
                flush();
            };
            try {
                $this->assistant->answer($actor, $history, $send);
            } catch (AppException $e) {
                $send(['type' => 'error', 'code' => $e->errorCode]);
            } catch (\Throwable $e) {
                Log::error('assistant: the turn failed', ['error' => $e->getMessage(), 'at' => $e->getFile().':'.$e->getLine()]);
                $send(['type' => 'error', 'code' => 'assistant_failed']);
            }
        }, 200, [
            'Content-Type' => 'application/x-ndjson; charset=utf-8',
            'Cache-Control' => 'no-cache, no-store',
            'X-Accel-Buffering' => 'no', // Nginx passes each line on at once instead of holding the answer back
        ]);
    }

    private function gate(User $actor, Request $r): void
    {
        if (! $actor->can('assistant.use')) {
            throw AppException::forbidden('assistant.use');
        }
        // admin-panel sign-ins carry no device; tills and delegate phones are signed in as `device:<id>`
        if (str_starts_with((string) $actor->currentAccessToken()?->name, 'device:')) {
            throw new AppException('assistant_admin_only', [], 403);
        }
    }
}
