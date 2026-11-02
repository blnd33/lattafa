// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useScanner } from './useScanner'

const CODE = '6111111111116' // made up

let clock = 0
let scans: string[] = []

function Host({ withInput = false }: { withInput?: boolean }) {
  useScanner((c) => scans.push(c))
  return withInput ? <input data-testid="box" /> : null
}

/** One key press, `gap` ms after the previous one. A text field gets the character, as it would in a browser. */
function press(key: string, gap: number, init: KeyboardEventInit = {}, target: EventTarget = window) {
  clock += gap
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(e)
  if (target instanceof HTMLInputElement && key.length === 1 && !e.defaultPrevented) target.value += key
}

function scan(code: string, gaps: (i: number) => number, target?: EventTarget) {
  act(() => {
    ;[...code].forEach((ch, i) => press(ch, i === 0 ? 5000 : gaps(i), {}, target))
    press('Enter', 5, {}, target)
  })
}

beforeEach(() => {
  scans = []
  clock = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('useScanner', () => {
  it('reads a steady scan', () => {
    render(<Host />)
    scan(CODE, () => 5)
    expect(scans).toEqual([CODE])
  })

  it('keeps the first digit when the scanner pauses right after it', () => {
    render(<Host />)
    scan(CODE, (i) => (i === 1 ? 120 : 5))
    expect(scans).toEqual([CODE])
  })

  it('a scan that lands in a text field leaves nothing behind, first digit included', () => {
    const { getByTestId } = render(<Host withInput />)
    const box = getByTestId('box') as HTMLInputElement
    scan(CODE, (i) => (i === 1 ? 120 : 5), box)
    expect(scans).toEqual([CODE])
    expect(box.value).toBe('')
  })

  it('reads digits typed by a keyboard set to Arabic or Kurdish', () => {
    render(<Host />)
    scan('٦١١١١١١١١١١١٦', () => 5)
    expect(scans).toEqual([CODE])
  })

  it('reads the digit keys whatever character the keyboard layout gives them', () => {
    render(<Host />)
    act(() => {
      ;[...CODE].forEach((ch, i) => press(ch === '6' ? 'Dead' : '&', i === 0 ? 5000 : 5, { code: `Digit${ch}` }))
      press('Enter', 5)
    })
    expect(scans).toEqual([CODE])
  })

  it('a person typing at normal speed is not taken for a scanner', () => {
    render(<Host />)
    act(() => {
      ;[...'khamrah'].forEach((ch) => press(ch, 130))
      press('Enter', 130)
    })
    expect(scans).toEqual([])
  })

  it('a person typing a few letters and then pausing is not joined to them', () => {
    render(<Host />)
    act(() => {
      ;[...'ab'].forEach((ch) => press(ch, 150))
      press('c', 400)
      press('Enter', 150)
    })
    expect(scans).toEqual([])
  })
})
