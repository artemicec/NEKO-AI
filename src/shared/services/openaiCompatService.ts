// src/shared/services/openaiCompatService.ts
// OpenAI-совместимый стриминг (SSE): OpenAI, DeepSeek, Gemini (через его OpenAI-слой), OpenRouter, Groq, Mistral,
// Together, xAI и любой «свой» сервер (LM Studio, vLLM, llama.cpp…).
//
// Различия между провайдерами, которые здесь учтены:
//  • OpenAI: новые модели принимают только max_completion_tokens, а часть (o-серия, gpt-5…) не принимает temperature;
//  • JSON-режим (response_format) есть не у всех;
//  • «думающие» модели иногда пишут рассуждения прямо в content между <think>…</think> — вырезаем;
//  • у Gemini в списке моделей id приходят как «models/<id>»;
//  • у «своего» сервера ключ и имя модели необязательны.
// Если сервер отвечает 400 и называет в ошибке сомнительный параметр, запрос повторяется ОДИН раз без него (или с заменой).

import type { ChatMessage, CloudProviderId } from '@shared/types'
import { AIError, type AIProvider, type GenerateOptions } from './aiTypes'
import { postStream, extractErrorMessage } from './httpStream'
import { sseData, ThinkFilter } from './streamUtils'
import { CLOUD_PRESETS } from './providers'
import { allowCloudHost } from './corsHosts'

export interface OpenAICompatConfig {
  id: CloudProviderId
  apiKey: string
  endpoint: string
  model: string
  maxTokens: number
  temperature: number
}

const trimSlash = (s: string) => s.replace(/\/+$/, '')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type TokenParam = 'max_tokens' | 'max_completion_tokens'

/** Какие параметры уже пришлось поправить из-за ответа сервера (каждый — не больше одного раза) */
interface Tweaks {
  tokenParam: TokenParam
  swappedTokens: boolean
  dropTemperature: boolean
  dropJson: boolean
}

/** Если сервер отверг параметр запроса — возвращает, что поправить; иначе null */
export function tweakFor(message: string, t: Tweaks): Partial<Tweaks> | null {
  const m = message.toLowerCase()
  if (!t.swappedTokens && m.includes(t.tokenParam)) {
    return { tokenParam: t.tokenParam === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens', swappedTokens: true }
  }
  if (!t.dropTemperature && m.includes('temperature')) return { dropTemperature: true }
  if (!t.dropJson && /response_format|json_object|json mode|json_schema/.test(m)) return { dropJson: true }
  return null
}

export class OpenAICompatService implements AIProvider {
  readonly name: CloudProviderId

  constructor(private cfg: OpenAICompatConfig) {
    this.name = cfg.id
  }

  private get preset() { return CLOUD_PRESETS[this.cfg.id] }
  private get base() { return trimSlash(this.cfg.endpoint) }

  private headers(): Record<string, string> {
    return this.cfg.apiKey ? { Authorization: `Bearer ${this.cfg.apiKey}` } : {}
  }

  private requireConfig() {
    if (this.preset.keyRequired && !this.cfg.apiKey) {
      throw new AIError(
        `Не указан API-ключ ${this.preset.label}. Добавь его в настройках («Система»).`,
        'config', undefined, this.cfg.id
      )
    }
  }

  async chat(messages: ChatMessage[], opts: GenerateOptions = {}): Promise<string> {
    this.requireConfig()
    if (!this.cfg.model && this.cfg.id !== 'custom') {
      throw new AIError('Не выбрана модель. Выбери её в настройках («Система») — кнопка «Список моделей».', 'config', undefined, this.cfg.id)
    }
    await allowCloudHost(this.base)

    const tweaks: Tweaks = {
      tokenParam: this.cfg.id === 'openai' ? 'max_completion_tokens' : 'max_tokens',
      swappedTokens: false,
      dropTemperature: false,
      dropJson: false,
    }
    let busyRetried = false

    for (let attempt = 0; ; attempt++) {
      let text = ''
      let emitted = false
      try {
        const think = new ThinkFilter()
        const emit = (chunk: string) => {
          const visible = think.push(chunk)
          if (!visible) return
          text += visible
          emitted = true
          opts.onToken?.(visible)
        }

        const body: Record<string, unknown> = {
          messages,
          stream: true,
          [tweaks.tokenParam]: opts.maxTokens ?? this.cfg.maxTokens,
        }
        if (this.cfg.model) body.model = this.cfg.model
        if (!tweaks.dropTemperature) body.temperature = opts.temperature ?? this.cfg.temperature
        if (opts.json && !tweaks.dropJson) body.response_format = { type: 'json_object' }

        await postStream(
          `${this.base}/chat/completions`,
          body,
          this.headers(),
          { signal: opts.signal, provider: this.cfg.id },
          (line) => {
            const data = sseData(line)
            if (data === null) return
            if (data === '[DONE]') return true
            let obj: any
            try { obj = JSON.parse(data) } catch { return }
            if (obj.error) {
              throw new AIError(extractErrorMessage(JSON.stringify(obj)) || 'Ошибка API', 'http', Number(obj.error.code) || undefined, this.cfg.id)
            }
            const delta: unknown = obj.choices?.[0]?.delta?.content
            if (typeof delta === 'string' && delta) emit(delta)
            const fr: string | null | undefined = obj.choices?.[0]?.finish_reason
            if (fr) opts.onFinish?.({ reason: fr === 'length' ? 'length' : fr === 'stop' ? 'stop' : 'other' })
          }
        )
        const tail = think.flush()
        if (tail) { text += tail; opts.onToken?.(tail) }
        return text.trim()
      } catch (e) {
        if (!(e instanceof AIError) || e.kind !== 'http' || emitted || opts.signal?.aborted || attempt >= 3) throw e
        // Перегрузка сервера — один мягкий повтор
        if ((e.status === 429 || e.status === 503) && !busyRetried) {
          busyRetried = true
          await sleep(800)
          continue
        }
        // Сервер не принял параметр — поправляем и пробуем ещё раз
        if (e.status === 400 || e.status === 422) {
          const fix = tweakFor(e.message, tweaks)
          if (fix) { Object.assign(tweaks, fix); continue }
        }
        throw e
      }
    }
  }

  async checkConnection(): Promise<boolean> {
    if (this.preset.keyRequired && !this.cfg.apiKey) return false
    try {
      await allowCloudHost(this.base)
      const res = await fetch(`${this.base}/models`, { headers: this.headers(), signal: AbortSignal.timeout(5000) })
      return res.ok
    } catch {
      return false
    }
  }

  /** Список моделей провайдера. Бросает AIError (понятную для humanizeError), если ключ не подошёл или сервер недоступен */
  async listModels(): Promise<string[]> {
    this.requireConfig()
    await allowCloudHost(this.base)
    let res: Response
    try {
      res = await fetch(`${this.base}/models`, { headers: this.headers(), signal: AbortSignal.timeout(8000) })
    } catch (e) {
      throw new AIError(e instanceof Error ? e.message : String(e), 'network', undefined, this.cfg.id)
    }
    if (!res.ok) {
      const raw = await res.text().catch(() => '')
      throw new AIError(extractErrorMessage(raw) || res.statusText, 'http', res.status, this.cfg.id)
    }
    const json: any = await res.json().catch(() => ({}))
    const rows: unknown[] = Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : []
    const ids = rows
      .map((r) => (typeof r === 'string' ? r : (r as any)?.id ?? (r as any)?.name))
      .filter((s): s is string => typeof s === 'string' && s.length > 0)
      .map((s) => s.replace(/^models\//, '')) // Gemini: «models/gemini-…»
    return [...new Set(ids)].sort((a, b) => a.localeCompare(b))
  }
}
