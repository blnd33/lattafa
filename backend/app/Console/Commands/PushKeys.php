<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Minishlink\WebPush\VAPID;

/** Makes the one pair of keys that lets the server notify phones. Run once, paste the two lines into .env. */
class PushKeys extends Command
{
    protected $signature = 'lattafa:push-keys';

    protected $description = 'Create the keys for phone notifications (prints two lines for .env)';

    public function handle(): int
    {
        if (config('push.public') && ! $this->option('no-interaction') && ! $this->confirm('Keys are already set. Making new ones stops every phone that is subscribed now. Carry on?', false)) {
            return self::SUCCESS;
        }
        $keys = VAPID::createVapidKeys();
        $this->newLine();
        $this->line('Paste these two lines into backend/.env, then run: php artisan optimize');
        $this->newLine();
        $this->line('VAPID_PUBLIC_KEY='.$keys['publicKey']);
        $this->line('VAPID_PRIVATE_KEY='.$keys['privateKey']);
        $this->newLine();
        $this->warn('Keep the private key secret. Changing it later unsubscribes every phone.');

        return self::SUCCESS;
    }
}
