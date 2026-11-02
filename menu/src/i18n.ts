/**
 * Menu strings (from the approved design). Kept separate from the POS dictionaries so the public page stays small.
 * The language choice is shared with the POS and delegate apps (same domain, same `lattafa-ui` preference).
 */
import type { Lang } from '@/data/types'
import { useUI } from '@/store/ui'

const en = {
  tagline: 'Duhok · Iraq', kicker: 'Perfume boutique', hero_a: 'Discover your', hero_b: 'signature scent',
  hero_p: 'Oriental oud, warm amber and modern florals — curated for you. Browse, explore the notes, and order in seconds.', cta: 'Explore collection',
  search_ph: 'Search perfume, brand or note…', brand_all: 'All brands', price_any: 'Any price', p1: 'Under {a}', p2: '{a} – {b}', p3: '{b} and over',
  g_all: 'All', g_men: 'Men', g_women: 'Women', g_unisex: 'Unisex',
  f_all: 'All scents', f_oud: 'Oud', f_woody: 'Woody', f_floral: 'Floral', f_oriental: 'Oriental', f_fresh: 'Fresh', f_sweet: 'Sweet',
  featured: 'Featured', new_arr: 'New arrivals', all_perf: 'All perfumes', results: '{n} perfumes', new: 'New', from: 'from', iqd: 'IQD',
  none: 'No perfumes match your filters', reset: 'Reset filters',
  notes: 'Fragrance notes', top: 'Top', heart: 'Heart', base: 'Base', longevity: 'Longevity', sillage: 'Sillage', season: 'Season', sizes: 'Sizes',
  s_winter: 'Autumn · Winter', s_summer: 'Spring · Summer', s_all: 'All seasons', order: 'Order via WhatsApp', wa_hello: 'Hello Lattafa, I would like to order:',
  foot1: 'Duhok, Kurdistan Region — Iraq', foot2: 'Prices in Iraqi Dinar. Availability may vary.', close: 'Close',
  sold_out: 'Sold out', loading: 'Loading the menu…', offline: 'Showing the last saved menu — you are offline.', error: 'The menu could not be loaded.', retry: 'Try again',
  empty: 'Our perfume menu is being prepared. Please ask in the shop.', call: 'Call us', lang: 'Language', ask_price: 'Ask us for the price', slide: 'Picture {n} of {total}', bg_pause: 'Pause the background', bg_play: 'Play the background',
  add: 'Add', in_basket: 'In your order: {n}', basket: 'Your order', basket_n: 'Order · {n} item(s)', send_order: 'Send the order', shop_name: 'Shop name', shop_name_ph: 'Al-Noor Perfumes', your_phone: 'Phone number', your_phone_ph: '0750 000 0000', order_note: 'Anything to add? (optional)', order_note_ph: 'Before Thursday please', remove: 'Remove', empty_basket: 'Nothing chosen yet. Tap Add on a perfume.', sent_title: 'Order sent', sent_body: 'Your order number is #{n}. We will call you to confirm.', sent_done: 'Done', need_name: 'Please write the shop name.', need_phone: 'Please write a phone number we can call.', order_busy: 'Too many orders from here just now. Please try again later.', order_gone: 'Something in your order is no longer available. Please remove it and try again.', order_failed: 'The order could not be sent. Please check your connection and try again.',
}
type Key = keyof typeof en

const ar: Record<Key, string> = {
  tagline: 'دهوك · العراق', kicker: 'بوتيك العطور', hero_a: 'اكتشف', hero_b: 'عطرك المميز',
  hero_p: 'عود شرقي وعنبر دافئ وأزهار عصرية — مختارة لك. تصفّح النوتات العطرية واطلب خلال ثوانٍ.', cta: 'استكشف المجموعة',
  search_ph: 'ابحث عن عطر أو ماركة أو نوتة…', brand_all: 'كل الماركات', price_any: 'أي سعر', p1: 'أقل من {a}', p2: '{a} – {b}', p3: '{b} فأكثر',
  g_all: 'الكل', g_men: 'رجالي', g_women: 'نسائي', g_unisex: 'للجنسين',
  f_all: 'كل العطور', f_oud: 'عود', f_woody: 'خشبي', f_floral: 'زهري', f_oriental: 'شرقي', f_fresh: 'منعش', f_sweet: 'حلو',
  featured: 'مختارات', new_arr: 'وصل حديثاً', all_perf: 'كل العطور', results: '{n} عطر', new: 'جديد', from: 'ابتداءً من', iqd: 'د.ع',
  none: 'لا توجد عطور مطابقة', reset: 'إعادة ضبط الفلاتر',
  notes: 'النوتات العطرية', top: 'العليا', heart: 'القلب', base: 'القاعدة', longevity: 'الثبات', sillage: 'الفوحان', season: 'الموسم', sizes: 'الأحجام',
  s_winter: 'الخريف · الشتاء', s_summer: 'الربيع · الصيف', s_all: 'كل الفصول', order: 'اطلب عبر واتساب', wa_hello: 'مرحباً لطافة، أود طلب:',
  foot1: 'دهوك، إقليم كردستان — العراق', foot2: 'الأسعار بالدينار العراقي. التوفر قد يختلف.', close: 'إغلاق',
  sold_out: 'نفد', loading: 'جارٍ تحميل القائمة…', offline: 'تُعرض آخر قائمة محفوظة — أنت غير متصل.', error: 'تعذّر تحميل القائمة.', retry: 'حاول مجدداً',
  empty: 'قائمة العطور قيد التحضير. يرجى السؤال في المتجر.', call: 'اتصل بنا', lang: 'اللغة', ask_price: 'اسألنا عن السعر', slide: 'الصورة {n} من {total}', bg_pause: 'إيقاف الخلفية مؤقتاً', bg_play: 'تشغيل الخلفية',
  add: 'أضف', in_basket: 'في طلبك: {n}', basket: 'طلبك', basket_n: 'الطلب · {n} صنف', send_order: 'إرسال الطلب', shop_name: 'اسم المحل', shop_name_ph: 'عطور النور', your_phone: 'رقم الهاتف', your_phone_ph: '0750 000 0000', order_note: 'هل تريد إضافة شيء؟ (اختياري)', order_note_ph: 'قبل الخميس من فضلك', remove: 'إزالة', empty_basket: 'لم تختر شيئاً بعد. اضغط «أضف» على أي عطر.', sent_title: 'تم إرسال الطلب', sent_body: 'رقم طلبك #{n}. سنتصل بك للتأكيد.', sent_done: 'تم', need_name: 'يرجى كتابة اسم المحل.', need_phone: 'يرجى كتابة رقم هاتف يمكننا الاتصال به.', order_busy: 'طلبات كثيرة من هنا الآن. يرجى المحاولة لاحقاً.', order_gone: 'أحد الأصناف في طلبك لم يعد متوفراً. يرجى إزالته والمحاولة مجدداً.', order_failed: 'تعذّر إرسال الطلب. تحقق من الاتصال وحاول مجدداً.',
}

const ku: Record<Key, string> = {
  tagline: 'دهۆک · عێراق', kicker: 'بۆتیکی عەتر', hero_a: 'عەترە', hero_b: 'تایبەتەکەی خۆت بدۆزەرەوە',
  hero_p: 'عودی ڕۆژهەڵاتی، ئەمبەری گەرم و گوڵی مۆدێرن — بۆ تۆ هەڵبژێردراون. بگەڕێ، نۆتەکان ببینە و لە چرکەیەکدا داوا بکە.', cta: 'کۆمەڵەکە ببینە',
  search_ph: 'بگەڕێ بۆ عەتر، براند یان نۆت…', brand_all: 'هەموو براندەکان', price_any: 'هەر نرخێک', p1: 'کەمتر لە {a}', p2: '{a} – {b}', p3: '{b} و زیاتر',
  g_all: 'هەموو', g_men: 'پیاوان', g_women: 'ژنان', g_unisex: 'یونیسێکس',
  f_all: 'هەموو بۆنەکان', f_oud: 'عود', f_woody: 'داری', f_floral: 'گوڵاوی', f_oriental: 'ڕۆژهەڵاتی', f_fresh: 'فێنک', f_sweet: 'شیرین',
  featured: 'هەڵبژاردەکان', new_arr: 'نوێ گەیشتووە', all_perf: 'هەموو عەترەکان', results: '{n} عەتر', new: 'نوێ', from: 'لە', iqd: 'دینار',
  none: 'هیچ عەترێک نەدۆزرایەوە', reset: 'ڕێکخستنەوەی فلتەرەکان',
  notes: 'نۆتەکانی بۆن', top: 'سەرەوە', heart: 'دڵ', base: 'بنکە', longevity: 'مانەوە', sillage: 'بڵاوبوونەوە', season: 'وەرز', sizes: 'قەبارەکان',
  s_winter: 'پاییز · زستان', s_summer: 'بەهار · هاوین', s_all: 'هەموو وەرزەکان', order: 'لە ڕێگەی واتسئاپەوە داوا بکە', wa_hello: 'سڵاو لەتافە، دەمەوێت داوا بکەم:',
  foot1: 'دهۆک، هەرێمی کوردستان — عێراق', foot2: 'نرخەکان بە دیناری عێراقین. بەردەستبوون دەشێت جیاواز بێت.', close: 'داخستن',
  sold_out: 'نەماوە', loading: 'لیستەکە بار دەکرێت…', offline: 'دوایین لیستی پاشەکەوتکراو پیشان دەدرێت — ئۆفلاینیت.', error: 'لیستەکە بار نەکرا.', retry: 'دووبارە هەوڵ بدەوە',
  empty: 'لیستی عەترەکان ئامادە دەکرێت. تکایە لە فرۆشگاکە بپرسە.', call: 'پەیوەندیمان پێوە بکە', lang: 'زمان', ask_price: 'نرخەکەمان لێ بپرسە', slide: 'وێنەی {n} لە {total}', bg_pause: 'پاشبنەماکە ڕابگرە', bg_play: 'پاشبنەماکە لێبدە',
  add: 'زیادی بکە', in_basket: 'لە داواکاریەکەتدا: {n}', basket: 'داواکاریەکەت', basket_n: 'داواکاری · {n} شت', send_order: 'داواکاریەکە بنێرە', shop_name: 'ناوی دوکان', shop_name_ph: 'عەترەکانی نوور', your_phone: 'ژمارەی تەلەفۆن', your_phone_ph: '٠٧٥٠ ٠٠٠ ٠٠٠٠', order_note: 'شتێکی تر هەیە؟ (ئارەزوومەندانە)', order_note_ph: 'پێش پێنجشەممە تکایە', remove: 'لابردن', empty_basket: 'هێشتا هیچت هەڵنەبژاردووە. لەسەر عەترێک «زیادی بکە» دابگرە.', sent_title: 'داواکاری نێردرا', sent_body: 'ژمارەی داواکاریەکەت #{n}ە. پەیوەندیت پێوە دەکەین بۆ دڵنیابوون.', sent_done: 'تەواو', need_name: 'تکایە ناوی دوکانەکە بنووسە.', need_phone: 'تکایە ژمارەیەک بنووسە کە پەیوەندیت پێوە بکەین.', order_busy: 'ئێستا داواکاری زۆر لێرەوە هاتووە. تکایە دواتر هەوڵ بدەوە.', order_gone: 'شتێک لە داواکاریەکەتدا چیتر بەردەست نییە. تکایە لایببە و دووبارە هەوڵ بدەوە.', order_failed: 'داواکاریەکە نەنێردرا. پەیوەندیەکەت بپشکنە و دووبارە هەوڵ بدەوە.',
}

const DICT: Record<Lang, Record<Key, string>> = { en, ar, ku }

export type MenuT = (k: Key, vars?: Record<string, string | number>) => string

export function useMenuT(): MenuT {
  const lang = useUI((s) => s.lang)
  return (k, vars) => {
    let s = DICT[lang][k] ?? en[k]
    if (vars) for (const [n, v] of Object.entries(vars)) s = s.replace(`{${n}}`, String(v))
    return s
  }
}

export const isRtlLang = (l: Lang) => l !== 'en'
export const htmlLangOf = (l: Lang) => (l === 'ku' ? 'ckb' : l)
