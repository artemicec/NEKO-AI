// src/shared/plugins/netUtil.ts

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** fetch с таймаутом и внешним сигналом отмены */
export async function fetchJson<T = any>(
  url: string,
  opts: { signal?: AbortSignal; timeoutMs?: number; fetchFn?: FetchLike } = {}
): Promise<T> {
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? 6000)
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout
  const f = opts.fetchFn ?? ((u: string, i?: RequestInit) => fetch(u, i))
  const res = await f(url, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
}

export const hasCyrillic = (s: string) => /[Ѐ-ӿ]/.test(s)

/** Достаёт текст страницы по URL (RSS, HTML, JSON-строкой) */
export type TextFetcher = (url: string, signal?: AbortSignal) => Promise<string>

/** Промис, который отвечает на отмену сразу, а не когда доедет запрос (IPC в главный процесс отменить нельзя) */
export function raceAbort<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException('aborted', 'AbortError'))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new DOMException('aborted', 'AbortError'))
    signal.addEventListener('abort', onAbort, { once: true })
    p.then(
      (v) => { signal.removeEventListener('abort', onAbort); resolve(v) },
      (e) => { signal.removeEventListener('abort', onAbort); reject(e) }
    )
  })
}

/**
 * В Electron страницы без CORS-заголовков (Google News, DuckDuckGo, Википедия) забирает главный процесс
 * (IPC net:fetchText, белый список хостов); вне Electron (тесты, браузер) — обычный fetch.
 */
export const defaultTextFetcher: TextFetcher = async (url, signal) => {
  const api = (globalThis as any).window?.electronAPI
  if (api?.invoke) {
    const r = await raceAbort<any>(api.invoke('net:fetchText', url), signal)
    if (r?.ok) return r.text as string
    throw new Error(r?.error ?? 'fetch failed')
  }
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}
