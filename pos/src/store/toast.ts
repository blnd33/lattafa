import { create } from 'zustand'

export interface Toast {
  id: number
  kind: 'success' | 'error' | 'info'
  text: string
}

interface ToastState {
  items: Toast[]
  push: (kind: Toast['kind'], text: string) => void
  dismiss: (id: number) => void
}

let counter = 0

export const useToast = create<ToastState>((set) => ({
  items: [],
  push: (kind, text) => {
    const id = ++counter
    set((s) => ({ items: [...s.items.slice(-3), { id, kind, text }] }))
    setTimeout(() => set((s) => ({ items: s.items.filter((t) => t.id !== id) })), kind === 'error' ? 6000 : 3200)
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}))

export const toast = {
  success: (text: string) => useToast.getState().push('success', text),
  error: (text: string) => useToast.getState().push('error', text),
  info: (text: string) => useToast.getState().push('info', text),
}
