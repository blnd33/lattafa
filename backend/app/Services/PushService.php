<?php

namespace App\Services;

use App\Models\PushSubscription;
use App\Models\User;
use App\Support\Time;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Minishlink\WebPush\Subscription;
use Minishlink\WebPush\WebPush;

/**
 * Notifications that reach a phone with the app closed (Web Push).
 *
 * Switched on by a pair of VAPID keys in the server's .env (`php artisan lattafa:push-keys` makes them). Without
 * them nothing is sent and nothing breaks — the bell inside the apps carries on as usual. Sending never throws:
 * a shop order must not fail because a phone is unreachable.
 */
class PushService
{
    public function enabled(): bool
    {
        return (bool) (config('push.public') && config('push.private'));
    }

    public function publicKey(): string
    {
        return (string) config('push.public');
    }

    /** Remembers this browser. The same endpoint twice is the same browser — kept as one row. */
    public function subscribe(User $user, array $sub, string $app = 'delegate'): void
    {
        PushSubscription::updateOrCreate(
            ['endpoint' => $sub['endpoint']],
            ['id' => (string) Str::uuid7(), 'user_id' => $user->id, 'p256dh' => $sub['p256dh'], 'auth' => $sub['auth'], 'app' => $app],
        );
    }

    public function unsubscribe(string $endpoint): void
    {
        PushSubscription::where('endpoint', $endpoint)->delete();
    }

    /**
     * Tells everyone who may work orders. `$userIds` null = all of them.
     *
     * @param array{title: string, body: string, url?: string, tag?: string} $message
     */
    public function notify(array $message, ?array $userIds = null): int
    {
        if (! $this->enabled()) {
            return 0;
        }
        $rows = PushSubscription::when($userIds, fn ($q) => $q->whereIn('user_id', $userIds))->get();
        if ($rows->isEmpty()) {
            return 0;
        }
        try {
            $push = new WebPush(['VAPID' => [
                'subject' => (string) config('app.url'),
                'publicKey' => (string) config('push.public'),
                'privateKey' => (string) config('push.private'),
            ]], [], 10);
            foreach ($rows as $row) {
                $push->queueNotification(
                    Subscription::create(['endpoint' => $row->endpoint, 'publicKey' => $row->p256dh, 'authToken' => $row->auth, 'contentEncoding' => 'aesgcm']),
                    json_encode($message, JSON_UNESCAPED_UNICODE),
                );
            }
            $sent = 0;
            foreach ($push->flush() as $report) {
                if ($report->isSuccess()) {
                    $sent++;
                } elseif ($report->isSubscriptionExpired()) {
                    // the phone was wiped or the app removed: stop writing to a dead address
                    $this->unsubscribe($report->getRequest()->getUri()->__toString());
                }
            }
            PushSubscription::whereIn('id', $rows->pluck('id'))->update(['last_sent_at' => Time::nowMs()]);

            return $sent;
        } catch (\Throwable $e) {
            Log::warning('push failed: '.$e->getMessage());

            return 0;
        }
    }
}
