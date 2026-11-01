/**
 * Live location: while a delegate is signed in and the app is open, the phone's position is kept as a trail of points
 * — one every few minutes, or after moving about 50 m — and sent to the shop so the owner can see where they are and
 * the route they took. Points recorded with no signal wait on the phone and are sent later.
 *
 * Browsers give a web page the location only while it is on screen: when the phone is locked or another app is in
 * front, the trail pauses and starts again when the app is opened (the owner sees the last known place and time).
 */
import { create } from 'zustand'
import { api, isOfflineError } from '@/services/api'
import { getActor, isAppError } from '@/services/context'
import { ddb } from './data'
import { distanceKm } from './field'

/** starting = waiting for the first fix · on = sharing · denied = the delegate blocked it · unavailable = no GPS / not https */
export type TrackState = 'off' | 'starting' | 'on' | 'denied' | 'unavailable'
export const useTracker = create<{ state: TrackState; lastAt: number | null }>(() => ({ state: 'off', lastAt: null }))

export const MIN_MOVE_KM = 0.05
export const MIN_GAP_MS = 3 * 60_000
const SEND_EVERY_MS = 2 * 60_000
/** A fix less precise than this says little about where someone is (wifi/cell guesses), so it is not kept. */
export const MAX_ACCURACY_M = 500

export interface Fix { lat: number; lng: number; accuracyM: number; at: number }

/** Keep this fix? The first one, then one after moving ~50 m (more than the fix's own error) or every few minutes. */
export function shouldKeep(prev: Fix | null, next: Fix): boolean {
  if (next.accuracyM > MAX_ACCURACY_M) return false
  if (!prev) return true
  if (next.at - prev.at >= MIN_GAP_MS) return true
  return distanceKm(prev, next) >= Math.max(MIN_MOVE_KM, next.accuracyM / 1000)
}

let last: Fix | null = null
let watchId: number | null = null
let timer: ReturnType<typeof setInterval> | null = null
let sending = false

/** Stores a fix for the signed-in delegate when it is worth keeping. */
export async function recordFix(fix: Fix): Promise<boolean> {
  const actor = getActor()
  if (!actor || !shouldKeep(last, fix)) return false
  last = fix
  await ddb.trail.add({ userId: actor.id, lat: fix.lat, lng: fix.lng, accuracyM: Math.round(fix.accuracyM), at: fix.at })
  useTracker.setState({ lastAt: fix.at })
  if ((await ddb.trail.where('userId').equals(actor.id).count()) >= 10) void flushTrail()
  return true
}

/** Sends the signed-in delegate's waiting points. Points of someone else who used this phone wait for them. */
export async function flushTrail(): Promise<number> {
  const actor = getActor()
  if (!actor || sending) return 0
  sending = true
  try {
    const points = (await ddb.trail.where('userId').equals(actor.id).sortBy('at')).slice(0, 500)
    if (!points.length) return 0
    try {
      await api('POST', '/delegate-locations', { points: points.map(({ lat, lng, accuracyM, at }) => ({ lat, lng, accuracyM, at })) })
    } catch (e) {
      if (isOfflineError(e)) return 0 // no signal: they wait
      if (!isAppError(e)) return 0
      // the server will never take these (e.g. this account is not a delegate any more): don't retry forever
    }
    await ddb.trail.bulkDelete(points.map((p) => p.id!))
    return points.length
  } finally {
    sending = false
  }
}

const toFix = (p: GeolocationPosition): Fix => ({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy, at: p.timestamp || Date.now() })
const onFix = (p: GeolocationPosition) => { useTracker.setState({ state: 'on' }); void recordFix(toFix(p)) }
const onError = (e: GeolocationPositionError) => {
  if (e.code === e.PERMISSION_DENIED) useTracker.setState({ state: 'denied' })
  else if (useTracker.getState().state === 'starting' && e.code === e.POSITION_UNAVAILABLE) useTracker.setState({ state: 'unavailable' })
}
const fixNow = () => navigator.geolocation.getCurrentPosition(onFix, onError, { enableHighAccuracy: true, maximumAge: 30_000, timeout: 30_000 })
const onVisible = () => { if (document.visibilityState === 'visible') { fixNow(); void flushTrail() } }
const onOnline = () => { void flushTrail() }

/** Starts sharing the location (called when a delegate signs in). Returns the stop function. */
export function startTracking(): () => void {
  if (watchId !== null) return stopTracking
  if (typeof navigator === 'undefined' || !navigator.geolocation || (typeof window !== 'undefined' && !window.isSecureContext)) {
    useTracker.setState({ state: 'unavailable' })
    return stopTracking
  }
  useTracker.setState({ state: 'starting' })
  watchId = navigator.geolocation.watchPosition(onFix, onError, { enableHighAccuracy: true, maximumAge: 30_000, timeout: 60_000 })
  // standing still (at a shop) gives no new readings: ask every couple of minutes, and send what is waiting
  timer = setInterval(() => {
    if (!last || Date.now() - last.at >= MIN_GAP_MS) fixNow()
    void flushTrail()
  }, SEND_EVERY_MS)
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('online', onOnline)
  void flushTrail()
  return stopTracking
}

/** Stops sharing (sign out). Points not sent yet stay on the phone and go with this delegate's next sign-in. */
export function stopTracking(): void {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId)
  if (timer) clearInterval(timer)
  watchId = null
  timer = null
  last = null
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
  if (typeof window !== 'undefined') window.removeEventListener('online', onOnline)
  useTracker.setState({ state: 'off', lastAt: null })
}

/** For tests: forget the last kept fix. */
export const resetTracker = () => { last = null }
