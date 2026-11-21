import { createContext, useContext } from 'react'
import type { Problem } from './api'

/**
 * The catalogue's words come from the server, not from this repository.
 *
 * `GET /wholesale/open` returns the whole dictionary in the chosen language — English underneath, that language
 * on top — so the owner translates the catalogue from the admin panel and it reads differently the same evening,
 * with no deploy. Every key used here is in `App\Support\CatalogueStrings`, which is both the English fallback
 * and the list the translations screen measures a language against.
 *
 * A key with no word behind it falls back to its own name. That is deliberate: a blank button looks like the shop
 * is broken, while a visible `cat.something` looks like what it is — a translation nobody has written yet.
 */
export type Words = Record<string, string>
export type T = (key: string, vars?: Record<string, string | number>) => string

export const WordsContext = createContext<Words>({})

export function translate(words: Words, key: string, vars?: Record<string, string | number>): string {
  let s = words[key] ?? key
  if (vars) for (const k of Object.keys(vars)) s = s.split(`{${k}}`).join(String(vars[k]))
  return s
}

export function useT(): T {
  const words = useContext(WordsContext)
  return (key, vars) => translate(words, key, vars)
}

/**
 * "1 perfume" rather than "1 perfumes".
 *
 * The one-of-it wording lives under the same key with `_1` on the end, which is the shape the rest of the system
 * already uses. A language that has not written one simply falls back to the plural, which is clumsy but readable
 * — better than a sentence this code tried to assemble itself.
 */
export function useP(): (key: string, n: number, vars?: Record<string, string | number>) => string {
  const words = useContext(WordsContext)
  return (key, n, vars) => {
    const one = `${key}_1`
    return translate(words, n === 1 && words[one] ? one : key, { n, ...vars })
  }
}

/**
 * What a buyer is told when the server refuses something.
 *
 * The server sends a code and its figures and never a sentence (`min_order{minimum,add}`, `code_expired`, …);
 * the sentence is the catalogue's, in the buyer's own language. Money arrives in cents, so it is turned into
 * dollars before it reaches the words.
 */
export function problemText(t: T, problem: Problem, money: (cents: number) => string): string {
  const params: Record<string, string | number> = { ...problem.params }
  for (const key of ['minimum', 'add', 'amount'] as const) {
    if (typeof params[key] === 'number') params[key] = money(params[key])
  }
  return t(`cat.err_${problem.code}`, params)
}

/** The shop's kinds of perfume, as the catalogue names them (`perfume`, `oud`, `mist`, `oil`, `set`, `home`). */
export const kindKey = (category: string): string => `cat.kind_${category}`

/** `men` | `women` | `unisex`. */
export const genderKey = (gender: string): string => `cat.${gender}`
