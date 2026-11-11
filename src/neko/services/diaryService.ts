// src/neko/services/diaryService.ts
// Оркестратор: прочитать переписку → попросить модель написать запись → приложить фото → сохранить.
// Все внешние зависимости передаются снаружи (deps), поэтому логика проверяется без Electron и без модели.

import type { AppSettings, ChatMessage, DiaryEntry, DiaryPhoto, Message } from '@shared/types'
import { AIError, humanizeError, isContextError, type AIProvider, type FinishInfo } from '@shared/services/aiTypes'
import { EMOTIONS } from '@shared/services/emotion'
import { activeModel } from '@shared/services/providers'
import { buildDiaryInstruction, COMPACT_REMINDER, NEKO_APPEARANCE_TAGS, RETRY_REMINDER } from '@neko/prompt/diaryPrompt'
import {
  buildEntry, buildTranscript, diaryBudget, extractJson, fallbackFromText, localDate, normalizeDiary,
  selectPeriod, shouldWrite, type NormalizedDiary, type Period,
} from './diaryCore'

export type DiaryState = 'idle' | 'writing' | 'drawing' | 'error'
export interface DiaryStatus { state: DiaryState; message?: string }

export interface PhotoContext {
  entry: DiaryEntry
  dateLabel: string
}

export interface DiaryDeps {
  provider: AIProvider
  settings: Pick<AppSettings, 'diaryMinMessages' | 'diaryIdleMinutes' | 'diarySelfie' | 'diaryGenerateImage' | 'ollamaModel' | 'ollamaEndpoint' | 'cloud' | 'provider'> &
    Partial<Pick<AppSettings, 'numCtx'>>
  /** Системный промпт персонажа (NEKO_PROMPT) */
  persona: string

  lastCovered(): Promise<number>
  fetchMessages(from: number, to: number): Promise<Message[]>
  saveEntry(entry: DiaryEntry): Promise<unknown>
  saveImage(dataUrl: string): Promise<string>

  /** Готовое селфи (JPEG data URL) из аватара либо null */
  makeSelfie?(ctx: PhotoContext): Promise<string | null>
  /** Открытка-заглушка с настроением, если селфи недоступно */
  makeCard?(ctx: PhotoContext): Promise<string | null>
  /** Иллюстрация через Stable Diffusion; prefix — теги внешности NEKO */
  makeIllustration?(prompt: string, prefix: string, ctx: PhotoContext): Promise<string | null>

  setStatus?(s: DiaryStatus): void
  now?(): number
}

export type WriteResult =
  | { status: 'written'; entry: DiaryEntry }
  | { status: 'skipped'; reason: 'busy' | 'no-messages' | 'not-yet' }
  | { status: 'error'; message: string }

let running = false

const uid = () => `e_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

const dateLabel = (ts: number) =>
  new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'long' })

async function askModel(
  deps: DiaryDeps,
  period: Period,
  signal?: AbortSignal
): Promise<{ norm: NormalizedDiary | null; raw: string; truncated: boolean }> {
  const system = deps.persona.trim() + buildDiaryInstruction()
  const budget = diaryBudget(
    { provider: deps.settings.provider, numCtx: deps.settings.numCtx ?? 0, model: activeModel(deps.settings).model },
    system.length
  )

  const makeMessages = (transcriptChars: number): ChatMessage[] => {
    const { text: transcript, skipped } = buildTranscript(period.messages, transcriptChars)
    return [
      { role: 'system', content: system },
      {
        role: 'user',
        content:
          `Вот переписка за ${dateLabel(period.from)} (${period.messages.length} сообщений${skipped ? `, часть середины пропущена` : ''}).\n` +
          `«Он» — пользователь, «Я» — ты, NEKO. В скобках у моих реплик указано, какую эмоцию ты показывала.\n\n` +
          `${transcript}\n\nНапиши запись в дневник.`,
      },
    ]
  }

  let finish: FinishInfo | undefined
  const callOpts = {
    json: true,
    maxTokens: budget.maxTokens,
    temperature: 0.8,
    signal,
    ...(budget.numCtx ? { numCtx: budget.numCtx } : {}),
    onFinish: (f: FinishInfo) => { finish = f },
  }

  // 1) основной запрос; если сервер говорит «не влезло в контекст» — один раз уменьшаем переписку вдвое
  let messages = makeMessages(budget.transcriptChars)
  let first: string
  try {
    first = await deps.provider.chat(messages, callOpts)
  } catch (e) {
    if (!isContextError(e) || signal?.aborted) throw e
    messages = makeMessages(Math.max(1200, Math.floor(budget.transcriptChars / 2)))
    first = await deps.provider.chat(messages, callOpts)
  }

  let truncated = (finish as FinishInfo | undefined)?.reason === 'length'
  let norm = normalizeDiary(extractJson(first))
  let raw = first

  // 2) не разобралось: одна повторная попытка; если ответ оборвался по лимиту — просим ужаться
  if (!norm) {
    finish = undefined
    const second = await deps.provider.chat(
      [...messages, { role: 'assistant', content: first.slice(0, 1500) }, { role: 'user', content: truncated ? COMPACT_REMINDER : RETRY_REMINDER }],
      callOpts
    )
    truncated = (finish as FinishInfo | undefined)?.reason === 'length'
    norm = normalizeDiary(extractJson(second))
    if (second.length > raw.length) raw = second // для запасного варианта берём более содержательный ответ
  }
  return { norm, raw, truncated }
}

/**
 * @param force true — писать немедленно, даже если разговор ещё идёт (кнопка «Написать сейчас»)
 */
export async function writeDiaryEntry(
  deps: DiaryDeps,
  opts: { force?: boolean; signal?: AbortSignal } = {}
): Promise<WriteResult> {
  if (running) return { status: 'skipped', reason: 'busy' }
  running = true
  const now = deps.now?.() ?? Date.now()
  const setStatus = (s: DiaryStatus) => { try { deps.setStatus?.(s) } catch { /* UI не должен ломать запись */ } }

  try {
    const covered = await deps.lastCovered()
    const pending = (await deps.fetchMessages(covered + 1, now)).filter((m) => m.timestamp > covered)
    const period = selectPeriod(pending, now)
    if (!period) return { status: 'skipped', reason: 'no-messages' }

    const policy = { minMessages: deps.settings.diaryMinMessages, idleMs: deps.settings.diaryIdleMinutes * 60_000 }
    if (!shouldWrite(period, now, policy, !!opts.force)) return { status: 'skipped', reason: 'not-yet' }

    setStatus({ state: 'writing', message: 'NEKO пишет в дневник…' })

    const { norm: parsed, raw, truncated } = await askModel(deps, period, opts.signal)
    const norm = parsed ?? fallbackFromText(raw)
    if (!norm) {
      throw new Error(
        truncated
          ? 'Ответ модели обрывается на полуслове — не хватает токенов. Попробуй модель побольше или увеличь «Контекст (токены)» в настройках.'
          : 'Модель не смогла написать запись. Попробуй другую модель в настройках.'
      )
    }

    const { model } = activeModel(deps.settings)
    const entry = buildEntry({ id: uid(), period, norm, source: opts.force ? 'manual' : 'auto', model, now })
    const ctx: PhotoContext = { entry, dateLabel: dateLabel(period.from) }

    // 1) селфи (или открытка) — быстро, поэтому запись появляется сразу с картинкой
    const first = await makePrimaryPhoto(deps, ctx, norm)
    if (first) entry.photos.push(first)
    await deps.saveEntry(entry)

    // 2) иллюстрация через Stable Diffusion — долго, добавляется отдельным сохранением
    if (deps.settings.diaryGenerateImage && deps.makeIllustration && norm.photo.prompt) {
      setStatus({ state: 'drawing', message: 'NEKO рисует иллюстрацию…' })
      try {
        const data = await deps.makeIllustration(norm.photo.prompt, NEKO_APPEARANCE_TAGS, ctx)
        if (data) {
          const file = await deps.saveImage(data)
          entry.photos.push({
            id: `p_${Date.now().toString(36)}`,
            file,
            kind: 'generated',
            caption: norm.photo.caption || 'Рисунок дня',
            prompt: norm.photo.prompt,
            createdAt: Date.now(),
          })
          await deps.saveEntry(entry)
        }
      } catch (e) {
        console.warn('Иллюстрация дневника не получилась:', e)
      }
    }

    setStatus({ state: 'idle' })
    return { status: 'written', entry }
  } catch (e) {
    const message =
      e instanceof AIError
        ? humanizeError(e, {
            provider: deps.settings.provider,
            ...activeModel(deps.settings),
          }) || 'Запись прервана.'
        : e instanceof Error
          ? e.message
          : String(e)
    setStatus({ state: 'error', message })
    return { status: 'error', message }
  } finally {
    running = false
  }
}

async function makePrimaryPhoto(deps: DiaryDeps, ctx: PhotoContext, norm: NormalizedDiary): Promise<DiaryPhoto | null> {
  const mood = EMOTIONS[ctx.entry.mood.label]
  const attempts: [kind: 'selfie' | 'card', fn: ((c: PhotoContext) => Promise<string | null>) | undefined, enabled: boolean][] = [
    ['selfie', deps.makeSelfie, deps.settings.diarySelfie],
    ['card', deps.makeCard, true],
  ]
  for (const [kind, fn, enabled] of attempts) {
    if (!fn || !enabled) continue
    try {
      const data = await fn(ctx)
      if (!data) continue
      const file = await deps.saveImage(data)
      return {
        id: `p_${Date.now().toString(36)}_${kind}`,
        file,
        kind,
        caption: kind === 'selfie' ? (norm.photo.caption || `Селфи. Настроение: ${mood.ru} ${mood.emoji}`) : `${mood.emoji} ${ctx.entry.mood.summary}`,
        createdAt: Date.now(),
      }
    } catch (e) {
      console.warn(`Фото дневника (${kind}) не получилось:`, e)
    }
  }
  return null
}

/** Для тестов: сбросить блокировку, если предыдущий тест упал посреди записи */
export function _resetDiaryLock() { running = false }
export { localDate }
