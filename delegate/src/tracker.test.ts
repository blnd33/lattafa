import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Actor } from '@/data/types'
import { setActor } from '@/services/context'
import { ddb } from './data'
import { MIN_GAP_MS, flushTrail, recordFix, resetTracker, shouldKeep, type Fix } from './tracker'

const actor = (id: string): Actor => ({
  id, name: id, username: id, roleId: 'r', roleKey: 'delegate', roleName: 'Delegate', color: '#000',
  permissions: ['delegate.visit'], limits: { maxDiscountPct: 0, maxRefundIQD: 0 }, isSuperAdmin: false,
})
const DUHOK = { lat: 36.8669, lng: 42.9503 }
const fix = (over: Partial<Fix> = {}): Fix => ({ ...DUHOK, accuracyM: 10, at: 1_000_000, ...over })

beforeEach(async () => {
  await ddb.delete()
  await ddb.open()
  resetTracker()
  setActor(actor('ahmed'))
})
afterEach(() => { vi.unstubAllGlobals(); setActor(null) })

describe('which readings are kept', () => {
  it('the first fix, then every few minutes or after moving ~50 m — not GPS jitter or vague fixes', () => {
    const first = fix()
    expect(shouldKeep(null, first)).toBe(true)
    expect(shouldKeep(null, fix({ accuracyM: 2000 }))).toBe(false) // a cell-tower guess
    expect(shouldKeep(first, fix({ lat: DUHOK.lat + 0.0001, at: first.at + 60_000 }))).toBe(false) // ~11 m: standing still
    expect(shouldKeep(first, fix({ lat: DUHOK.lat + 0.001, at: first.at + 60_000 }))).toBe(true) // ~110 m: moved
    expect(shouldKeep(first, fix({ at: first.at + MIN_GAP_MS }))).toBe(true) // still there, a few minutes later
    // a fix ±200 m off does not count as moving 110 m
    expect(shouldKeep(first, fix({ lat: DUHOK.lat + 0.001, accuracyM: 200, at: first.at + 60_000 }))).toBe(false)
  })
})

describe('the trail', () => {
  it('is kept per person and sent for the one signed in', async () => {
    await recordFix(fix({ at: 1 }))
    await recordFix(fix({ at: 2 + MIN_GAP_MS }))
    setActor(actor('omar')); resetTracker()
    await recordFix(fix({ at: 5 }))
    const sent: unknown[] = []
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)))
      return new Response(JSON.stringify({ saved: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    expect(await flushTrail()).toBe(1) // only Omar's point goes with Omar's sign-in
    expect(sent).toEqual([{ points: [{ ...DUHOK, accuracyM: 10, at: 5 }] }])
    expect((await ddb.trail.toArray()).map((p) => p.userId)).toEqual(['ahmed', 'ahmed'])
  })

  it('waits on the phone when there is no signal, and is dropped if the server will never take it', async () => {
    await recordFix(fix())
    vi.stubGlobal('fetch', async () => { throw new TypeError('offline') })
    expect(await flushTrail()).toBe(0)
    expect(await ddb.trail.count()).toBe(1)
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: { code: 'not_a_delegate', params: {} } }), { status: 403, headers: { 'Content-Type': 'application/json' } }))
    await flushTrail()
    expect(await ddb.trail.count()).toBe(0)
  })

  it('records nothing when nobody is signed in', async () => {
    setActor(null)
    expect(await recordFix(fix())).toBe(false)
    expect(await ddb.trail.count()).toBe(0)
  })
})
