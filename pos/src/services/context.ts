/**
 * Who is acting right now, plus the error types every service throws.
 *
 * Services are the only code that touches the database, and each one checks
 * permissions here — so a hidden button in the UI is never the only protection.
 * (When the Laravel API arrives it repeats these checks server-side.)
 */
import type { Actor } from '@/data/types'
import { hasPerm } from '@/lib/permissions'

let current: Actor | null = null

export const setActor = (a: Actor | null) => { current = a }
export const getActor = (): Actor | null => current

/** A business-rule failure. `code` maps to a translated message (errors.<code>). */
export class AppError extends Error {
  code: string
  params: Record<string, string | number>
  constructor(code: string, params: Record<string, string | number> = {}) {
    super(code)
    this.name = 'AppError'
    this.code = code
    this.params = params
  }
}

export class PermissionError extends AppError {
  permission: string
  constructor(permission: string) {
    super('forbidden', { permission })
    this.name = 'PermissionError'
    this.permission = permission
  }
}

export function requireActor(): Actor {
  if (!current) throw new AppError('not_signed_in')
  return current
}

export function assertCan(permission: string): Actor {
  const a = requireActor()
  if (!hasPerm(a.permissions, permission)) throw new PermissionError(permission)
  return a
}

export function can(permission: string): boolean {
  return !!current && hasPerm(current.permissions, permission)
}

export const isAppError = (e: unknown): e is AppError => e instanceof AppError
