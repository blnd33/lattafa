<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;

/**
 * Intentionally empty. There is no built-in admin account: the shop owner creates the Super Admin (and,
 * if wanted, demo products) on first run through the POS setup screen or `POST /api/v1/setup`.
 */
class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        //
    }
}
