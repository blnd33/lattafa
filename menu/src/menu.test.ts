import { describe, expect, it } from 'vitest'
import { fromPrice, priceBands, soldOut, whatsappNumber, type MenuProduct } from './api'

const p = (sizes: [number, boolean][]) => ({ sizes: sizes.map(([priceIQD, available], i) => ({ id: String(i), label: '', size: 0, unit: 'ml', ml: 0, priceIQD, available })) }) as unknown as MenuProduct

describe('menu helpers', () => {
  it('turns Iraqi phone numbers into WhatsApp numbers', () => {
    expect(whatsappNumber('0750 730 8005')).toBe('9647507308005')
    expect(whatsappNumber('+964 750 730 8005')).toBe('9647507308005')
    expect(whatsappNumber('00964 750 730 8005')).toBe('9647507308005')
    expect(whatsappNumber('')).toBeNull()
    expect(whatsappNumber('123')).toBeNull()
  })

  it('"from" price is the cheapest size a customer can buy now', () => {
    expect(fromPrice(p([[45000, true], [30000, true]]))).toBe(30000)
    expect(fromPrice(p([[45000, true], [30000, false]]))).toBe(45000) // the cheap size is sold out
    expect(fromPrice(p([[45000, false], [30000, false]]))).toBe(30000) // all sold out: still show a price
  })

  it('price filter bands follow the shop’s own prices, in round numbers', () => {
    expect(priceBands([30000, 36000, 38000, 42000, 44000, 45000])).toEqual([40000, 45000])
    expect(priceBands([12000, 15000, 18000, 95000, 120000, 150000])).toEqual([20000, 120000])
    expect(priceBands([30000, 31000, 32000])).toEqual([31000, 32000]) // close prices: a finer round number
    expect(priceBands([30000, 30000, 45000])).toBeNull() // too few prices to split
    expect(priceBands([])).toBeNull()
  })

  it('a perfume is sold out only when every size is', () => {
    expect(soldOut(p([[1, false], [2, true]]))).toBe(false)
    expect(soldOut(p([[1, false], [2, false]]))).toBe(true)
  })
})
