import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowUp, KeyRound, MessageSquarePlus, RotateCcw, Sparkles, Square } from 'lucide-react'
import { RequireAny } from '@/features/NoAccess'
import { Button } from '@/components/ui/Button'
import { Card, Spinner } from '@/components/ui/Controls'
import { cn } from '@/components/ui/cn'
import { errorMessage, useT } from '@/i18n'
import { AppError } from '@/services/context'
import { useSession } from '@/store/session'
import { askAssistant, assistantStatus, type ChatMessage } from './api'
import { Markdown } from './Markdown'

/** Questions offered on an empty chat — one tap to ask. */
export const SUGGESTIONS = ['today', 'best', 'profit', 'debts', 'suppliers', 'low', 'delegates', 'slow', 'wholesale', 'expenses'] as const

/** The last turns sent back with each question: enough context for follow-ups, without growing for ever. */
const HISTORY_SENT = 20
const KEEP = 60

/** Admin panel → Assistant: ask about the shop in your own words; the answers come from the live figures. */
export function AssistantPage() {
  return <RequireAny perms={['assistant.use']}><Assistant /></RequireAny>
}

/** The conversation is kept in this browser, per person (a refresh keeps it; "New chat" clears it). */
function useChatHistory(userId: string | undefined) {
  const key = `lattafa-assistant:${userId ?? ''}`
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try { return JSON.parse(localStorage.getItem(key) ?? '[]') as ChatMessage[] } catch { return [] }
  })
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(messages.slice(-KEEP))) } catch { /* private window or full storage: the chat still works */ }
  }, [key, messages])
  return [messages, setMessages] as const
}

function Assistant() {
  const t = useT()
  const actor = useSession((s) => s.actor)
  const status = useQuery({ queryKey: ['assistant-status'], queryFn: assistantStatus, staleTime: 60_000 })
  const [messages, setMessages] = useChatHistory(actor?.id)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)
  const end = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }) }, [messages.length, step, error])
  useEffect(() => () => abort.current?.abort(), [])

  const send = async (question: string, base = messages) => {
    const q = question.trim()
    if (!q || busy) return
    const convo: ChatMessage[] = [...base, { role: 'user', content: q }]
    setMessages(convo)
    setDraft('')
    setError(null)
    setBusy(true)
    setStep(null)
    const ctrl = new AbortController()
    abort.current = ctrl
    try {
      // a conversation sent to the server always starts with a question
      const recent = convo.slice(-HISTORY_SENT)
      const start = recent.findIndex((m) => m.role === 'user')
      await askAssistant(recent.slice(start), (e) => {
        if (e.type === 'tool') setStep(e.name)
        else if (e.type === 'answer') setMessages([...convo, { role: 'assistant', content: e.text || '…' }])
        else setError(errorMessage(new AppError(e.code), t))
      }, ctrl.signal)
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') setError(errorMessage(e, t))
    } finally {
      setBusy(false)
      setStep(null)
      abort.current = null
      input.current?.focus()
    }
  }

  const retry = () => {
    const lastQ = [...messages].reverse().find((m) => m.role === 'user')
    if (!lastQ) return
    const base = messages.slice(0, messages.lastIndexOf(lastQ))
    void send(lastQ.content, base)
  }

  const onSubmit = (e: FormEvent) => { e.preventDefault(); void send(draft) }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends, Shift+Enter is a new line (phones keep their own Enter as a new line: they have the send button)
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && matchMedia('(pointer: fine)').matches) { e.preventDefault(); void send(draft) }
  }

  if (status.isLoading) return <div className="grid h-80 place-items-center"><Spinner className="size-9" /></div>
  if (status.isError) return <div className="mx-auto max-w-3xl p-4 md:p-6"><Card><p className="py-8 text-center text-sm">{errorMessage(status.error, t)}</p></Card></div>

  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 pt-4 md:px-6 md:pt-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 font-serif text-2xl font-semibold leading-tight sm:text-3xl"><Sparkles className="size-6 shrink-0 text-gold-text" />{t('as.title')}</h1>
          <p className="mt-1 text-sm text-fg-2">{t('as.subtitle')}</p>
        </div>
        {messages.length > 0 && (
          <Button variant="secondary" icon={<MessageSquarePlus className="size-5" />} disabled={busy} onClick={() => { setMessages([]); setError(null) }}>{t('as.new_chat')}</Button>
        )}
      </div>

      {!status.data?.configured ? (
        <Card className="flex flex-col items-start gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-gold-soft text-gold-text dark:bg-gold/15"><KeyRound className="size-5" /></span>
          <h2 className="font-semibold">{t('as.setup_title')}</h2>
          <p className="text-sm text-fg-2">{t('as.setup_body')}</p>
          <code dir="ltr" className="block w-full overflow-x-auto rounded-lg bg-surface-2 px-3 py-2 text-xs">ANTHROPIC_API_KEY=sk-ant-…</code>
        </Card>
      ) : (
        <>
          <div className="flex-1 space-y-4 pb-4" aria-live="polite">
            {!messages.length && <Welcome onPick={(q) => void send(q)} />}
            {messages.map((m, i) => <Bubble key={i} m={m} />)}
            {busy && (
              <div className="flex items-center gap-2.5 text-sm text-fg-2">
                <Spinner className="size-4" />
                <span>{step ? t(`as.tool_${step}`) : t('as.thinking')}</span>
              </div>
            )}
            {error && (
              <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl bg-danger-bg px-4 py-3 text-sm text-danger-fg">
                <AlertTriangle className="size-5 shrink-0" />
                <span className="min-w-0 flex-1">{error}</span>
                <button type="button" onClick={retry} className="inline-flex items-center gap-1.5 font-semibold underline"><RotateCcw className="size-4" />{t('as.retry')}</button>
              </div>
            )}
            <div ref={end} />
          </div>

          <form onSubmit={onSubmit} className="sticky bottom-0 -mx-4 border-t border-line bg-bg/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur md:-mx-6 md:px-6">
            <div className="flex items-end gap-2 rounded-2xl border border-line bg-surface p-1.5 shadow-soft focus-within:border-gold focus-within:ring-4 focus-within:ring-gold/20">
              <textarea
                ref={input}
                value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, 4000))}
                onKeyDown={onKey}
                rows={1}
                dir="auto"
                aria-label={t('as.placeholder')}
                placeholder={t('as.placeholder')}
                className="max-h-40 min-h-11 min-w-0 flex-1 resize-none bg-transparent px-2.5 py-2.5 text-base outline-none [field-sizing:content] placeholder:text-fg-2/70 sm:text-sm"
              />
              {busy ? (
                <button type="button" onClick={() => abort.current?.abort()} aria-label={t('as.stop')} className="grid size-11 shrink-0 place-items-center rounded-xl bg-surface-2 text-fg transition hover:bg-gold-soft"><Square className="size-4 fill-current" /></button>
              ) : (
                <button type="submit" disabled={!draft.trim()} aria-label={t('as.send')} className="grid size-11 shrink-0 place-items-center rounded-xl bg-gold text-ink transition enabled:hover:brightness-105 disabled:opacity-40"><ArrowUp className="size-5" /></button>
              )}
            </div>
            <p className="mt-1.5 text-center text-[11px] text-fg-2">{t('as.footnote')}</p>
          </form>
        </>
      )}
    </div>
  )
}

function Welcome({ onPick }: { onPick: (q: string) => void }) {
  const t = useT()
  return (
    <div className="flex flex-col items-center gap-5 py-6 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-charcoal to-ink text-gold"><Sparkles className="size-7" /></span>
      <div>
        <h2 className="font-serif text-xl font-semibold">{t('as.welcome_title')}</h2>
        <p className="mt-1 text-sm text-fg-2">{t('as.welcome_body')}</p>
      </div>
      <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((k) => (
          <button key={k} type="button" onClick={() => onPick(t(`as.q_${k}`))}
            className="min-h-12 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-start text-sm transition hover:border-gold hover:bg-gold-soft/40 active:scale-[.99] dark:hover:bg-gold/10">
            {t(`as.q_${k}`)}
          </button>
        ))}
      </div>
    </div>
  )
}

function Bubble({ m }: { m: ChatMessage }) {
  if (m.role === 'user') {
    return (
      <div className="flex justify-end">
        <div dir="auto" className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-ee-md bg-gold-soft px-4 py-2.5 text-[15px] dark:bg-gold/20">{m.content}</div>
      </div>
    )
  }
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-charcoal to-ink text-gold"><Sparkles className="size-4" /></span>
      <div className={cn('min-w-0 flex-1 break-words rounded-2xl rounded-ss-md border border-line bg-surface px-4 py-3 shadow-soft')}><Markdown text={m.content} /></div>
    </div>
  )
}
