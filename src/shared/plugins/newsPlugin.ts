// src/shared/plugins/newsPlugin.ts
// Новости из Google News RSS (бесплатно, без ключей). RSS не отдаёт CORS-заголовков,
// поэтому текст запрашивается через главный процесс Electron (IPC net:fetchText, белый список хостов).
// Прошлая версия ходила на currentsapi с apiKey=free — такого ключа не существует.

import type { Plugin, PluginContext, NewsItem } from '@shared/types'

import { defaultTextFetcher, type TextFetcher } from './netUtil'

export type { TextFetcher }

const defaultFetcher: TextFetcher = defaultTextFetcher

const decodeEntities = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&')

const tag = (xml: string, name: string): string => {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(xml)
  return m ? decodeEntities(m[1]).trim() : ''
}

export interface ParsedNews extends NewsItem { source: string }

/** Мини-парсер RSS (достаточно для Google News; не требует DOMParser) */
export function parseRss(xml: string, limit = 5): ParsedNews[] {
  const items: ParsedNews[] = []
  const re = /<item>([\s\S]*?)<\/item>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) && items.length < limit) {
    const raw = m[1]
    let title = tag(raw, 'title')
    let source = tag(raw, 'source')
    // Google News добавляет « - Источник» в конец заголовка
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3))
    else if (!source) {
      const k = title.lastIndexOf(' - ')
      if (k > 10) { source = title.slice(k + 3); title = title.slice(0, k) }
    }
    if (!title) continue
    items.push({ title, description: '', url: tag(raw, 'link'), publishedAt: tag(raw, 'pubDate'), source })
  }
  return items
}

const stripMd = (s: string) => s.replace(/[\[\]()]/g, '')

export function extractNewsQuery(input: string): { match: boolean; query: string } {
  const text = input.trim()
  if (text.length > 100 || !/новост/i.test(text)) return { match: false, query: '' }
  const q = /новост\p{L}*\s+(?:про|о|об|по|на\s+тему|касательно)\s+(.+)$/iu.exec(text)
  return { match: true, query: q ? q[1].replace(/[?!.]+$/g, '').trim() : '' }
}

export class NewsPlugin implements Plugin {
  name = 'Новости'
  description = 'Свежие новости'
  icon = '📰'

  constructor(private fetchText: TextFetcher = defaultFetcher) {}

  matches(input: string): boolean {
    return extractNewsQuery(input).match
  }

  async execute(input: string, ctx?: PluginContext): Promise<string> {
    const { match, query } = extractNewsQuery(input)
    if (!match) return ''

    const base = query
      ? `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ru&gl=RU&ceid=RU:ru`
      : 'https://news.google.com/rss?hl=ru&gl=RU&ceid=RU:ru'
    try {
      const xml = await this.fetchText(base, ctx?.signal)
      const items = parseRss(xml, 5)
      if (!items.length) return `📰 По запросу «${query || 'новости'}» ничего не нашлось.`
      const list = items
        .map((n, i) => `${i + 1}. ${n.url ? `[${stripMd(n.title)}](${n.url})` : stripMd(n.title)}${n.source ? ` — *${stripMd(n.source)}*` : ''}`)
        .join('\n')
      return `📰 ${query ? `Новости про «${query}»` : 'Главные новости'}:\n\n${list}\n\n*Ня~ Будь в курсе событий!* ✨`
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw e
      return '📰 Не удалось загрузить новости. Проверь подключение к интернету! 💙'
    }
  }
}
