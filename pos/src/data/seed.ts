/**
 * Optional demo catalogue offered during first-run setup so the shop can try the
 * POS immediately. All names, prices and stock levels are sample data.
 */
import { internalEan13 } from '@/lib/code128'
import { uuid } from '@/lib/id'
import { STORE_LOCATION_ID, type BottleShape, type Customer, type Gender, type Product, type StockRow, type Variant } from './types'

interface Seed {
  id: string
  en: string; ar: string; ku: string
  brand: string
  gender: Gender
  category: string
  conc: string
  fam: string[]
  season: Product['season']
  lo: number; si: number
  sizes: { ml: number; label?: string; retail: number; wholesale: number; cost: number; stock: number; min?: number }[]
  c1: string; c2: string; shape: BottleShape
  notes: [string[], string[], string[]]
  desc: [string, string, string]
  featured?: boolean; isNew?: boolean
}

const SEEDS: Seed[] = [
  { id: 'khamrah', en: 'Khamrah', ar: 'خمرة', ku: 'خەمرە', brand: 'Lattafa', gender: 'unisex', category: 'perfume', conc: 'EDP', fam: ['oriental', 'sweet'], season: 'winter', lo: 5, si: 4,
    sizes: [{ ml: 100, retail: 45000, wholesale: 36000, cost: 27000, stock: 14 }, { ml: 50, retail: 30000, wholesale: 24000, cost: 18000, stock: 6 }],
    c1: '#8B4A2B', c2: '#3A1E12', shape: 'rect', notes: [['cinnamon', 'bergamot', 'cardamom'], ['dates', 'praline', 'rose'], ['vanilla', 'amber', 'sandalwood']], featured: true,
    desc: ['A warm gourmand of cinnamon, dates and praline melting into creamy vanilla and amber.', 'عطر دافئ شهي من القرفة والتمر والبرالين يذوب في الفانيليا الكريمية والعنبر.', 'بۆنێکی گەرم و شیرین لە دارچین و خورما و پرالین کە دەتوێتەوە لە ڤانیلیای کرێمی و ئەمبەر.'] },
  { id: 'asad', en: 'Asad', ar: 'أسد', ku: 'ئەسەد', brand: 'Lattafa', gender: 'men', category: 'perfume', conc: 'EDP', fam: ['oriental', 'woody'], season: 'winter', lo: 5, si: 4,
    sizes: [{ ml: 100, retail: 42000, wholesale: 33500, cost: 25000, stock: 9 }],
    c1: '#3B3530', c2: '#0F0D0B', shape: 'tall', notes: [['pepper', 'tobacco'], ['coffee', 'iris'], ['vanilla', 'amber', 'patchouli']], featured: true,
    desc: ['Bold and magnetic: black pepper and tobacco over coffee, iris and a smooth vanilla-amber base.', 'جريء وجذاب: فلفل أسود وتبغ فوق القهوة والزنبق وقاعدة ناعمة من الفانيليا والعنبر.', 'بوێر و ڕاکێش: بیبەری ڕەش و تووتن لەسەر قاوە و ئیریس و بنکەیەکی نەرمی ڤانیلیا و ئەمبەر.'] },
  { id: 'yara', en: 'Yara', ar: 'يارا', ku: 'یارا', brand: 'Lattafa', gender: 'women', category: 'perfume', conc: 'EDP', fam: ['floral', 'sweet'], season: 'all', lo: 4, si: 3,
    sizes: [{ ml: 100, retail: 38000, wholesale: 30000, cost: 22000, stock: 22 }, { ml: 50, retail: 26000, wholesale: 20500, cost: 15000, stock: 6 }],
    c1: '#F2BCCB', c2: '#C77A9A', shape: 'round', notes: [['orchid', 'tangerine'], ['jasmine', 'pineapple'], ['vanilla', 'musk', 'sandalwood']], featured: true, isNew: true,
    desc: ['Soft, dreamy and feminine: orchid and tangerine wrapped in creamy vanilla musk.', 'ناعم وحالم وأنثوي: أوركيد ويوسفي في مسك الفانيليا الكريمي.', 'نەرم و خەیاڵاوی و ژنانە: ئۆرکید و نارنگی لە میسکی ڤانیلیای کرێمیدا.'] },
  { id: 'fakhar', en: 'Fakhar Black', ar: 'فخر بلاك', ku: 'فەخر بلاک', brand: 'Lattafa', gender: 'men', category: 'perfume', conc: 'EDP', fam: ['fresh', 'woody'], season: 'all', lo: 4, si: 4,
    sizes: [{ ml: 100, retail: 44000, wholesale: 35000, cost: 26000, stock: 11 }],
    c1: '#27365C', c2: '#0B1020', shape: 'rect', notes: [['bergamot', 'mint', 'apple'], ['lavender', 'iris'], ['patchouli', 'amber', 'musk']],
    desc: ['Fresh and refined: bergamot, mint and apple with lavender, iris and a woody amber base.', 'منعش وراقٍ: برغموت ونعناع وتفاح مع اللافندر والزنبق وقاعدة خشبية عنبرية.', 'فێنک و پەسەند: بێرگاموت و نەعنا و سێو لەگەڵ لاڤەندەر و ئیریس و بنکەیەکی داری ئەمبەری.'] },
  { id: 'raghba', en: 'Raghba', ar: 'رغبة', ku: 'ڕەغبە', brand: 'Lattafa', gender: 'unisex', category: 'perfume', conc: 'EDP', fam: ['oriental', 'sweet'], season: 'winter', lo: 4, si: 4,
    sizes: [{ ml: 100, retail: 36000, wholesale: 28000, cost: 21000, stock: 3, min: 5 }],
    c1: '#B5442F', c2: '#5E1E14', shape: 'flask', notes: [['saffron', 'incense'], ['rose'], ['vanilla', 'oud', 'musk']],
    desc: ['Saffron and incense open onto a deep heart of rose, resting on vanilla, oud and musk.', 'زعفران وبخور يفتحان على قلب عميق من الورد، فوق الفانيليا والعود والمسك.', 'زەعفەران و بەخوور دەکرێنەوە بۆ دڵێکی قووڵی ڕۆز، لەسەر ڤانیلیا و عود و میسک.'] },
  { id: 'badee', en: "Bade'e Al Oud", ar: 'بديع العود', ku: 'بەدیع ئەلعود', brand: 'Lattafa Pride', gender: 'unisex', category: 'oud', conc: 'EDP', fam: ['oud', 'woody'], season: 'winter', lo: 5, si: 5,
    sizes: [{ ml: 100, retail: 48000, wholesale: 38500, cost: 29000, stock: 7 }],
    c1: '#8A6A38', c2: '#2E2010', shape: 'tall', notes: [['saffron', 'cardamom'], ['oud', 'rose'], ['patchouli', 'amber', 'musk']], featured: true,
    desc: ['Regal oud with saffron and cardamom, deepened by rose, patchouli and warm amber.', 'عود ملكي مع الزعفران والهيل، يزداد عمقاً بالورد والباتشولي والعنبر الدافئ.', 'عودی شاهانە لەگەڵ زەعفەران و هێل، قووڵتر دەبێت بە ڕۆز و پاچۆلی و ئەمبەری گەرم.'] },
  { id: 'ana', en: 'Ana Abiyedh', ar: 'أنا أبيض', ku: 'ئەنا ئەبیەز', brand: 'Lattafa', gender: 'unisex', category: 'perfume', conc: 'EDP', fam: ['fresh', 'floral'], season: 'summer', lo: 3, si: 3,
    sizes: [{ ml: 60, retail: 30000, wholesale: 24000, cost: 18000, stock: 12 }],
    c1: '#F6F1E6', c2: '#CFC3A8', shape: 'round', notes: [['bergamot', 'mint'], ['jasmine', 'lavender'], ['musk', 'amber']], isNew: true,
    desc: ['Clean and luminous: bergamot and mint over jasmine and lavender, settling into soft musk.', 'نقي ومضيء: برغموت ونعناع فوق الياسمين واللافندر، ويستقر على مسك ناعم.', 'پاک و ڕووناک: بێرگاموت و نەعنا لەسەر یاسمین و لاڤەندەر، دەنیشێتەوە لەسەر میسکی نەرم.'] },
  { id: 'eclaire', en: 'Eclaire', ar: 'إكلير', ku: 'ئیکلێر', brand: 'Lattafa', gender: 'women', category: 'perfume', conc: 'EDP', fam: ['sweet', 'oriental'], season: 'all', lo: 4, si: 3,
    sizes: [{ ml: 100, retail: 40000, wholesale: 32000, cost: 24000, stock: 5 }],
    c1: '#EBBB70', c2: '#A8702B', shape: 'rect', notes: [['caramel', 'tangerine'], ['jasmine', 'rose'], ['vanilla', 'musk', 'sandalwood']], isNew: true,
    desc: ['Sweet caramel and tangerine with jasmine and rose, finishing on vanilla and musk.', 'كراميل حلو ويوسفي مع الياسمين والورد، ينتهي بالفانيليا والمسك.', 'کارامێلی شیرین و نارنگی لەگەڵ یاسمین و ڕۆز، کۆتایی دێت بە ڤانیلیا و میسک.'] },
  { id: 'qaed', en: 'Qaed Al Fursan', ar: 'قائد الفرسان', ku: 'قائید ئەلفورسان', brand: 'Lattafa Pride', gender: 'men', category: 'perfume', conc: 'EDP', fam: ['fresh', 'woody'], season: 'all', lo: 4, si: 4,
    sizes: [{ ml: 90, retail: 34000, wholesale: 27000, cost: 20000, stock: 16 }],
    c1: '#3E6B4F', c2: '#1B3326', shape: 'flask', notes: [['apple', 'bergamot'], ['lavender'], ['musk', 'amber']],
    desc: ['A fresh, confident woody-aromatic for everyday wear.', 'عطر خشبي عطري منعش وواثق للاستخدام اليومي.', 'بۆنێکی داری و عەتری فێنک و متمانەبەخۆ بۆ ڕۆژانە.'] },
  { id: 'oudmood', en: 'Oud Mood', ar: 'عود مود', ku: 'عود مود', brand: 'Lattafa', gender: 'unisex', category: 'oud', conc: 'EDP', fam: ['oud', 'oriental'], season: 'winter', lo: 5, si: 4,
    sizes: [{ ml: 100, retail: 46000, wholesale: 37000, cost: 27500, stock: 8 }],
    c1: '#6A2F42', c2: '#22101A', shape: 'rect', notes: [['saffron', 'rose'], ['oud', 'incense'], ['amber', 'vanilla', 'sandalwood']], isNew: true,
    desc: ['A dark, smoky oud with saffron and rose, wrapped in incense, amber and vanilla.', 'عود داكن ودخاني مع الزعفران والورد، ملفوف بالبخور والعنبر والفانيليا.', 'عودێکی تاریک و دووکەڵاوی لەگەڵ زەعفەران و ڕۆز، پێچراوە بە بەخوور و ئەمبەر و ڤانیلیا.'] },
  { id: 'haya', en: 'Haya', ar: 'هيا', ku: 'هەیا', brand: 'Lattafa', gender: 'women', category: 'perfume', conc: 'EDP', fam: ['floral', 'fresh'], season: 'summer', lo: 3, si: 3,
    sizes: [{ ml: 100, retail: 37000, wholesale: 29500, cost: 22000, stock: 10 }],
    c1: '#CDA2E3', c2: '#7A4FA0', shape: 'tall', notes: [['apple', 'bergamot'], ['rose', 'jasmine'], ['musk', 'amber']],
    desc: ['Bright apple and bergamot over a soft bouquet of rose and jasmine.', 'تفاح وبرغموت مشرقان فوق باقة ناعمة من الورد والياسمين.', 'سێو و بێرگاموتی ڕووناک لەسەر گوڵدەستەیەکی نەرمی ڕۆز و یاسمین.'] },
  { id: 'mist', en: 'Vanilla Body Mist', ar: 'معطر جسم فانيليا', ku: 'بۆدی میستی ڤانیلیا', brand: 'Ard Al Zaafaran', gender: 'women', category: 'mist', conc: 'Mist', fam: ['sweet'], season: 'all', lo: 2, si: 2,
    sizes: [{ ml: 250, retail: 12000, wholesale: 9000, cost: 6000, stock: 30 }],
    c1: '#F7E3B5', c2: '#E0B95E', shape: 'flask', notes: [['vanilla'], ['vanilla'], ['musk']],
    desc: ['A light vanilla body mist for all-day freshness.', 'معطر جسم خفيف بالفانيليا لانتعاش طوال اليوم.', 'بۆدی میستی سووکی ڤانیلیا بۆ تازەیی هەموو ڕۆژ.'] },
  { id: 'gift', en: 'Khamrah Gift Set', ar: 'طقم خمرة هدية', ku: 'سێتی دیاری خەمرە', brand: 'Lattafa', gender: 'unisex', category: 'set', conc: 'Set', fam: ['oriental', 'sweet'], season: 'winter', lo: 5, si: 4,
    sizes: [{ ml: 0, label: '3 pcs', retail: 85000, wholesale: 68000, cost: 52000, stock: 4 }],
    c1: '#8B4A2B', c2: '#3A1E12', shape: 'rect', notes: [['cinnamon'], ['dates'], ['vanilla']],
    desc: ['Khamrah in a gift box with two travel sprays.', 'خمرة في علبة هدية مع بخاختين للسفر.', 'خەمرە لە سندوقی دیاری لەگەڵ دوو سپرەیی گەشت.'] },
]

export interface DemoData {
  products: Product[]
  variants: Variant[]
  stock: StockRow[]
  customers: Customer[]
}

export function buildDemoData(): DemoData {
  const now = Date.now()
  const products: Product[] = []
  const variants: Variant[] = []
  const stock: StockRow[] = []
  let ean = 1
  SEEDS.forEach((s) => {
    const pid = uuid()
    products.push({
      id: pid,
      name: { en: s.en, ar: s.ar, ku: s.ku },
      description: { en: s.desc[0], ar: s.desc[1], ku: s.desc[2] },
      brand: s.brand, category: s.category, gender: s.gender, concentration: s.conc,
      scentFamilies: s.fam,
      notes: { top: s.notes[0], heart: s.notes[1], base: s.notes[2] },
      season: s.season, longevity: s.lo, sillage: s.si, image: null,
      art: { c1: s.c1, c2: s.c2, shape: s.shape },
      showOnMenu: true, featured: !!s.featured, isNew: !!s.isNew, active: true,
      createdAt: now, updatedAt: now,
    })
    s.sizes.forEach((z) => {
      const vid = uuid()
      const code = s.id.toUpperCase().slice(0, 4)
      variants.push({
        id: vid, productId: pid, label: z.label ?? `${z.ml} ml`, size: z.ml, unit: 'ml', ml: z.ml,
        sku: `LTF-${code}-${z.ml || z.label?.replace(/[^a-z0-9]/gi, '').toUpperCase()}`, barcode: internalEan13(ean++),
        costIQD: z.cost, retailIQD: z.retail, wholesaleIQD: z.wholesale,
        minStock: z.min ?? 5, isTester: false, active: true,
      })
      stock.push({ variantId: vid, locationId: STORE_LOCATION_ID, qty: z.stock })
    })
  })

  const customers: Customer[] = [
    ['Zana Ahmed', '0750 123 4567', 'retail', 'Duhok', 0, 0, 320],
    ['Al-Noor Perfumes', '0751 555 0101', 'shop', 'Duhok', 350000, 1000000, 0],
    ['Rose Gift Gallery', '0750 555 0202', 'shop', 'Zakho', 0, 800000, 0],
  ].map(([name, phone, type, city, bal, lim, pts]) => ({
    id: uuid(), name: name as string, phone: phone as string, type: type as Customer['type'], city: city as string,
    notes: '', balanceIQD: bal as number, creditLimitIQD: lim as number, points: pts as number,
    active: true, createdAt: now, updatedAt: now,
  }))

  return { products, variants, stock, customers }
}
