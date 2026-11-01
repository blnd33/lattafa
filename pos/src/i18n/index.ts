import { useCallback } from 'react'
import type { Lang } from '@/data/types'
import { useUI } from '@/store/ui'
import { isAppError } from '@/services/context'
import { en } from './en'
import { ar } from './ar'
import { ku } from './ku'

export type Dict = Record<string, string>
export type TFn = (key: string, vars?: Record<string, string | number>) => string

export const DICTS: Record<Lang, Dict> = { en, ar, ku }
export const LANGS: { code: Lang; label: string; native: string }[] = [
  { code: 'en', label: 'EN', native: 'English' },
  { code: 'ar', label: 'عربي', native: 'العربية' },
  { code: 'ku', label: 'کوردی', native: 'کوردی سۆرانی' },
]
export const isRtl = (l: Lang) => l !== 'en'
export const htmlLang = (l: Lang) => (l === 'ku' ? 'ckb' : l)

export function translate(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  let s = DICTS[lang][key] ?? DICTS.en[key] ?? key
  if (vars) for (const k of Object.keys(vars)) s = s.split(`{${k}}`).join(String(vars[k]))
  return s
}

/** `const t = useT()` → t('sell.pay') — re-renders when the language changes. */
export function useT(): TFn {
  const lang = useUI((s) => s.lang)
  return useCallback((key, vars) => translate(lang, key, vars), [lang])
}

/** Localised message for anything a service threw. */
export function errorMessage(e: unknown, t: TFn): string {
  if (isAppError(e)) {
    const key = `err.${e.code}`
    const msg = t(key, e.params as Record<string, string | number>)
    return msg === key ? t('err.unknown') : msg
  }
  if (e instanceof Error && e.name === 'QuotaExceededError') return t('err.storage_full')
  return t('err.unknown')
}

/** Pick the right language of a multilingual text, falling back sensibly. */
export function pick(text: Record<Lang, string> | undefined, lang: Lang): string {
  if (!text) return ''
  return text[lang] || text.en || text.ar || text.ku || ''
}
