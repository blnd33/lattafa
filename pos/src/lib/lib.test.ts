import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { sha256, hashSecret, makeCredential, verifySecret } from './credentials'
import { priceCart, pointsEarned } from './pricing'
import { effectivePermissions, hasPerm, SYSTEM_ROLES, ALL_PERMISSIONS } from './permissions'
import { encode128, code128Bars, ean13CheckDigit, internalEan13 } from './code128'
import { roundTo, parseAmount, cashSuggestions } from './money'
import { uuid } from './id'
import { toMl, sizeLabel, otherUnit, cleanDecimal } from './size'
import type { Role } from '@/data/types'

describe('sha256 (pure JS) matches node:crypto', () => {
  const enc = new TextEncoder()
  for (const s of ['', 'abc', 'The quick brown fox jumps over the lazy dog', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'x'.repeat(1000), 'لطافة ڕەغبە']) {
    it(`"${s.slice(0, 20)}…" (${s.length})`, () => {
      const mine = Buffer.from(sha256(enc.encode(s))).toString('hex')
      expect(mine).toBe(createHash('sha256').update(s).digest('hex'))
    })
  }
})

describe('credentials', () => {
  it('verifies the right secret and rejects the wrong one', () => {
    const c = makeCredential('4821')
    expect(verifySecret('4821', c.hash, c.salt)).toBe(true)
    expect(verifySecret('4822', c.hash, c.salt)).toBe(false)
    expect(verifySecret('4821', null, null)).toBe(false)
  })
  it('is salted', () => {
    expect(hashSecret('1234', 'a')).not.toBe(hashSecret('1234', 'b'))
  })
})

describe('priceCart', () => {
  const base = { rounding: 250 }
  it('sums lines with per-line discount', () => {
    const r = priceCart({ ...base, lines: [
      { key: 'a', unitPriceIQD: 45000, qty: 1, discountPct: 0 },
      { key: 'b', unitPriceIQD: 38000, qty: 2, discountPct: 10 },
    ] })
    expect(r.subtotal).toBe(121000)
    expect(r.itemDiscount).toBe(7600)
    expect(r.total).toBe(113500) // 113,400 rounded to the 250 step
    expect(r.rounding).toBe(100)
  })
  it('applies order discount after line discounts', () => {
    const r = priceCart({ rounding: 0, lines: [{ key: 'a', unitPriceIQD: 100000, qty: 1, discountPct: 10 }], orderDiscount: { type: 'pct', value: 10 } })
    expect(r.total).toBe(81000)
    expect(r.effectiveDiscountPct).toBeCloseTo(19, 5)
  })
  it('caps fixed discounts and points at what is left', () => {
    const r = priceCart({ rounding: 0, lines: [{ key: 'a', unitPriceIQD: 10000, qty: 1, discountPct: 0 }], orderDiscount: { type: 'fixed', value: 99999 }, pointsRedeemedIQD: 5000 })
    expect(r.total).toBe(0)
    expect(r.orderDiscount).toBe(10000)
  })
  it('adds tax and gift wrap', () => {
    const r = priceCart({ rounding: 0, taxPct: 5, giftWrapIQD: 2000, lines: [{ key: 'a', unitPriceIQD: 20000, qty: 1, discountPct: 0 }] })
    expect(r.tax).toBe(1000)
    expect(r.total).toBe(23000)
  })
  it('never goes negative and ignores bad input', () => {
    const r = priceCart({ rounding: 250, lines: [{ key: 'a', unitPriceIQD: -5, qty: -2, discountPct: 500 }] })
    expect(r.total).toBe(0)
  })
  it('earns loyalty points', () => {
    expect(pointsEarned(157500, 1)).toBe(157)
    expect(pointsEarned(0, 1)).toBe(0)
  })
})

describe('permissions', () => {
  const role = (key: string): Role => {
    const s = SYSTEM_ROLES.find((r) => r.key === key)!
    return { id: key, key, name: s.name, description: s.description, permissions: s.permissions, apps: s.apps, isSystem: true, createdAt: 0, updatedAt: 0 }
  }
  it('super admin has everything, even after a stray deny', () => {
    const p = effectivePermissions(role('super_admin'), { grants: [], denies: ['users.create'] })
    expect(hasPerm(p, 'users.create')).toBe(true)
    expect(hasPerm(p, 'anything.at.all')).toBe(true)
  })
  it('cashier can sell but not manage users', () => {
    const p = effectivePermissions(role('cashier'), { grants: [], denies: [] })
    expect(hasPerm(p, 'pos.sell')).toBe(true)
    expect(hasPerm(p, 'users.create')).toBe(false)
    expect(hasPerm(p, 'sales.discount.above_limit')).toBe(false)
  })
  it('grants add and denies win', () => {
    const p = effectivePermissions(role('cashier'), { grants: ['reports.view'], denies: ['pos.hold'] })
    expect(hasPerm(p, 'reports.view')).toBe(true)
    expect(hasPerm(p, 'pos.hold')).toBe(false)
  })
  it('manager has everything except super-admin-only permissions', () => {
    const p = effectivePermissions(role('manager'), { grants: [], denies: [] })
    expect(hasPerm(p, 'reports.financial')).toBe(true)
    expect(hasPerm(p, 'settings.edit')).toBe(false)
    expect(hasPerm(p, 'roles.manage')).toBe(false)
    expect(ALL_PERMISSIONS.length).toBeGreaterThan(40)
  })
})

describe('code128', () => {
  it('has start, valid checksum and stop', () => {
    const c = encode128('PJJ123C')
    expect(c[0]).toBe(104)
    expect(c[c.length - 1]).toBe(106)
    let sum = c[0]
    for (let i = 1; i < c.length - 2; i++) sum += c[i] * i
    expect(c[c.length - 2]).toBe(sum % 103)
    expect(c[c.length - 2]).toBe(55)
  })
  it('uses subset C for even digit runs (shorter)', () => {
    expect(encode128('12345678').length).toBeLessThan(encode128('1234567A').length)
  })
  it('produces bars', () => {
    const g = code128Bars('ST1-000482')
    expect(g.bars.length).toBeGreaterThan(20)
    expect(g.width).toBeGreaterThan(100)
  })
  it('ean13', () => {
    expect(ean13CheckDigit('400638133393')).toBe(1)
    expect(internalEan13(7)).toHaveLength(13)
  })
})

describe('money + ids', () => {
  it('rounds to the note step', () => {
    expect(roundTo(113400, 250)).toBe(113500)
    expect(roundTo(113374, 250)).toBe(113250)
    expect(roundTo(12.6, 0)).toBe(13)
  })
  it('parses Arabic-Indic digits', () => {
    expect(parseAmount('١٢٣٬٤٥٠')).toBe(123450)
    expect(parseAmount('45,000')).toBe(45000)
    expect(parseAmount('abc')).toBe(0)
  })
  it('suggests cash amounts', () => {
    const s = cashSuggestions(157500)
    expect(s[0]).toBe(157500)
    expect(s.every((v) => v >= 157500)).toBe(true)
  })
  it('uuid looks like a v4 uuid and is unique', () => {
    const a = uuid(), b = uuid()
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(a).not.toBe(b)
  })
})

describe('bottle sizes (ml / oz)', () => {
  it('converts ounces to whole millilitres', () => {
    expect(toMl(1, 'oz')).toBe(30)
    expect(toMl(1.7, 'oz')).toBe(50)
    expect(toMl(3.4, 'oz')).toBe(101)
    expect(toMl(100, 'ml')).toBe(100)
    expect(toMl(0, 'oz')).toBe(0) // gift sets have no size
  })
  it('labels and hints', () => {
    expect(sizeLabel(100, 'ml')).toBe('100 ml')
    expect(sizeLabel(3.4, 'oz')).toBe('3.4 oz')
    expect(sizeLabel(3.40, 'oz')).toBe('3.4 oz')
    expect(sizeLabel(0, 'ml')).toBe('')
    expect(otherUnit(100, 'ml')).toBe('≈ 3.4 oz')
    expect(otherUnit(30, 'ml')).toBe('≈ 1 oz')
    expect(otherUnit(3.4, 'oz')).toBe('≈ 101 ml')
    expect(otherUnit(0, 'ml')).toBe('')
  })
  it('the size box keeps digits and one decimal point while typing', () => {
    expect(cleanDecimal('3')).toBe('3')
    expect(cleanDecimal('3.')).toBe('3.')
    expect(cleanDecimal('3.4')).toBe('3.4')
    expect(cleanDecimal('100')).toBe('100')
    expect(cleanDecimal('3.4.5')).toBe('3.45')
    expect(cleanDecimal('1.755')).toBe('1.75')
    expect(cleanDecimal('3,4')).toBe('3.4')
    expect(cleanDecimal('٣٫٤')).toBe('3.4')
    expect(cleanDecimal('۱۰۰')).toBe('100')
    expect(cleanDecimal('12 ml')).toBe('12')
  })
})
