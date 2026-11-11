// src/shared/services/streamUtils.ts
// Мелкие утилиты для потоковых ответов (NDJSON у Ollama, SSE у DeepSeek).

/** Читает ReadableStream построчно. Пустые строки пропускает. */
export async function* readLines(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<string, void, void> {
  const reader = stream.getReader()
  const decoder = new TextDecoder('utf-8')
  let buf = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, '')
        buf = buf.slice(idx + 1)
        if (line) yield line
      }
    }
    buf += decoder.decode()
    const tail = buf.trim()
    if (tail) yield tail
  } finally {
    try { await reader.cancel() } catch { /* уже закрыт */ }
  }
}

/** Содержимое SSE-строки `data: ...` либо null, если это не data-строка */
export function sseData(line: string): string | null {
  if (!line.startsWith('data:')) return null
  return line.slice(5).trim()
}

/**
 * Вырезает блоки <think>…</think> из потока (на случай, если модель
 * «думает» прямо в контенте). Корректно работает, если тег разрезан между чанками.
 */
export class ThinkFilter {
  private inThink = false
  private pending = ''
  private static OPEN = '<think>'
  private static CLOSE = '</think>'

  private static partialSuffix(s: string, tag: string): string {
    const max = Math.min(s.length, tag.length - 1)
    for (let n = max; n > 0; n--) {
      if (tag.startsWith(s.slice(s.length - n))) return s.slice(s.length - n)
    }
    return ''
  }

  push(chunk: string): string {
    let s = this.pending + chunk
    this.pending = ''
    let out = ''
    while (s.length) {
      if (this.inThink) {
        const i = s.indexOf(ThinkFilter.CLOSE)
        if (i === -1) {
          this.pending = ThinkFilter.partialSuffix(s, ThinkFilter.CLOSE)
          return out
        }
        s = s.slice(i + ThinkFilter.CLOSE.length).replace(/^\s+/, '')
        this.inThink = false
      } else {
        const i = s.indexOf(ThinkFilter.OPEN)
        if (i === -1) {
          const keep = ThinkFilter.partialSuffix(s, ThinkFilter.OPEN)
          out += s.slice(0, s.length - keep.length)
          this.pending = keep
          return out
        }
        out += s.slice(0, i)
        s = s.slice(i + ThinkFilter.OPEN.length)
        this.inThink = true
      }
    }
    return out
  }

  /** Вызвать в конце потока — отдаёт «хвост», который мог быть началом тега */
  flush(): string {
    const rest = this.inThink ? '' : this.pending
    this.pending = ''
    return rest
  }
}

/**
 * Склеивает внешний AbortSignal с «idle-таймером»: если от сервера долго нет ни байта,
 * запрос обрывается. Модель может грузиться десятки секунд, поэтому по умолчанию 90 c.
 */
export function withIdleTimeout(external: AbortSignal | undefined, idleMs = 90_000) {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | null = null
  let timedOut = false

  const arm = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, idleMs)
  }
  const onExternalAbort = () => controller.abort()

  if (external) {
    if (external.aborted) controller.abort()
    else external.addEventListener('abort', onExternalAbort, { once: true })
  }
  arm()

  return {
    signal: controller.signal,
    /** Вызывать при каждом полученном чанке */
    touch: arm,
    get timedOut() { return timedOut },
    done() {
      if (timer) clearTimeout(timer)
      external?.removeEventListener('abort', onExternalAbort)
    },
  }
}
