/** Date helpers. Latin digits in every language (numbers stay readable at a glance). */
const date = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
const dt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })

export const fmtDate = (t: number) => date.format(t)
export const fmtTime = (t: number) => time.format(t)
export const fmtDateTime = (t: number) => dt.format(t)

/** <input type="date"> value (yyyy-mm-dd) for a timestamp, in local time. */
export function toInputDate(t: number): string {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function fromInputDate(s: string, endOfDay = false): number {
  const [y, m, d] = s.split('-').map(Number)
  const x = new Date(y, (m || 1) - 1, d || 1, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0)
  return x.getTime()
}

/** "2h 15m" style duration. */
export function fmtDuration(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000))
  const h = Math.floor(m / 60)
  return h ? `${h}h ${m % 60}m` : `${m}m`
}
