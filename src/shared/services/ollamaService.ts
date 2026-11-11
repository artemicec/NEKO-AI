// src/shared/services/ollamaService.ts
//
// Что изменено по сравнению с первой версией (и почему ответы стали быстрее):
//  • /api/chat вместо /api/generate — Ollama сама применяет шаблон модели и кэширует префикс
//    (системный промпт + начало диалога) между запросами;
//  • stream:true — первые слова появляются через доли секунды, а не после полной генерации;
//  • num_predict вместо max_tokens (max_tokens Ollama игнорирует — лимита фактически не было);
//  • keep_alive — модель не выгружается из памяти между репликами;
//  • think:false — у thinking-моделей (qwen3.x) выключаем скрытые «размышления»;
//  • warmup() — загружает модель и системный промпт заранее, до первого сообщения.

import type { ChatMessage } from '@shared/types'
import { AIError, type AIProvider, type GenerateOptions } from './aiTypes'
import { postStream } from './httpStream'
import { ThinkFilter } from './streamUtils'

export interface OllamaConfig {
  endpoint: string
  model: string
  keepAlive: string
  numCtx: number
  /** true = разрешить размышления (медленнее) */
  think: boolean
  maxTokens: number
  temperature: number
}

/** "30m" → "30m", "-1" → -1 (число), "" → "30m" */
export function normalizeKeepAlive(v: string | number | undefined): string | number {
  if (v === undefined || v === null || v === '') return '30m'
  if (typeof v === 'number') return v
  const s = String(v).trim()
  if (/^-?\d+$/.test(s)) return Number(s)
  return s
}

const trimSlash = (s: string) => s.replace(/\/+$/, '')

export class OllamaService implements AIProvider {
  readonly name = 'ollama' as const

  constructor(private cfg: OllamaConfig) {}

  private url(path: string) {
    return trimSlash(this.cfg.endpoint) + path
  }

  private buildBody(messages: ChatMessage[], opts: GenerateOptions, stream: boolean) {
    const body: Record<string, unknown> = {
      model: this.cfg.model,
      messages,
      stream,
      keep_alive: normalizeKeepAlive(this.cfg.keepAlive),
      options: {
        temperature: opts.temperature ?? this.cfg.temperature,
        top_p: 0.9,
        repeat_penalty: 1.05,
        num_predict: opts.maxTokens ?? this.cfg.maxTokens,
        num_ctx: opts.numCtx ?? this.cfg.numCtx,
      },
    }
    if (!this.cfg.think) body.think = false
    if (opts.json) body.format = 'json'
    return body
  }

  async chat(messages: ChatMessage[], opts: GenerateOptions = {}): Promise<string> {
    const body = this.buildBody(messages, opts, true)

    const run = async (): Promise<string> => {
      let text = ''
      const filter = new ThinkFilter()
      await postStream(
        this.url('/api/chat'),
        body,
        {},
        { signal: opts.signal, provider: 'ollama' },
        (line) => {
          let obj: any
          try { obj = JSON.parse(line) } catch { return }
          if (obj.error) throw new AIError(String(obj.error), 'http', undefined, 'ollama')
          const delta: string | undefined = obj.message?.content
          if (delta) {
            const clean = filter.push(delta)
            if (clean) {
              text += clean
              opts.onToken?.(clean)
            }
          }
          if (obj.done === true) {
            opts.onFinish?.({
              reason: obj.done_reason === 'length' ? 'length' : obj.done_reason === 'stop' || !obj.done_reason ? 'stop' : 'other',
              promptTokens: typeof obj.prompt_eval_count === 'number' ? obj.prompt_eval_count : undefined,
              outputTokens: typeof obj.eval_count === 'number' ? obj.eval_count : undefined,
            })
            return true
          }
        }
      )
      const tail = filter.flush()
      if (tail) {
        text += tail
        opts.onToken?.(tail)
      }
      return text.trim()
    }

    try {
      return await run()
    } catch (e) {
      // Очень старые версии Ollama / модели без поддержки think ругаются на параметр — повторяем без него
      if (e instanceof AIError && e.kind === 'http' && e.status === 400 && /think/i.test(e.message) && 'think' in body) {
        delete body.think
        return await run()
      }
      throw e
    }
  }

  async warmup(systemPrompt: string): Promise<void> {
    const body = this.buildBody(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Привет' },
      ],
      { maxTokens: 1, temperature: 0 },
      false
    )
    try {
      await postStream(this.url('/api/chat'), body, {}, { provider: 'ollama', idleMs: 180_000 }, () => true)
    } catch (e) {
      // Прогрев — best effort. Если think не поддерживается, пробуем ещё раз без него.
      if (e instanceof AIError && e.status === 400 && 'think' in body) {
        delete body.think
        try { await postStream(this.url('/api/chat'), body, {}, { provider: 'ollama', idleMs: 180_000 }, () => true) } catch { /* ignore */ }
      }
    }
  }

  async checkConnection(): Promise<boolean> {
    try {
      const res = await fetch(this.url('/api/tags'), { signal: AbortSignal.timeout(3000) })
      return res.ok
    } catch {
      return false
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const res = await fetch(this.url('/api/tags'), { signal: AbortSignal.timeout(4000) })
      if (!res.ok) return []
      const data = await res.json()
      return (data.models ?? []).map((m: { name: string }) => m.name)
    } catch {
      return []
    }
  }
}

/**
 * Выбирает модель, которая реально установлена. Нужна потому, что в настройках может лежать
 * имя, которого нет в Ollama (например, старое значение по умолчанию «gemma4:12b»).
 */
export function pickModel(
  configured: string,
  installed: string[],
  preferred: string[] = ['gemma4:e4b', 'qwen3.5:9b']
): string {
  if (!installed.length) return configured
  const has = (name: string) => installed.some((m) => m === name || m === `${name}:latest`)
  if (has(configured)) return configured
  for (const p of preferred) if (has(p)) return installed.find((m) => m === p || m === `${p}:latest`)!
  return installed[0]
}
