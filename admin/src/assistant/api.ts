import { API_BASE, api, getApiToken } from '@/services/api'
import { AppError } from '@/services/context'

/** Admin panel → Assistant — see backend/app/Http/Controllers/Api/V1/AssistantController.php. */
export interface ChatMessage { role: 'user' | 'assistant'; content: string }

export type ChatEvent =
  | { type: 'tool'; name: string }
  | { type: 'answer'; text: string; stopped?: boolean }
  | { type: 'error'; code: string }

export const assistantStatus = () => api<{ configured: boolean; model: string | null }>('GET', '/assistant/status')

/**
 * Sends the conversation (ending with the new question) and calls `onEvent` for each line the server streams back:
 * the tools it reads while it works, then the answer. Resolves when the answer (or an error) has arrived.
 */
export async function askAssistant(messages: ChatMessage[], onEvent: (e: ChatEvent) => void, signal?: AbortSignal): Promise<void> {
  const token = getApiToken()
  let res: Response
  try {
    res = await fetch(`${API_BASE}/assistant/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson, application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ messages }),
      credentials: 'omit',
      signal,
    })
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e
    throw new AppError('offline')
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null) as { error?: { code?: string; params?: Record<string, string | number> } } | null
    throw new AppError(data?.error?.code ?? (res.status >= 500 ? 'offline' : 'http_error'), data?.error?.params ?? {})
  }
  if (!res.body) {
    for (const line of (await res.text()).split('\n')) if (line.trim()) onEvent(JSON.parse(line) as ChatEvent)
    return
  }
  // one JSON object per line; a line may arrive in pieces
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    let nl: number
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (line) onEvent(JSON.parse(line) as ChatEvent)
    }
    if (done) break
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as ChatEvent)
}
