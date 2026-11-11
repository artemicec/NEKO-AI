// src/shared/services/webSearch.ts
//
// Доступ к знаниям из интернета без ключей и регистрации:
//   • Википедия — официальный API (ru, при пустом ответе — en): вступление статьи, это самый надёжный источник;
//   • DuckDuckGo — HTML-версия выдачи (https://html.duckduckgo.com/html/): заголовок, ссылка, сниппет.
// Страницы забирает главный процесс Electron (IPC net:fetchText, белый список хостов), потому что у них нет CORS.
// Сниппеты DDG — неофициальный разбор HTML: при смене вёрстки или капче (DDG иногда режет частые запросы)
// поиск просто вернёт пусто, а Википедия продолжит работать — приложение от этого не ломается.

import type { WebSource } from '@shared/types'
import { defaultTextFetcher, hasCyrillic, raceAbort, type TextFetcher } from '@shared/plugins/netUtil'

export type { TextFetcher }

export interface WebResult {
  kind: 'wikipedia' | 'web'
  title: string
  url: string
  /** Для Википедии — вступление статьи, для поиска — сниппет */
  text: string
}

export interface WebLookup {
  query: string
  results: WebResult[]
  /** Готовый блок для модели (пусто, если ничего не нашлось) */
  context: string
  sources: WebSource[]
  /** Что пошло не так (для настроек и отладки), даже если часть результатов всё же есть */
  errors: string[]
}

export interface LookupOptions {
  wikipedia?: boolean
  web?: boolean
  /** Сколько результатов поиска брать (статей Википедии — не больше 2) */
  results?: number
  fetchText?: TextFetcher
  signal?: AbortSignal
  timeoutMs?: number
}

/* ───────────────────────── Чистка текста и ссылок ───────────────────────── */

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
  laquo: '«', raquo: '»', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', middot: '·', bull: '•',
}

export function decodeHtml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => safeCodePoint(parseInt(h, 16), m))
    .replace(/&#(\d+);/g, (m, d) => safeCodePoint(Number(d), m))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
}

const safeCodePoint = (n: number, fallback: string) => {
  try { return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : fallback } catch { return fallback }
}

/** HTML → обычный текст: без тегов, сущности раскрыты, пробелы схлопнуты */
export const htmlToText = (html: string): string =>
  decodeHtml(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()

const clip = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…')

/** Только http/https без логина и пароля — всё остальное (javascript:, data:, file:) отбрасывается */
export function safeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 600) return null
  let u: URL
  try { u = new URL(raw.trim()) } catch { return null }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password) return null
  return u.toString()
}

const hostOf = (url: string): string => {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' }
}

/** Поисковый запрос: без кавычек и служебных скобок, одной строкой, не длиннее 120 символов */
export function cleanQuery(q: string): string {
  return q
    .replace(/[\[\]{}<>«»“”„"]/g, ' ')
    .replace(/^['\s]+|['\s.,;:!?…]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

/* ───────────────────────── Википедия ───────────────────────── */

export function wikiUrl(lang: 'ru' | 'en', query: string, limit = 3): string {
  const p = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    generator: 'search',
    gsrsearch: query,
    gsrlimit: String(limit),
    gsrnamespace: '0',
    prop: 'extracts|info|pageprops',
    ppprop: 'disambiguation',
    exintro: '1',
    explaintext: '1',
    exlimit: 'max',
    exsentences: '5',
    inprop: 'url',
    redirects: '1',
  })
  return `https://${lang}.wikipedia.org/w/api.php?${p.toString()}`
}

const DISAMBIG_TEXT = /(?:может\s+(?:означать|относиться|значить)|многозначн|may\s+(?:also\s+)?refer\s+to|disambiguation)/i

/** Разбор ответа API: статьи в порядке релевантности, страницы-«развилки» и пустые вступления отбрасываются */
export function parseWikipedia(json: any, limit = 2): WebResult[] {
  const pages: any[] = Array.isArray(json?.query?.pages) ? json.query.pages : []
  return pages
    .filter((p) => p && typeof p.title === 'string' && typeof p.extract === 'string')
    .filter((p) => !p.pageprops || p.pageprops.disambiguation === undefined)
    .sort((a, b) => (a.index ?? 99) - (b.index ?? 99))
    .map((p): WebResult | null => {
      const url = safeHttpUrl(p.fullurl)
      const text = p.extract.replace(/\s+/g, ' ').trim()
      if (!url || text.length < 40 || DISAMBIG_TEXT.test(text.slice(0, 200))) return null
      return { kind: 'wikipedia', title: p.title, url, text }
    })
    .filter((r): r is WebResult => r !== null)
    .slice(0, limit)
}

async function searchWikipedia(query: string, fetchText: TextFetcher, signal?: AbortSignal): Promise<WebResult[]> {
  const parse = async (lang: 'ru' | 'en') => {
    const raw = await fetchText(wikiUrl(lang, query), signal)
    return parseWikipedia(JSON.parse(raw))
  }
  // Латиница в запросе («iPhone 17», «Python») чаще всего живёт в английской Википедии — туда и идём первой
  const order: ('ru' | 'en')[] = hasCyrillic(query) ? ['ru', 'en'] : ['en', 'ru']
  let lastError: unknown = null
  for (const lang of order) {
    try {
      const found = await parse(lang)
      if (found.length) return found
    } catch (e) {
      if (signal?.aborted) throw e
      lastError = e
    }
  }
  if (lastError) throw lastError
  return []
}

/* ───────────────────────── DuckDuckGo ───────────────────────── */

export function duckUrl(query: string): string {
  const p = new URLSearchParams({ q: query, kl: hasCyrillic(query) ? 'ru-ru' : 'wt-wt' })
  return `https://html.duckduckgo.com/html/?${p.toString()}`
}

/** Ссылки выдачи завёрнуты в редирект //duckduckgo.com/l/?uddg=<настоящий адрес>; реклама идёт через /y.js */
export function decodeDdgUrl(href: string): string | null {
  const h = decodeHtml(href.trim())
  let u: URL
  try { u = new URL(h.startsWith('//') ? 'https:' + h : h, 'https://duckduckgo.com') } catch { return null }
  if (/(^|\.)duckduckgo\.com$/.test(u.hostname)) {
    if (u.pathname === '/l/' || u.pathname === '/l') return safeHttpUrl(u.searchParams.get('uddg'))
    return null // /y.js (реклама) и внутренние страницы DDG
  }
  return safeHttpUrl(u.toString())
}

const attr = (attrs: string, name: string): string => {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(attrs)
  return m ? (m[1] ?? m[2] ?? '') : ''
}

export const isDdgBlocked = (html: string) => /anomaly-modal|bots use DuckDuckGo too|unusual traffic/i.test(html)

/**
 * Выдача DDG: идём по всем ссылкам подряд. Ссылка с классом result__a начинает новый результат,
 * ближайшая за ней result__snippet — его описание. Порядок атрибутов и остальная вёрстка не важны.
 */
export function parseDuckDuckGo(html: string, limit = 5): WebResult[] {
  const out: WebResult[] = []
  const seen = new Set<string>()
  let cur: WebResult | null = null
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const cls = attr(m[1], 'class')
    if (/(?:^|\s)result__a(?:\s|$)/.test(cls)) {
      cur = null
      const url = decodeDdgUrl(attr(m[1], 'href'))
      const title = htmlToText(m[2])
      if (!url || !title || seen.has(url)) continue
      seen.add(url)
      cur = { kind: 'web', title: clip(title, 140), url, text: '' }
      out.push(cur)
    } else if (cur && !cur.text && /(?:^|\s)result__snippet(?:\s|$)/.test(cls)) {
      cur.text = htmlToText(m[2])
    }
  }
  return out.filter((r) => r.text || r.title).slice(0, limit)
}

async function searchDuckDuckGo(query: string, limit: number, fetchText: TextFetcher, signal?: AbortSignal): Promise<WebResult[]> {
  const html = await fetchText(duckUrl(query), signal)
  const found = parseDuckDuckGo(html, limit)
  if (!found.length && isDdgBlocked(html)) throw new Error('DuckDuckGo временно ограничил запросы')
  return found
}

/* ───────────────────────── Сборка ───────────────────────── */

const CONTEXT_BUDGET = 2800

/** Блок фактов для модели: нумерованный, с ограничением по длине (мелким моделям длинный контекст вредит) */
export function buildContext(results: WebResult[], budget = CONTEXT_BUDGET): string {
  const lines: string[] = []
  let used = 0
  for (const [i, r] of results.entries()) {
    const head = r.kind === 'wikipedia' ? `Википедия — ${r.title}` : `${r.title} (${hostOf(r.url)})`
    const body = clip(r.text, r.kind === 'wikipedia' ? 700 : 320)
    const line = `${i + 1}. ${head}: ${body}`.trim()
    if (used + line.length > budget && lines.length) break
    lines.push(line)
    used += line.length
  }
  return lines.join('\n')
}

const toSources = (results: WebResult[]): WebSource[] =>
  results.map((r) => ({ kind: r.kind, title: clip(r.title, 90), url: r.url }))

/**
 * Ищет сразу везде, где разрешено: Википедия и поиск идут параллельно, частичный отказ не страшен.
 * Статьи Википедии идут первыми (они надёжнее), дубли «той же статьи» из поиска выкидываются.
 */
export async function webLookup(rawQuery: string, opts: LookupOptions = {}): Promise<WebLookup> {
  const query = cleanQuery(rawQuery)
  const fetchText = opts.fetchText ?? defaultTextFetcher
  const wantWiki = opts.wikipedia !== false
  const wantWeb = opts.web !== false
  const limit = Math.max(1, Math.min(8, Math.round(opts.results ?? 5)))
  const empty: WebLookup = { query, results: [], context: '', sources: [], errors: [] }
  if (!query || (!wantWiki && !wantWeb)) return empty

  const timeout = AbortSignal.timeout(opts.timeoutMs ?? 9000)
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout

  // raceAbort: даже если fetchText не умеет отменяться, зависший источник не задерживает остальные дольше таймаута
  const [wiki, web] = await Promise.allSettled([
    wantWiki ? raceAbort(searchWikipedia(query, fetchText, signal), signal) : Promise.resolve([] as WebResult[]),
    wantWeb ? raceAbort(searchDuckDuckGo(query, limit, fetchText, signal), signal) : Promise.resolve([] as WebResult[]),
  ])
  if (opts.signal?.aborted) throw opts.signal.reason ?? new DOMException('aborted', 'AbortError')

  const errors: string[] = []
  const note = (what: string, r: PromiseSettledResult<unknown>) => {
    if (r.status === 'rejected') errors.push(`${what}: ${(r.reason as Error)?.message ?? r.reason}`)
  }
  note('Википедия', wiki)
  note('поиск', web)

  const wikiResults = wiki.status === 'fulfilled' ? wiki.value : []
  const webResults = (web.status === 'fulfilled' ? web.value : []).filter(
    // статья Википедии уже есть — её копию из поиска не показываем
    (r) => !(wikiResults.length && /(^|\.)wikipedia\.org$/.test(hostOf(r.url)))
  )
  const results = [...wikiResults, ...webResults]

  return { query, results, context: buildContext(results), sources: toSources(results), errors }
}
