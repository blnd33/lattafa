import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { problemText, translate, kindKey, genderKey } from './words'

const ROOT = join(import.meta.dirname, '..', '..')
const STRINGS = join(ROOT, 'backend', 'app', 'Support', 'CatalogueStrings.php')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) return walk(p)
    return /\.tsx?$/.test(f) && !/\.test\./.test(f) ? [p] : []
  })
}

/** Every word the server ships as English, which is also what a translation is measured against. */
function serverKeys(): Set<string> {
  const php = readFileSync(STRINGS, 'utf8')
  return new Set([...php.matchAll(/'(cat\.[a-z0-9_]+)'\s*=>/g)].map((m) => m[1]))
}

/** Every `t('cat.…')` the catalogue asks for, plus the ones it builds from a code. */
function usedKeys(): Map<string, string> {
  const found = new Map<string, string>()
  const src = join(import.meta.dirname)
  for (const file of walk(src)) {
    const s = readFileSync(file, 'utf8')
    for (const m of s.matchAll(/\bt\(\s*'(cat\.[a-z0-9_]+)'/g)) if (!found.has(m[1])) found.set(m[1], file.replace(src, ''))
  }
  return found
}

/** Built at runtime from a server code or a column, so every possible value has to exist. */
const DYNAMIC = [
  // App\Support\CatalogueRules problem codes, and the ones AccessCodeService can refuse an unlock with
  // no `out_of_stock`: the catalogue sells with no limit, so the server has no such refusal to make
  ...['min_order', 'min_qty', 'qty_step', 'unpriced', 'invalid_quantity', 'cart_empty'].map((c) => `cat.err_${c}`),
  ...['code_invalid', 'code_expired', 'code_revoked', 'customer_inactive', 'code_country', 'too_many', 'offline', 'unknown', 'not_unlocked'].map((c) => `cat.err_${c}`),
  // the `category` column on products, and `gender`
  ...['perfume', 'oud', 'mist', 'oil', 'set', 'home'].map(kindKey),
  ...['men', 'women', 'unisex'].map(genderKey),
  // read straight out of the dictionary before a word for it exists — the screen shown when the server is unreachable
  'cat.retry',
  // the one-of-it wording, picked by `useP` when n is 1
  'cat.perfumes_n_1', 'cat.bottles_n_1',
]

describe('the catalogue’s words', () => {
  it('asks for nothing the server does not ship in English', () => {
    const known = serverKeys()
    const missing = [...usedKeys(), ...DYNAMIC.map((k) => [k, '(built from a code)'] as const)]
      .filter(([k]) => !known.has(k))
      .map(([k, where]) => `${k}   ← ${where}`)

    expect(missing, `Missing from CatalogueStrings::EN:\n${missing.join('\n')}`).toEqual([])
  })

  it('shows a key rather than a blank when a word is missing', () => {
    expect(translate({}, 'cat.explore')).toBe('cat.explore')
    expect(translate({ 'cat.explore': 'Explore' }, 'cat.explore')).toBe('Explore')
  })

  it('puts the server’s figures into the sentence', () => {
    const words = { 'cat.err_min_qty': '{sku}: at least {qty} bottles.' }
    expect(translate(words, 'cat.err_min_qty', { sku: 'KHAM-100', qty: 6 })).toBe('KHAM-100: at least 6 bottles.')
  })

  it('turns the cents in a refusal into dollars before they reach the words', () => {
    const words = { 'cat.err_min_order': 'Minimum {minimum}. Add {add}.', 'cat.err_min_qty': '{sku}: at least {qty} bottles.' }
    const t = (k: string, v?: Record<string, string | number>) => translate(words, k, v)
    const money = (c: number) => `$${(c / 100).toFixed(2)}`

    expect(problemText(t, { code: 'min_order', params: { minimum: 50000, add: 2600 } }, money))
      .toBe('Minimum $500.00. Add $26.00.')
    // anything that is not money is passed through untouched
    expect(problemText(t, { code: 'min_qty', params: { sku: 'KHAM-100', qty: 6 } }, money)).toContain('KHAM-100')
  })
})
