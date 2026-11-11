// src/shared/services/anthropicService.ts
// Anthropic Messages API со стримом (SSE).
//
// Особенности:
//  • ключ — в заголовке x-api-key, версия API — anthropic-version;
//  • страница Electron для сервера — «браузер», поэтому нужен заголовок anthropic-dangerous-direct-browser-access
//    (ключ при этом остаётся на этом компьютере и уходит только на api.anthropic.com);
//  • system-промпт — отдельное поле, а в messages только user/assistant, начиная с user, роли чередуются;
//  • температура 0…1;
//  • JSON-режима параметром нет — просим JSON в system-промпте (prefill новыми моделями не поддерживается).
// ВНИМАНИЕ: формат сверен по документации Anthropic по памяти, вживую из окружения разработки не проверялся.

import type { ChatMessage } from '@shared/types'
import { AIError, type AIProvider, type GenerateOptions } from './aiTypes'
import { postStream, extractErrorMessage } from './httpStream'
import { sseData } from './streamUtils'
import { CLOUD_PRESETS } from './providers'
import { allowCloudHost } from './corsHosts'

export const ANTHROPIC_VERSION = '2023-06-01'

export interface AnthropicConfig {
  apiKey: string
  endpoint: string
  model: string
  maxTokens: number
  temperature: number
}

const trimSlash = (s: string) => s.replace(/\/+$/, '')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const JSON_RULE =
  'Отвечай ТОЛЬКО одним валидным JSON-объектом, без пояснений, без markdown и без обрамляющих ```.'

/** system-сообщения → одна строка; остальное → чередующиеся user/assistant, начиная с user */
export function toAnthropicMessages(messages: ChatMessage[], json = false): {
  system: string
  messages: { role: 'user' | 'assistant'; content: string }[]
} {
  const system = [...messages.filter((m) => m.role === 'system').map((m) => m.content.trim()), ...(json ? [JSON_RULE] : [])]
    .filter(Boolean)
    .join('\n\n')

  const out: { role: 'user' | 'assistant'; content: string }[] = []
  for (const m of messages) {
    if (m.role === 'system') continue
    const content = m.content
    if (!content.trim()) continue
    const last = out[out.length - 1]
    if (last && last.role === m.role) last.content += '\n\n' + content // подряд идущие реплики одной роли склеиваем
    else out.push({ role: m.role, content })
  }
  // Разговор обязан начинаться с реплики пользователя
  while (out.length && out[0].role !== 'user') out.shift()
  if (!out.length) out.push({ role: 'user', content: '…' })
  return { system, messages: out }
}

export class AnthropicService implements AIProvider {
  readonly name = 'anthropic' as const

  constructor(private cfg: AnthropicConfig) {}

  private get base() { return trimSlash(this.cfg.endpoint) }

  private headers(): Record<string, string> {
    return {
      'x-api-key': this.cfg.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    }
  }

  async chat(messages: ChatMessage[], opts: GenerateOptions = {}): Promise<string> {
    if (!this.cfg.apiKey) {
      throw new AIError(
        `Не указан API-ключ ${CLOUD_PRESETS.anthropic.label}. Добавь его в настройках («Система»).`,
        'config', undefined, 'anthropic'
      )
    }
    if (!this.cfg.model) {
      throw new AIError('Не выбрана модель. Выбери её в настройках («Система») — кнопка «Список моделей».', 'config', undefined, 'anthropic')
    }
    await allowCloudHost(this.base)

    const { system, messages: msgs } = toAnthropicMessages(messages, !!opts.json)
    const body: Record<string, unknown> = {
      model: this.cfg.model,
      max_tokens: opts.maxTokens ?? this.cfg.maxTokens,
      temperature: Math.min(1, Math.max(0, opts.temperature ?? this.cfg.temperature)),
      messages: msgs,
      stream: true,
    }
    if (system) body.system = system

    const run = async (): Promise<string> => {
      let text = ''
      await postStream(
        `${this.base}/messages`,
        body,
        this.headers(),
        { signal: opts.signal, provider: 'anthropic' },
        (line) => {
          const data = sseData(line)
          if (!data) return // строки «event: …» не нужны — тип события дублируется в JSON
          let obj: any
          try { obj = JSON.parse(data) } catch { return }
          switch (obj.type) {
            case 'content_block_delta':
              if (obj.delta?.type === 'text_delta' && typeof obj.delta.text === 'string' && obj.delta.text) {
                text += obj.delta.text
                opts.onToken?.(obj.delta.text)
              }
              return
            case 'message_delta': {
              const sr: string | null | undefined = obj.delta?.stop_reason
              if (sr) opts.onFinish?.({ reason: sr === 'max_tokens' ? 'length' : sr === 'end_turn' || sr === 'stop_sequence' ? 'stop' : 'other', outputTokens: obj.usage?.output_tokens })
              return
            }
            case 'error':
              throw new AIError(
                extractErrorMessage(JSON.stringify(obj)) || 'Ошибка API',
                'http',
                obj.error?.type === 'overloaded_error' ? 529 : obj.error?.type === 'rate_limit_error' ? 429 : undefined,
                'anthropic'
              )
            case 'message_stop':
              return true
          }
        }
      )
      return text.trim()
    }

    try {
      return await run()
    } catch (e) {
      // 429 / 529 (перегрузка) — один мягкий повтор, пока не пришло ни одного токена
      if (e instanceof AIError && e.kind === 'http' && (e.status === 429 || e.status === 529 || e.status === 503) && !opts.signal?.aborted) {
        await sleep(1000)
        return await run()
      }
      throw e
    }
  }

  async checkConnection(): Promise<boolean> {
    if (!this.cfg.apiKey) return false
    try {
      await allowCloudHost(this.base)
      const res = await fetch(`${this.base}/models?limit=1`, { headers: this.headers(), signal: AbortSignal.timeout(5000) })
      return res.ok
    } catch {
      return false
    }
  }

  async listModels(): Promise<string[]> {
    if (!this.cfg.apiKey) {
      throw new AIError(`Не указан API-ключ ${CLOUD_PRESETS.anthropic.label}.`, 'config', undefined, 'anthropic')
    }
    await allowCloudHost(this.base)
    let res: Response
    try {
      res = await fetch(`${this.base}/models?limit=100`, { headers: this.headers(), signal: AbortSignal.timeout(8000) })
    } catch (e) {
      throw new AIError(e instanceof Error ? e.message : String(e), 'network', undefined, 'anthropic')
    }
    if (!res.ok) {
      const raw = await res.text().catch(() => '')
      throw new AIError(extractErrorMessage(raw) || res.statusText, 'http', res.status, 'anthropic')
    }
    const json: any = await res.json().catch(() => ({}))
    const ids: string[] = (Array.isArray(json?.data) ? json.data : [])
      .map((r: any) => r?.id)
      .filter((s: unknown): s is string => typeof s === 'string' && s.length > 0)
    return [...new Set(ids)]
  }
}
