import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { en } from './en'
import { ar } from './ar'
import { ku } from './ku'
import { ALL_PERMISSIONS, PERMISSION_GROUPS } from '@/lib/permissions'

const SRC = join(import.meta.dirname, '..')
// the delegate app (/delegate/) uses the same dictionaries
const DELEGATE = join(import.meta.dirname, '..', '..', '..', 'delegate', 'src')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) return f === 'i18n' || f === 'test' ? [] : walk(p)
    return /\.(tsx?|ts)$/.test(f) && !/\.test\./.test(f) ? [p] : []
  })
}

/** Every literal key passed to t('…') / tr('…') / translate(lang,'…') in the source. */
function usedKeys(): Map<string, string> {
  const found = new Map<string, string>()
  const re = /\b(?:t|tr)\(\s*(['"])([a-z][\w]*(?:\.[\w]+)+)\1/g
  const re2 = /translate\(\s*[\w.]+\s*,\s*(['"])([a-z][\w]*(?:\.[\w]+)+)\1/g
  const re3 = /(?:label|title|hint|success|error|placeholder|text)\s*[:=]\s*(['"])((?:nav|sell|pay|shift|receipt|sales|ret|cust|prod|inv|rep|users|roles|settings|account|auth|setup|common|err|perm|method|cat|family|gender|unit|theme|sync|approval|scan|noaccess|stock|dl)\.[\w.]+)\1/g
  for (const file of [...walk(SRC), ...walk(DELEGATE)]) {
    const s = readFileSync(file, 'utf8')
    for (const r of [re, re2, re3]) for (const m of s.matchAll(r)) if (!found.has(m[2])) found.set(m[2], file.replace(SRC, ''))
  }
  return found
}

/** Keys built dynamically (t(`method.${id}`)) — every possible value must exist. */
const DYNAMIC: string[] = [
  ...['cash_iqd', 'cash_usd', 'card', 'fib', 'zain', 'debt', 'return_credit'].map((m) => `method.${m}`),
  ...['collection_cash_iqd', 'collection_card', 'collection_fib', 'collection_zain'].map((m) => `method.${m}`),
  ...['all', 'men', 'women', 'unisex', 'oud', 'mist', 'set'].map((c) => `cat.${c}`),
  ...['oud', 'woody', 'floral', 'oriental', 'fresh', 'sweet'].map((f) => `family.${f}`),
  ...['men', 'women', 'unisex'].map((g) => `gender.${g}`),
  ...['light', 'dark', 'system'].map((x) => `theme.${x}`),
  ...['retail', 'shop', 'wholesale'].map((x) => `cust.type_${x}`),
  ...ALL_PERMISSIONS.map((p) => `perm.${p}`),
  ...PERMISSION_GROUPS.map((g) => `permgroup.${g.key}`),
  ...['perfume', 'oud', 'mist', 'oil', 'set', 'home'].map((c) => `prod.cat_${c}`),
  ...['all', 'winter', 'summer'].map((c) => `prod.season_${c}`),
  ...['completed', 'voided', 'partially_returned', 'returned'].map((c) => `sales.status_${c}`),
  ...['purchase', 'sale', 'return', 'void', 'adjustment', 'damage', 'tester', 'count', 'transfer_in', 'transfer_out', 'opening'].map((c) => `inv.mv_${c}`),
  ...['count', 'direct'].map((c) => `shift.tab_${c}`),
  ...['cash_iqd', 'card', 'fib', 'zain', 'store_credit', 'debt_reduction'].map((c) => `ret.method_${c}`),
  ...['changed', 'defective', 'wrong', 'other'].map((c) => `ret.reason_${c}`),
  ...['basic', 'sizes', 'details', 'menu'].map((c) => `prod.tab_${c}`),
  ...['top', 'heart', 'base'].map((c) => `prod.notes_${c}`),
  ...['pos', 'admin', 'delegate'].map((c) => `roles.app_${c}`),
  ...['allow', 'deny'].map((c) => `users.${c}`),
  ...['store', 'money', 'rules', 'security', 'data'].map((c) => `settings.tab_${c}`),
  ...['today', 'yesterday', '7d', '30d', 'month', 'custom'].map((c) => `rep.range_${c}`),
  ...['today', '7d', '30d', 'all'].map((c) => `sales.range_${c}`),
  ...['sale', 'payment', 'return'].map((c) => `cust.row_${c}`),
  'prod.show_on_menu', 'prod.featured', 'prod.is_new',
  'settings.show_logo', 'settings.show_qr', 'settings.auto_print',
  // delegate app
  ...['all', 'low', 'men', 'women', 'oud'].map((x) => `dl.f_${x}`),
  ...['visit', 'no_sale', 'closed'].map((x) => `dl.outcome_${x}`),
  ...['pending', 'submitted', 'approved', 'rejected'].flatMap((x) => [`dl.status_${x}`, `dl.closing_${x}`]),
  ...['open', 'fulfilled', 'cancelled'].map((x) => `dl.req_${x}`),
]

/** Every AppError('code') thrown anywhere in the services needs a translated message. */
function errorCodes(): string[] {
  const codes = new Set<string>()
  for (const file of [...walk(SRC), ...walk(DELEGATE)]) {
    for (const m of readFileSync(file, 'utf8').matchAll(/new (?:App|Permission)Error\(\s*'([a-z_]+)'/g)) codes.add(`err.${m[1]}`)
  }
  return [...codes]
}

describe('i18n completeness', () => {
  const keys = new Map<string, string>(usedKeys())
  for (const k of [...DYNAMIC, ...errorCodes()]) if (!keys.has(k)) keys.set(k, '(dynamic)')

  it('every key used in the code exists in English', () => {
    const missing = [...keys].filter(([k]) => !(k in en)).map(([k, f]) => `${k}   ← ${f}`)
    expect(missing, `Missing English strings:\n${missing.join('\n')}`).toEqual([])
  })
  it('Arabic has every English key', () => {
    const missing = Object.keys(en).filter((k) => !(k in ar))
    expect(missing, `Missing Arabic:\n${missing.join('\n')}`).toEqual([])
  })
  it('Kurdish (Sorani) has every English key', () => {
    const missing = Object.keys(en).filter((k) => !(k in ku))
    expect(missing, `Missing Kurdish:\n${missing.join('\n')}`).toEqual([])
  })
  it('placeholders match across languages', () => {
    const bad: string[] = []
    for (const [k, v] of Object.entries(en)) {
      const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
      for (const [name, d] of [['ar', ar], ['ku', ku]] as const) if (d[k] && ph(d[k]) !== ph(v)) bad.push(`${name}:${k}`)
    }
    expect(bad).toEqual([])
  })
  it('no leftover unused-looking empty strings', () => {
    for (const d of [en, ar, ku]) for (const [k, v] of Object.entries(d)) expect(v.trim(), k).not.toBe('')
  })
})
