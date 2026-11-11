// src/shared/services/aiTypes.ts
import type { ChatMessage, ProviderId } from '@shared/types'
import { CLOUD_PRESETS, isCloudProvider } from './providers'

export interface GenerateOptions {
  signal?: AbortSignal
  maxTokens?: number
  temperature?: number
  /** Просим модель вернуть строго JSON (используется дневником) */
  json?: boolean
  /** Вызывается на каждый новый кусок текста */
  onToken?: (delta: string) => void
  /** Размер контекста на этот запрос (только Ollama; смена перезагружает модель, поэтому используется редко) */
  numCtx?: number
  /** Сообщает, чем закончилась генерация (length = упёрлась в лимит токенов и обрезана) */
  onFinish?: (info: FinishInfo) => void
}

export interface FinishInfo {
  reason: 'stop' | 'length' | 'other'
  promptTokens?: number
  outputTokens?: number
}

export interface AIProvider {
  readonly name: ProviderId
  /** Всегда стримит под капотом; возвращает полный текст */
  chat(messages: ChatMessage[], opts?: GenerateOptions): Promise<string>
  /** Прогрев: загрузить модель в память и закэшировать системный промпт */
  warmup?(systemPrompt: string): Promise<void>
  checkConnection(): Promise<boolean>
  listModels?(): Promise<string[]>
}

export type AIErrorKind = 'network' | 'http' | 'aborted' | 'timeout' | 'config'

export class AIError extends Error {
  constructor(
    message: string,
    public kind: AIErrorKind,
    public status?: number,
    public provider?: string
  ) {
    super(message)
    this.name = 'AIError'
  }
}

/** Сервер сообщает, что запрос не помещается в контекст модели / лимит токенов */
export function isContextError(e: unknown): boolean {
  return (
    e instanceof AIError &&
    e.kind === 'http' &&
    /context (length|size|window)|exceed|too (long|large|many)|max(imum)? (context|tokens?)|token limit|input length/i.test(e.message)
  )
}

/** Человеческое сообщение об ошибке для чата. Текст никогда не содержит API-ключа. */
export function humanizeError(e: unknown, ctx: { provider: string; model?: string; endpoint?: string }): string {
  const preset = isCloudProvider(ctx.provider) ? CLOUD_PRESETS[ctx.provider] : null
  const name = preset?.label ?? (ctx.provider === 'ollama' ? 'Ollama' : 'Провайдер')
  if (e instanceof AIError) {
    if (e.kind === 'aborted') return ''
    if (e.kind === 'config') return e.message
    if (e.kind === 'timeout') {
      return 'Модель слишком долго молчит. Возможно, она ещё загружается — попробуй ещё раз через пару секунд.'
    }
    if (e.kind === 'network') {
      return ctx.provider === 'ollama'
        ? `Не могу достучаться до Ollama (${ctx.endpoint ?? 'localhost:11434'}). Она запущена? Попробуй команду «ollama serve».`
        : ctx.provider === 'custom'
          ? `Не могу достучаться до своего сервера (${ctx.endpoint ?? 'адрес не указан'}). Он запущен? Проверь адрес в настройках («Система»).`
          : `Не могу достучаться до ${name}. Проверь интернет и адрес API.`
    }
    if (e.kind === 'http') {
      if (e.status === 404 && ctx.provider === 'ollama') {
        return `Модель «${ctx.model ?? '?'}» не найдена в Ollama. Выбери установленную в настройках («Система») или выполни: ollama pull ${ctx.model ?? '<модель>'}`
      }
      if (e.status === 404 && preset) {
        return `${name}: такой модели («${ctx.model ?? '?'}») или адреса нет (404). Нажми «Список моделей» в настройках («Система») и выбери доступную.`
      }
      // Ollama отвечает на переполнение контекста статусом 500 — поэтому проверяем это раньше общих 5xx
      if (isContextError(e)) {
        return `Запрос не поместился в контекст модели. Открой ⚙️ → «Нейросеть и система» и увеличь «Контекст (токены)» (например, до 16384). Детали: ${e.message.slice(0, 200)}`
      }
      if (e.status === 401 || e.status === 403) {
        return `${name} отклонил ключ (${e.status}). Проверь API-ключ в настройках («Система»)` +
          (preset?.keyUrl ? ` — новый можно взять здесь: ${preset.keyUrl}` : '.')
      }
      if (e.status === 402) return `На счёте ${name} закончились деньги (402).`
      if (e.status === 429) return `${name}: слишком много запросов или исчерпан лимит (429). Подожди немного и повтори.`
      if (e.status === 529 || (e.status !== undefined && e.status >= 500)) {
        return `${name} сейчас перегружен или недоступен (${e.status}). Повтори чуть позже.`
      }
      return `Сервер ответил ошибкой ${e.status ?? ''}: ${e.message}`.trim()
    }
  }
  if (e instanceof DOMException && e.name === 'AbortError') return ''
  return 'Произошла ошибка. Попробуй ещё раз.'
}
