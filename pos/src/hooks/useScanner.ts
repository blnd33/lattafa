import { useEffect, useRef } from 'react'

/**
 * USB / Bluetooth barcode scanners behave like a very fast keyboard: they "type"
 * the code and press Enter. We watch for that pattern anywhere on the page —
 * ≥ minLength characters, each arriving < maxGapMs after the previous, then Enter.
 * A person typing by hand is never that fast, so normal typing is unaffected.
 * If the scan happened to land inside a text field, the scanned text is removed
 * from it again so the search box doesn't fill with a barcode.
 */
export function useScanner(onScan: (code: string) => void, opts: { enabled?: boolean; minLength?: number; maxGapMs?: number } = {}) {
  const { enabled = true, minLength = 4, maxGapMs = 50 } = opts
  const cb = useRef(onScan)
  cb.current = onScan

  useEffect(() => {
    if (!enabled) return
    let buf = ''
    let last = 0
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const now = performance.now()
      if (e.key === 'Enter') {
        if (buf.length >= minLength) {
          e.preventDefault()
          e.stopPropagation()
          const code = buf
          buf = ''
          const t = e.target as HTMLElement | null
          if (t instanceof HTMLInputElement && t.value.endsWith(code)) {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
            setter?.call(t, t.value.slice(0, -code.length))
            t.dispatchEvent(new Event('input', { bubbles: true }))
          }
          cb.current(code)
        }
        buf = ''
        return
      }
      if (e.key.length !== 1) return
      if (now - last > maxGapMs) buf = ''
      buf += e.key
      last = now
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [enabled, minLength, maxGapMs])
}
