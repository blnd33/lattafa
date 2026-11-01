import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'

export type PaperKind = '58' | '80' | 'a4' | 'label'

interface PrintState {
  node: ReactNode | null
  paper: PaperKind
  labelSize: { w: number; h: number }
  print: (node: ReactNode, paper: PaperKind, labelSize?: { w: number; h: number }) => void
  clear: () => void
}

export const usePrint = create<PrintState>((set) => ({
  node: null,
  paper: '80',
  labelSize: { w: 50, h: 30 },
  print: (node, paper, labelSize) => set((s) => ({ node, paper, labelSize: labelSize ?? s.labelSize })),
  clear: () => set({ node: null }),
}))

function pageCss(paper: PaperKind, label: { w: number; h: number }): string {
  switch (paper) {
    case '58': return '@page{size:58mm auto;margin:0}'
    case '80': return '@page{size:80mm auto;margin:0}'
    case 'label': return `@page{size:${label.w}mm ${label.h}mm;margin:0}`
    default: return '@page{size:A4;margin:12mm}'
  }
}

/**
 * Mount once. Anything passed to `usePrint().print(node, paper)` is rendered into
 * an off-screen `.print-area` (visible only to @media print), the right @page size
 * is applied (58 mm / 80 mm thermal roll, A4, or a label), and the browser's print
 * dialog opens. Works with any printer the OS knows — USB, network, or a Bluetooth
 * thermal printer paired to the device — and "Save as PDF".
 */
export function PrintHost() {
  const { node, paper, labelSize, clear } = usePrint()

  useEffect(() => {
    if (!node) return
    let style = document.getElementById('print-page-size') as HTMLStyleElement | null
    if (!style) {
      style = document.createElement('style')
      style.id = 'print-page-size'
      document.head.appendChild(style)
    }
    style.textContent = pageCss(paper, labelSize)
    const done = () => clear()
    window.addEventListener('afterprint', done, { once: true })
    const timer = setTimeout(() => window.print(), 200)
    return () => { clearTimeout(timer); window.removeEventListener('afterprint', done) }
  }, [node, paper, labelSize, clear])

  if (!node) return null
  const width = paper === '58' ? '58mm' : paper === '80' ? '80mm' : paper === 'label' ? `${labelSize.w}mm` : '100%'
  return createPortal(
    <div className="print-area hidden bg-white text-black print:block" style={{ width }}>
      {node}
    </div>,
    document.body,
  )
}
