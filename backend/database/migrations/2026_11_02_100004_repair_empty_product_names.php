<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Editing a product whose name was empty in some language used to save that language as null, and one such product
 * made the POS, the admin panel and their stock screens show an empty catalogue. Those languages become empty text
 * again; `updated_at` moves on so every till and phone receives the repaired product at its next sync.
 */
return new class extends Migration
{
    public function up(): void
    {
        $text = fn (?array $t) => array_replace(['en' => '', 'ar' => '', 'ku' => ''], array_filter($t ?? [], fn ($x) => $x !== null));
        foreach (DB::table('products')->get(['id', 'name', 'description']) as $p) {
            $name = json_decode((string) $p->name, true);
            $description = json_decode((string) $p->description, true);
            if (isset($name['en'], $name['ar'], $name['ku'], $description['en'], $description['ar'], $description['ku'])) {
                continue; // isset is false for a null: every language here is already text
            }
            DB::table('products')->where('id', $p->id)->update([
                'name' => json_encode($text($name)), // written the way the model's array cast writes it
                'description' => json_encode($text($description)),
                'updated_at' => now(),
            ]);
        }
    }

    /** Nothing to undo: the empty text is what these products should always have held. */
    public function down(): void {}
};
