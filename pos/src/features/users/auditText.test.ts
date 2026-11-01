import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { en } from '@/i18n/en'
import { ar } from '@/i18n/ar'
import { ku } from '@/i18n/ku'
import { AUDIT_GROUPS, auditDetails } from './auditText'

const ROOT = join(import.meta.dirname, '..', '..', '..', '..')
const files = (dir: string, ext: RegExp): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n)
  return statSync(p).isDirectory() ? files(p, ext) : ext.test(n) && !/\.test\./.test(n) ? [p] : []
})

/** Every action the server and the apps write to the activity log. */
function recordedActions(): Set<string> {
  const found = new Set<string>()
  for (const file of files(join(ROOT, 'backend', 'app'), /\.php$/)) {
    for (const line of readFileSync(file, 'utf8').split('\n').filter((l) => l.includes('->log('))) {
      for (const m of line.matchAll(/'([a-z_]+\.[a-z_]+)'/g)) found.add(m[1])
    }
  }
  for (const file of [...files(join(ROOT, 'pos', 'src'), /\.tsx?$/), ...files(join(ROOT, 'delegate', 'src'), /\.tsx?$/)]) {
    for (const m of readFileSync(file, 'utf8').matchAll(/\baudit\(\s*'([a-z_]+\.[a-z_]+)'/g)) found.add(m[1])
  }
  // built from parts in the code: 'delegate.'.$kind, 'purchase.'.(cancel|close), a till's stock change by type
  for (const a of ['delegate.van_load', 'delegate.van_unload', 'purchase.cancel', 'purchase.close', 'stock.receive', 'stock.tester', 'stock.count', 'stock.opening']) found.add(a)
  return found
}

describe('activity log wording', () => {
  it('every recorded action has a readable name in English, Arabic and Kurdish, and a filter group', () => {
    const actions = [...recordedActions()]
    expect(actions.length).toBeGreaterThan(60)
    for (const dict of [en, ar, ku]) {
      expect(actions.filter((a) => !dict[`act.${a}`])).toEqual([])
      expect(AUDIT_GROUPS.filter((g) => !dict[`actg.${g}`])).toEqual([])
    }
    // anything recorded can be found with the filter (setup and the till's own data export only under "All")
    expect(actions.filter((a) => !AUDIT_GROUPS.some((g) => a.startsWith(g)) && !['setup.complete', 'backup.export'].includes(a))).toEqual([])
  })

  it('shows changes as "old → new"', () => {
    expect(auditDetails({ name: 'Khamrah', variants: 1, prices: [{ size: '100 ml', price: 'retail', from: 45000, to: 30000 }] }))
      .toBe('name: Khamrah · variants: 1 · 100 ml retail: 45,000 → 30,000')
    expect(auditDetails({ keys: ['currency'], changes: { 'currency.rate': [1460, 1500], 'store.phone': ['', '0750 111 2222'] } }))
      .toBe('keys: currency · currency.rate: 1,460 → 1,500, store.phone: — → 0750 111 2222')
    expect(auditDetails({ name: 'Road Shop', changed: ['credit_limit_iqd', 'city'], creditLimit: [100000, 500000] }))
      .toBe('name: Road Shop · changed: credit_limit_iqd, city · creditLimit: 100,000 → 500,000')
    expect(auditDetails({ approvedBy: null, flags: [], number: 'ST1-00001' })).toBe('number: ST1-00001') // empty parts left out
  })
})
