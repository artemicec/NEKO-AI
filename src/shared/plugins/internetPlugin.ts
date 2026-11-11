// src/shared/plugins/internetPlugin.ts
//
// «Интернет»: Википедия + поиск DuckDuckGo. В отличие от остальных плагинов сам не отвечает пользователю:
// он добывает данные, а отвечает по ним модель — своим голосом и в своём образе (см. chatStore).
// Включается сам в трёх случаях: пользователь прямо попросил найти; вопрос похож на справочный
// («кто такой…», «когда основан…»); модель сама сказала, что не знает ([[WEB: …]]).

import type { Plugin, PluginContext, WebSource } from '@shared/types'
import { defaultTextFetcher, type TextFetcher } from './netUtil'
import { routeWeb, type WebRoute } from '@shared/services/webRouter'
import { webLookup, type WebLookup } from '@shared/services/webSearch'

type WebSettings = PluginContext['settings']

export interface WebDecision extends WebRoute {
  /** Просьба прозвучала, но интернет выключен в настройках — отвечать данными нельзя, нужно подсказать, где включить */
  disabled: boolean
}

export type { WebLookup, WebSource }

export class InternetPlugin implements Plugin {
  name = 'Интернет'
  description = 'Википедия и поиск в интернете: включается сама, когда не хватает информации'
  icon = '🌐'

  constructor(private fetchText: TextFetcher = defaultTextFetcher) {}

  /** Сам по тексту не отвечает: данные подмешиваются в ответ модели */
  matches(): boolean {
    return false
  }
  async execute(): Promise<string> {
    return ''
  }

  /** Нужен ли интернет для этого сообщения (и разрешён ли он настройками) */
  route(input: string, s: Pick<WebSettings, 'webEnabled' | 'webAuto'>): WebDecision | null {
    const r = routeWeb(input, { auto: s.webEnabled && s.webAuto })
    if (!r) return null
    return { ...r, disabled: !s.webEnabled }
  }

  /** Модель может просить поиск сама, только если интернет и автовключение разрешены */
  canModelRequest(s: Pick<WebSettings, 'webEnabled' | 'webAuto'>): boolean {
    return s.webEnabled && s.webAuto
  }

  /** Ищет по запросу. wiki/web — какие источники спрашивать (в настройках Википедию можно отключить) */
  search(
    query: string,
    ctx: Pick<PluginContext, 'signal'> & { settings: Pick<WebSettings, 'webWikipedia' | 'webResults'> },
    parts: { wiki: boolean; web: boolean } = { wiki: true, web: true }
  ): Promise<WebLookup> {
    return webLookup(query, {
      wikipedia: parts.wiki && ctx.settings.webWikipedia,
      web: parts.web,
      results: ctx.settings.webResults,
      fetchText: this.fetchText,
      signal: ctx.signal,
    })
  }
}
