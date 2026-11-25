import type { ReactNode } from 'react'

/**
 * The little Markdown the assistant writes — paragraphs, headings, bullet and numbered lists, tables, **bold**,
 * *italic* and `code` — turned into elements directly (never into HTML), so nothing in an answer can run as code.
 * `dir="auto"` lets each block follow its own language, and each table cell is isolated (`<bdi>`), so "100 ml" stays
 * "100 ml" inside an Arabic or Kurdish table instead of turning into "ml 100".
 */
export function Markdown({ text }: { text: string }) {
  return <div className="space-y-2.5 text-[15px] leading-relaxed">{blocks(text)}</div>
}

const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l)
const isRule = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l)
const bullet = /^\s*[-*•]\s+(.*)$/
const numbered = /^\s*(\d+)[.)]\s+(.*)$/
const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())

function blocks(text: string): ReactNode[] {
  const lines = text.replace(/\r/g, '').split('\n')
  const out: ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }

    const h = /^\s*(#{1,4})\s+(.*)$/.exec(line)
    if (h) {
      out.push(<p key={i} dir="auto" className="pt-1 font-semibold">{inline(h[2])}</p>)
      i++
      continue
    }
    if (isTableRow(line) && i + 1 < lines.length && isRule(lines[i + 1])) {
      const head = cells(line)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]))
      out.push(
        // the cells are isolated, so dir="auto" would see no text: Arabic or Kurdish in the table makes it right-to-left
        <div key={i} dir={/[\u0600-\u06FF]/.test([...head, ...rows.flat()].join(' ')) ? 'rtl' : 'ltr'} className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-max border-collapse text-sm">
            <thead><tr>{head.map((c, j) => <th key={j} className="border-b border-line px-2 py-1.5 text-start font-semibold"><bdi>{inline(c)}</bdi></th>)}</tr></thead>
            <tbody>{rows.map((r, k) => <tr key={k} className="border-b border-line/60 last:border-0">{r.map((c, j) => <td key={j} className="px-2 py-1.5 align-top"><bdi>{inline(c)}</bdi></td>)}</tr>)}</tbody>
          </table>
        </div>,
      )
      continue
    }
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line)
      const items: string[] = []
      while (i < lines.length && (ordered ? numbered : bullet).test(lines[i])) {
        const m = (ordered ? numbered : bullet).exec(lines[i++])!
        items.push(ordered ? m[2] : m[1])
      }
      const List = ordered ? 'ol' : 'ul'
      out.push(<List key={i} dir="auto" className={ordered ? 'list-decimal space-y-1 ps-5' : 'list-disc space-y-1 ps-5'}>{items.map((it, k) => <li key={k}>{inline(it)}</li>)}</List>)
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !isTableRow(lines[i]) && !bullet.test(lines[i]) && !numbered.test(lines[i]) && !/^\s*#{1,4}\s/.test(lines[i])) para.push(lines[i++])
    if (!para.length) para.push(lines[i++]) // a lone table row without a rule under it
    out.push(<p key={i} dir="auto" className="whitespace-pre-line">{inline(para.join('\n'))}</p>)
  }
  return out
}

/** **bold**, *italic* / _italic_, `code` */
function inline(s: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index))
    const t = m[0]
    if (t.startsWith('**')) out.push(<strong key={m.index} className="font-semibold">{t.slice(2, -2)}</strong>)
    else if (t.startsWith('`')) out.push(<code key={m.index} className="rounded bg-surface-2 px-1 py-0.5 text-[0.9em]">{t.slice(1, -1)}</code>)
    else out.push(<em key={m.index}>{t.slice(1, -1)}</em>)
    last = m.index + t.length
  }
  if (last < s.length) out.push(s.slice(last))
  return out
}
