/** The activity log's wording. The filter's groups: every area that writes to the log (an action's code starts with its group). */
export const AUDIT_GROUPS = ['auth', 'device', 'sale', 'return', 'shift', 'stock', 'product', 'prices', 'customer', 'delegate', 'order', 'purchase', 'supplier', 'expense', 'user', 'role', 'settings', 'menu']

const auditValue = (v: unknown) => (typeof v === 'number' ? v.toLocaleString('en-US') : v === '' ? '—' : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v))

/** An entry's details in one line: changes as "old → new" (prices, settings, credit limit), the rest as "name: value". */
export function auditDetails(meta: Record<string, unknown>): string {
  return Object.entries(meta)
    .filter(([, v]) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0))
    .map(([k, v]) => {
      if (k === 'prices' && Array.isArray(v)) return v.map((p: { size?: string; price?: string; from?: unknown; to?: unknown }) => `${p.size} ${p.price}: ${auditValue(p.from)} → ${auditValue(p.to)}`).join(', ')
      if (k === 'changes' && v && typeof v === 'object' && !Array.isArray(v)) return Object.entries(v as Record<string, unknown[]>).map(([path, [a, b]]) => `${path}: ${auditValue(a)} → ${auditValue(b)}`).join(', ')
      if (Array.isArray(v) && v.length === 2 && v.every((x) => typeof x !== 'object' || x === null) && k !== 'changed') return `${k}: ${auditValue(v[0])} → ${auditValue(v[1])}`
      return `${k}: ${Array.isArray(v) ? v.join(', ') : auditValue(v)}`
    })
    .join(' · ')
}
