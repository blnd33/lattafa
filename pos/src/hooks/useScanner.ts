import { useEffect, useRef } from 'react'
import { cleanCode } from '@/lib/code128'

/** A scanner presses physical keys, so its digits are read from the key itself: the keyboard's language can't change them. */
function scannedChar(e: KeyboardEvent): string {
  const digit = /^(?:Digit|Numpad)(\d)$/.exec(e.code ?? '')
  if (digit && !e.shiftKey) return digit[1]
  return e.key.length === 1 ? cleanCode(e.key) : ''
}

/**
 * USB / Bluetooth barcode scanners behave like a very fast keyboard: they "type"
 * the code and press Enter. We watch for that pattern anywhere on the page —
 * ≥ minLength characters, each arriving < maxGapMs after the previous, then Enter.
 * Scanners often stall briefly (usually right after the first digit), so one pause of
 * up to maxPauseMs is allowed per code; losing what came before it would lose the digit.
 * A person typing by hand is never that fast, so normal typing is unaffected.
 * If the scan happened to land inside a text field, the scanned text is removed
 * from it again so the search box doesn't fill with a barcode.
 */
export function useScanner(onScan: (code: string) => void, opts: { enabled?: boolean; minLength?: number; maxGapMs?: number; maxPauseMs?: number } = {}) {
  const { enabled = true, minLength = 4, maxGapMs = 50, maxPauseMs = 300 } = opts
  const cb = useRef(onScan)
  cb.current = onScan

  useEffect(() => {
    if (!enabled) return
    let buf = ''
    let typed = '' // the same keys as the page received them, which is what a text field holds
    let paused = false
    let last = 0
    const reset = () => { buf = ''; typed = ''; paused = false }
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const now = performance.now()
      if (e.key === 'Enter') {
        if (buf.length >= minLength) {
          e.preventDefault()
          e.stopPropagation()
          const code = buf
          const t = e.target as HTMLElement | null
          if (t instanceof HTMLInputElement && typed && t.value.endsWith(typed)) {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
            setter?.call(t, t.value.slice(0, -typed.length))
            t.dispatchEvent(new Event('input', { bubbles: true }))
          }
          reset()
          cb.current(code)
        }
        reset()
        return
      }
      const ch = scannedChar(e)
      if (!ch) return
      const gap = now - last
      if (gap > maxGapMs) {
        if (buf && !paused && gap <= maxPauseMs) paused = true
        else reset()
      }
      buf += ch
      if (e.key.length === 1) typed += e.key
      last = now
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [enabled, minLength, maxGapMs])
}
