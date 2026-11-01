import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Lang } from '@/data/types'

export type ThemeChoice = 'light' | 'dark' | 'system'

interface UIState {
  lang: Lang
  theme: ThemeChoice
  sidebarOpen: boolean
  setLang: (l: Lang) => void
  setTheme: (t: ThemeChoice) => void
  toggleSidebar: () => void
}

export const useUI = create<UIState>()(
  persist(
    (set) => ({
      lang: 'en',
      theme: 'system',
      sidebarOpen: true,
      setLang: (lang) => set({ lang }),
      setTheme: (theme) => set({ theme }),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
    }),
    { name: 'lattafa-ui' },
  ),
)
