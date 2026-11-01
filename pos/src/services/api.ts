/**
 * The one HTTP client for the Lattafa API (`/api/v1` on the same domain), shared by the POS, the delegate app and the
 * menu. Server errors arrive as `{error:{code,params}}` and are re-thrown as the same `AppError` the local services use,
 * so every screen shows the same translated message whether a rule was checked here or on the server.
 */
import { AppError } from './context'

export const API_BASE = '/api/v1'

let token: string | null = null
let deviceId: string | null = null
let onUnauthorized: (() => void) | null = null

export const setApiToken = (t: string | null) => { token = t }
export const getApiToken = () => token
export const setApiDevice = (id: string | null) => { deviceId = id }
/** Called when the server says the session is gone (token revoked, password reset, device revoked…). */
export const setUnauthorizedHandler = (fn: (() => void) | null) => { onUnauthorized = fn }

/** No network, server down, or a proxy error page — the request never reached the API. */
export const OFFLINE = 'offline'
export const isOfflineError = (e: unknown): boolean => e instanceof AppError && e.code === OFFLINE

export interface ApiOptions {
  /** Abort after this many ms (default 15 s; sync uses longer). */
  timeoutMs?: number
  /** Send without the signed-in person's token (setup, sign-in, public menu). */
  anonymous?: boolean
  /** Use this token instead of the current one (e.g. pushing with a cashier's cached token). */
  token?: string | null
}

/** `body` is sent as JSON — or as it is when it's a Blob (a piece of an uploaded file). */
export async function api<T = unknown>(method: string, path: string, body?: unknown, opts: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  const raw = typeof Blob !== 'undefined' && body instanceof Blob
  if (body !== undefined) headers['Content-Type'] = raw ? 'application/octet-stream' : 'application/json'
  const tok = opts.anonymous ? null : (opts.token ?? token)
  if (tok) headers.Authorization = `Bearer ${tok}`
  if (deviceId) headers['X-Device-Id'] = deviceId

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15_000)
  let res: Response
  try {
    res = await fetch(API_BASE + path, { method, headers, body: body === undefined ? undefined : raw ? (body as Blob) : JSON.stringify(body), signal: ctrl.signal, credentials: 'omit' })
  } catch {
    throw new AppError(OFFLINE)
  } finally {
    clearTimeout(timer)
  }

  const isJson = (res.headers.get('Content-Type') ?? '').includes('application/json')
  const data = isJson ? await res.json().catch(() => null) : null
  if (res.ok) return data as T

  // A gateway/proxy page (502/503/504 HTML) means the API itself is unreachable.
  if (!isJson && res.status >= 500) throw new AppError(OFFLINE)
  const err = (data as { error?: { code?: string; params?: Record<string, string | number> } } | null)?.error
  const code = err?.code ?? (res.status === 401 ? 'not_signed_in' : res.status >= 500 ? 'server_error' : 'http_error')
  if (res.status === 401 && code === 'not_signed_in' && tok && !opts.token) onUnauthorized?.()
  throw new AppError(code, err?.params ?? {})
}

/** Is the API there? (Used at start-up to decide between connected and local mode.) */
export async function pingServer(timeoutMs = 2500): Promise<boolean> {
  try {
    const r = await api<{ ok?: boolean; app?: string }>('GET', '/health', undefined, { anonymous: true, timeoutMs })
    return !!r?.ok && r.app === 'lattafa'
  } catch {
    return false
  }
}
