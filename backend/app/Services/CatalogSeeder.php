<?php

namespace App\Services;

use App\Models\Customer;
use App\Models\Product;
use App\Models\User;
use App\Models\Variant;
use Illuminate\Support\Str;

/**
 * Optional demo catalogue (offered at setup) so a new shop can try everything straight away.
 * All names, prices and stock levels are sample data — identical to the POS demo data.
 */
class CatalogSeeder
{
    public function __construct(private StockService $stock, private Counters $counters) {}

    /** [id, en, ar, ku, brand, gender, category, conc, families, season, longevity, sillage, sizes[[ml,label?,retail,wholesale,cost,stock,min?]], c1, c2, shape, notes[top,heart,base], desc[en,ar,ku], featured, new] */
    private function seeds(): array
    {
        return [
            ['khamrah', 'Khamrah', 'خمرة', 'خەمرە', 'Lattafa', 'unisex', 'perfume', 'EDP', ['oriental', 'sweet'], 'winter', 5, 4, [[100, null, 45000, 36000, 27000, 14], [50, null, 30000, 24000, 18000, 6]], '#8B4A2B', '#3A1E12', 'rect', [['cinnamon', 'bergamot', 'cardamom'], ['dates', 'praline', 'rose'], ['vanilla', 'amber', 'sandalwood']], ['A warm gourmand of cinnamon, dates and praline melting into creamy vanilla and amber.', 'عطر دافئ شهي من القرفة والتمر والبرالين يذوب في الفانيليا الكريمية والعنبر.', 'بۆنێکی گەرم و شیرین لە دارچین و خورما و پرالین کە دەتوێتەوە لە ڤانیلیای کرێمی و ئەمبەر.'], true, false],
            ['asad', 'Asad', 'أسد', 'ئەسەد', 'Lattafa', 'men', 'perfume', 'EDP', ['oriental', 'woody'], 'winter', 5, 4, [[100, null, 42000, 33500, 25000, 9]], '#3B3530', '#0F0D0B', 'tall', [['pepper', 'tobacco'], ['coffee', 'iris'], ['vanilla', 'amber', 'patchouli']], ['Bold and magnetic: black pepper and tobacco over coffee, iris and a smooth vanilla-amber base.', 'جريء وجذاب: فلفل أسود وتبغ فوق القهوة والزنبق وقاعدة ناعمة من الفانيليا والعنبر.', 'بوێر و ڕاکێش: بیبەری ڕەش و تووتن لەسەر قاوە و ئیریس و بنکەیەکی نەرمی ڤانیلیا و ئەمبەر.'], true, false],
            ['yara', 'Yara', 'يارا', 'یارا', 'Lattafa', 'women', 'perfume', 'EDP', ['floral', 'sweet'], 'all', 4, 3, [[100, null, 38000, 30000, 22000, 22], [50, null, 26000, 20500, 15000, 6]], '#F2BCCB', '#C77A9A', 'round', [['orchid', 'tangerine'], ['jasmine', 'pineapple'], ['vanilla', 'musk', 'sandalwood']], ['Soft, dreamy and feminine: orchid and tangerine wrapped in creamy vanilla musk.', 'ناعم وحالم وأنثوي: أوركيد ويوسفي في مسك الفانيليا الكريمي.', 'نەرم و خەیاڵاوی و ژنانە: ئۆرکید و نارنگی لە میسکی ڤانیلیای کرێمیدا.'], true, true],
            ['fakhar', 'Fakhar Black', 'فخر بلاك', 'فەخر بلاک', 'Lattafa', 'men', 'perfume', 'EDP', ['fresh', 'woody'], 'all', 4, 4, [[100, null, 44000, 35000, 26000, 11]], '#27365C', '#0B1020', 'rect', [['bergamot', 'mint', 'apple'], ['lavender', 'iris'], ['patchouli', 'amber', 'musk']], ['Fresh and refined: bergamot, mint and apple with lavender, iris and a woody amber base.', 'منعش وراقٍ: برغموت ونعناع وتفاح مع اللافندر والزنبق وقاعدة خشبية عنبرية.', 'فێنک و پەسەند: بێرگاموت و نەعنا و سێو لەگەڵ لاڤەندەر و ئیریس و بنکەیەکی داری ئەمبەری.'], false, false],
            ['raghba', 'Raghba', 'رغبة', 'ڕەغبە', 'Lattafa', 'unisex', 'perfume', 'EDP', ['oriental', 'sweet'], 'winter', 4, 4, [[100, null, 36000, 28000, 21000, 3, 5]], '#B5442F', '#5E1E14', 'flask', [['saffron', 'incense'], ['rose'], ['vanilla', 'oud', 'musk']], ['Saffron and incense open onto a deep heart of rose, resting on vanilla, oud and musk.', 'زعفران وبخور يفتحان على قلب عميق من الورد، فوق الفانيليا والعود والمسك.', 'زەعفەران و بەخوور دەکرێنەوە بۆ دڵێکی قووڵی ڕۆز، لەسەر ڤانیلیا و عود و میسک.'], false, false],
            ['badee', "Bade'e Al Oud", 'بديع العود', 'بەدیع ئەلعود', 'Lattafa Pride', 'unisex', 'oud', 'EDP', ['oud', 'woody'], 'winter', 5, 5, [[100, null, 48000, 38500, 29000, 7]], '#8A6A38', '#2E2010', 'tall', [['saffron', 'cardamom'], ['oud', 'rose'], ['patchouli', 'amber', 'musk']], ['Regal oud with saffron and cardamom, deepened by rose, patchouli and warm amber.', 'عود ملكي مع الزعفران والهيل، يزداد عمقاً بالورد والباتشولي والعنبر الدافئ.', 'عودی شاهانە لەگەڵ زەعفەران و هێل، قووڵتر دەبێت بە ڕۆز و پاچۆلی و ئەمبەری گەرم.'], true, false],
            ['ana', 'Ana Abiyedh', 'أنا أبيض', 'ئەنا ئەبیەز', 'Lattafa', 'unisex', 'perfume', 'EDP', ['fresh', 'floral'], 'summer', 3, 3, [[60, null, 30000, 24000, 18000, 12]], '#F6F1E6', '#CFC3A8', 'round', [['bergamot', 'mint'], ['jasmine', 'lavender'], ['musk', 'amber']], ['Clean and luminous: bergamot and mint over jasmine and lavender, settling into soft musk.', 'نقي ومضيء: برغموت ونعناع فوق الياسمين واللافندر، ويستقر على مسك ناعم.', 'پاک و ڕووناک: بێرگاموت و نەعنا لەسەر یاسمین و لاڤەندەر، دەنیشێتەوە لەسەر میسکی نەرم.'], false, true],
            ['eclaire', 'Eclaire', 'إكلير', 'ئیکلێر', 'Lattafa', 'women', 'perfume', 'EDP', ['sweet', 'oriental'], 'all', 4, 3, [[100, null, 40000, 32000, 24000, 5]], '#EBBB70', '#A8702B', 'rect', [['caramel', 'tangerine'], ['jasmine', 'rose'], ['vanilla', 'musk', 'sandalwood']], ['Sweet caramel and tangerine with jasmine and rose, finishing on vanilla and musk.', 'كراميل حلو ويوسفي مع الياسمين والورد، ينتهي بالفانيليا والمسك.', 'کارامێلی شیرین و نارنگی لەگەڵ یاسمین و ڕۆز، کۆتایی دێت بە ڤانیلیا و میسک.'], false, true],
            ['qaed', 'Qaed Al Fursan', 'قائد الفرسان', 'قائید ئەلفورسان', 'Lattafa Pride', 'men', 'perfume', 'EDP', ['fresh', 'woody'], 'all', 4, 4, [[90, null, 34000, 27000, 20000, 16]], '#3E6B4F', '#1B3326', 'flask', [['apple', 'bergamot'], ['lavender'], ['musk', 'amber']], ['A fresh, confident woody-aromatic for everyday wear.', 'عطر خشبي عطري منعش وواثق للاستخدام اليومي.', 'بۆنێکی داری و عەتری فێنک و متمانەبەخۆ بۆ ڕۆژانە.'], false, false],
            ['oudmood', 'Oud Mood', 'عود مود', 'عود مود', 'Lattafa', 'unisex', 'oud', 'EDP', ['oud', 'oriental'], 'winter', 5, 4, [[100, null, 46000, 37000, 27500, 8]], '#6A2F42', '#22101A', 'rect', [['saffron', 'rose'], ['oud', 'incense'], ['amber', 'vanilla', 'sandalwood']], ['A dark, smoky oud with saffron and rose, wrapped in incense, amber and vanilla.', 'عود داكن ودخاني مع الزعفران والورد، ملفوف بالبخور والعنبر والفانيليا.', 'عودێکی تاریک و دووکەڵاوی لەگەڵ زەعفەران و ڕۆز، پێچراوە بە بەخوور و ئەمبەر و ڤانیلیا.'], false, true],
            ['haya', 'Haya', 'هيا', 'هەیا', 'Lattafa', 'women', 'perfume', 'EDP', ['floral', 'fresh'], 'summer', 3, 3, [[100, null, 37000, 29500, 22000, 10]], '#CDA2E3', '#7A4FA0', 'tall', [['apple', 'bergamot'], ['rose', 'jasmine'], ['musk', 'amber']], ['Bright apple and bergamot over a soft bouquet of rose and jasmine.', 'تفاح وبرغموت مشرقان فوق باقة ناعمة من الورد والياسمين.', 'سێو و بێرگاموتی ڕووناک لەسەر گوڵدەستەیەکی نەرمی ڕۆز و یاسمین.'], false, false],
            ['mist', 'Vanilla Body Mist', 'معطر جسم فانيليا', 'بۆدی میستی ڤانیلیا', 'Ard Al Zaafaran', 'women', 'mist', 'Mist', ['sweet'], 'all', 2, 2, [[250, null, 12000, 9000, 6000, 30]], '#F7E3B5', '#E0B95E', 'flask', [['vanilla'], ['vanilla'], ['musk']], ['A light vanilla body mist for all-day freshness.', 'معطر جسم خفيف بالفانيليا لانتعاش طوال اليوم.', 'بۆدی میستی سووکی ڤانیلیا بۆ تازەیی هەموو ڕۆژ.'], false, false],
            ['gift', 'Khamrah Gift Set', 'طقم خمرة هدية', 'سێتی دیاری خەمرە', 'Lattafa', 'unisex', 'set', 'Set', ['oriental', 'sweet'], 'winter', 5, 4, [[0, '3 pcs', 85000, 68000, 52000, 4]], '#8B4A2B', '#3A1E12', 'rect', [['cinnamon'], ['dates'], ['vanilla']], ['Khamrah in a gift box with two travel sprays.', 'خمرة في علبة هدية مع بخاختين للسفر.', 'خەمرە لە سندوقی دیاری لەگەڵ دوو سپرەیی گەشت.'], false, false],
        ];
    }

    public function seed(User $by): void
    {
        foreach ($this->seeds() as [$key, $en, $ar, $ku, $brand, $gender, $category, $conc, $fam, $season, $lo, $si, $sizes, $c1, $c2, $shape, $notes, $desc, $featured, $isNew]) {
            $product = Product::create([
                'id' => (string) Str::uuid7(), 'name' => compact('en', 'ar', 'ku'), 'description' => ['en' => $desc[0], 'ar' => $desc[1], 'ku' => $desc[2]],
                'brand' => $brand, 'category' => $category, 'gender' => $gender, 'concentration' => $conc, 'scent_families' => $fam,
                'notes' => ['top' => $notes[0], 'heart' => $notes[1], 'base' => $notes[2]], 'season' => $season, 'longevity' => $lo, 'sillage' => $si,
                'art' => compact('c1', 'c2', 'shape'), 'show_on_menu' => true, 'featured' => $featured, 'is_new' => $isNew, 'active' => true,
            ]);
            foreach ($sizes as $size) {
                [$ml, $label, $retail, $wholesale, $cost, $qty] = $size;
                $min = $size[6] ?? 5;
                $variant = Variant::create([
                    'id' => (string) Str::uuid7(), 'product_id' => $product->id, 'label' => $label ?? "$ml ml", 'size' => $ml, 'unit' => 'ml', 'ml' => $ml,
                    'sku' => 'LTF-'.strtoupper(substr($key, 0, 4)).'-'.($ml ?: strtoupper(preg_replace('/[^a-z0-9]/i', '', (string) $label))), 'barcode' => $this->ean($this->counters->next('barcode')),
                    'cost_iqd' => $cost, 'retail_iqd' => $retail, 'wholesale_iqd' => $wholesale, 'min_stock' => $min ?? 5,
                ]);
                $this->stock->applyMovement($variant->id, $qty, 'opening', $by, ['note' => 'Demo opening stock']);
            }
        }
        foreach ([['Zana Ahmed', '0750 123 4567', 'retail', 'Duhok', 0, 0, 320], ['Al-Noor Perfumes', '0751 555 0101', 'shop', 'Duhok', 350000, 1000000, 0], ['Rose Gift Gallery', '0750 555 0202', 'shop', 'Zakho', 0, 800000, 0]] as [$name, $phone, $type, $city, $bal, $limit, $pts]) {
            Customer::create(['id' => (string) Str::uuid7(), 'name' => $name, 'phone' => $phone, 'type' => $type, 'city' => $city, 'balance_iqd' => $bal, 'credit_limit_iqd' => $limit, 'points' => $pts]);
        }
    }

    private function ean(int $seq): string
    {
        $body = substr('200'.str_pad((string) $seq, 9, '0', STR_PAD_LEFT), 0, 12);

        return $body.CatalogService::ean13CheckDigit($body);
    }
}
