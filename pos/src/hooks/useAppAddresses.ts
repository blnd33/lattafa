import { useEffect, useState } from 'react'
import { api } from '@/services/api'

/**
 * Where each Lattafa web app lives, so they can link to each other (admin → POS, POS → admin panel, …). On one domain
 * these are just the paths; with an address per app the server tells us the full addresses (`GET /apps`).
 */
export interface AppAddresses { menu: string; pos: string; delegate: string; admin: string }
export const SAME_DOMAIN: AppAddresses = { menu: '/menu/', pos: '/pos/', delegate: '/delegate/', admin: '/admin/' }

let known: AppAddresses | null = null
let asking: Promise<AppAddresses | null> | null = null

/** The server's answer, or null when there is none (no server — a till in local mode — or an older one). */
async function ask(): Promise<AppAddresses | null> {
  try {
    const r = await api<Partial<Record<keyof AppAddresses, unknown>>>('GET', '/apps', undefined, { anonymous: true, timeoutMs: 5000 })
    const pick = (k: keyof AppAddresses) => (typeof r?.[k] === 'string' && r[k] ? (r[k] as string) : SAME_DOMAIN[k])
    return { menu: pick('menu'), pos: pick('pos'), delegate: pick('delegate'), admin: pick('admin') }
  } catch {
    return null
  }
}

/** Without an answer the apps are taken to sit side by side on this domain. */
export const loadAppAddresses = async (): Promise<AppAddresses> => (await ask()) ?? SAME_DOMAIN

/** Asked once per page (again later if the server didn't answer); until then the same-domain paths. */
export function useAppAddresses(): AppAddresses {
  const [a, setA] = useState<AppAddresses>(known ?? SAME_DOMAIN)
  useEffect(() => {
    if (known) return
    let live = true
    void (asking ??= ask()).then((x) => {
      if (x) known = x
      else asking = null // no answer is not remembered: the next screen asks again
      if (live && x) setA(x)
    })
    return () => { live = false }
  }, [])
  return a
}
