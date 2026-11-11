// src/shared/services/httpStream.ts
// Общий POST-стример для Ollama (NDJSON) и DeepSeek (SSE).

import { AIError } from './aiTypes'
import { readLines, withIdleTimeout } from './streamUtils'

export interface PostStreamOptions {
  signal?: AbortSignal
  idleMs?: number
  provider: string
}

/** Достаём человекочитаемое сообщение из тела ошибки (JSON или текст) */
export function extractErrorMessage(raw: string): string {
  const text = raw.trim()
  if (!text) return ''
  try {
    const j = JSON.parse(text)
    const m = j?.error?.message ?? j?.error ?? j?.message
    if (typeof m === 'string') return m
  } catch { /* не JSON */ }
  return text.slice(0, 300)
}

/**
 * Делает POST и скармливает построчно тело ответа в onLine.
 * onLine может вернуть true — тогда чтение останавливается (получили done).
 */
export async function postStream(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  opts: PostStreamOptions,
  onLine: (line: string) => boolean | void
): Promise<void> {
  const idle = withIdleTimeout(opts.signal, opts.idleMs)
  try {
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: idle.signal,
      })
    } catch (e) {
      throw mapFetchError(e, idle, opts)
    }

    if (!res.ok) {
      const raw = await res.text().catch(() => '')
      throw new AIError(extractErrorMessage(raw) || res.statusText, 'http', res.status, opts.provider)
    }
    if (!res.body) throw new AIError('Пустой ответ сервера', 'network', undefined, opts.provider)

    try {
      for await (const line of readLines(res.body)) {
        idle.touch()
        if (onLine(line) === true) break
      }
    } catch (e) {
      if (e instanceof AIError) throw e
      throw mapFetchError(e, idle, opts)
    }
  } finally {
    idle.done()
  }
}

function mapFetchError(
  e: unknown,
  idle: { timedOut: boolean },
  opts: PostStreamOptions
): AIError {
  if (idle.timedOut) return new AIError('Таймаут ожидания ответа', 'timeout', undefined, opts.provider)
  const aborted =
    opts.signal?.aborted ||
    (e instanceof DOMException && e.name === 'AbortError') ||
    (e as { name?: string })?.name === 'AbortError'
  if (aborted) return new AIError('Прервано', 'aborted', undefined, opts.provider)
  const msg = e instanceof Error ? e.message : String(e)
  return new AIError(msg, 'network', undefined, opts.provider)
}
