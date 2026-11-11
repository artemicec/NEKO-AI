// src/neko/services/diaryCore.ts
// Чистая логика дневника (без DOM и Electron): выбор периода, расписание, транскрипт, разбор JSON, сборка записи.

import type { DiaryEntry, DiaryMood, DiaryThought, EmotionLabel, EmotionTag, Message } from '@shared/types'
import { EMOTIONS, dominantEmotion, emotionStats, isEmotionLabel } from '@shared/services/emotion'

const pad = (n: number) => String(n).padStart(2, '0')

export const localDate = (ts: number): string => {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const endOfLocalDay = (ts: number): number => {
  const d = new Date(ts)
  d.setHours(23, 59, 59, 999)
  return d.getTime()
}

const hhmm = (ts: number) => {
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/* ───────────────────────── Что и когда писать ───────────────────────── */

export const isDiaryRelevant = (m: Message): boolean =>
  !m.error && (m.role === 'user' || m.role === 'assistant') && (m.content.trim().length > 0 || !!m.imageAlt)

export interface Period {
  from: number
  to: number
  messages: Message[]
}

/**
 * Выбирает период для очередной записи: самый ранний ещё не охваченный день (целиком),
 * а для сегодняшнего дня — всё, что накопилось.
 */
export function selectPeriod(pending: Message[], now: number): Period | null {
  const msgs = pending.filter(isDiaryRelevant).sort((a, b) => a.timestamp - b.timestamp)
  if (!msgs.length) return null
  const dayEnd = endOfLocalDay(msgs[0].timestamp)
  const sameDay = msgs.filter((m) => m.timestamp <= dayEnd)
  const isToday = localDate(msgs[0].timestamp) === localDate(now)
  return {
    from: sameDay[0].timestamp,
    to: isToday ? sameDay[sameDay.length - 1].timestamp : dayEnd,
    messages: sameDay,
  }
}

export interface WritePolicy {
  minMessages: number
  idleMs: number
}

export function shouldWrite(period: Period, now: number, policy: WritePolicy, force = false): boolean {
  const count = period.messages.length
  if (force) return count >= 2
  const isPast = localDate(period.from) !== localDate(now)
  if (count < policy.minMessages) return isPast && count >= 4 // прошлый день не должен пропасть, если поговорили хоть немного
  if (isPast) return true
  const lastTs = period.messages[count - 1].timestamp
  if (now - lastTs >= policy.idleMs) return true // разговор затих — самое время писать
  return count >= policy.minMessages * 6 // очень длинная беседа — не ждём тишины
}

/* ───────────────────────── Транскрипт для модели ───────────────────────── */

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length <= n ? t : t.slice(0, n - 1).trimEnd() + '…'
}

export function formatLine(m: Message): string {
  const time = hhmm(m.timestamp)
  if (m.role === 'user') {
    return `[${time}] Он: ${m.content.trim() ? clip(m.content, 280) : (m.imageAlt ?? '[картинка]')}`
  }
  const mood = m.emotion && m.emotion.label !== 'neutral' ? ` (${EMOTIONS[m.emotion.label].ru})` : ''
  // «Интернет» — это её собственный ответ по найденным данным, а не готовая выдача модуля: текст в дневнике нужен
  if (m.plugin && m.plugin !== 'Интернет') return `[${time}] Я${mood}: [ответила с помощью модуля «${m.plugin}»]`
  return `[${time}] Я${mood}: ${clip(m.content, 280)}`
}

/** Если переписка длинная — оставляем начало и (в основном) конец, середину заменяем пометкой */
export function buildTranscript(messages: Message[], maxChars = 9000): { text: string; skipped: number } {
  const lines = messages.map(formatLine)
  const total = lines.reduce((n, l) => n + l.length + 1, 0)
  if (total <= maxChars) return { text: lines.join('\n'), skipped: 0 }

  const head: string[] = []
  const tail: string[] = []
  let used = 0
  for (const l of lines) {
    if (used + l.length > maxChars * 0.35) break
    head.push(l)
    used += l.length + 1
  }
  let usedTail = 0
  for (let i = lines.length - 1; i >= head.length; i--) {
    if (usedTail + lines[i].length > maxChars * 0.6) break
    tail.unshift(lines[i])
    usedTail += lines[i].length + 1
  }
  const skipped = lines.length - head.length - tail.length
  return { text: [...head, `[… пропущено сообщений: ${skipped} …]`, ...tail].join('\n'), skipped }
}

/* ───────────────────────── Бюджет токенов ───────────────────────── */

/** Минимальный контекст, с которым дневник работает надёжно (персона + инструкция уже весят ~2000 токенов) */
export const DIARY_MIN_CTX = 8192
/** Худший случай для кириллицы: ~2 символа на токен (у gemma/qwen обычно 2.5–3.5) */
const CHARS_PER_TOKEN = 2

export interface DiaryBudget {
  /** Контекст на запрос дневника (Ollama; для DeepSeek не используется) */
  numCtx: number
  /** Сколько токенов отдаём под ответ */
  maxTokens: number
  /** Сколько символов переписки можно положить в запрос */
  transcriptChars: number
}

/**
 * Раньше дневник жёстко просил maxTokens=900, а запись по схеме на русском занимает 1500+ токенов —
 * ответ обрывался на полуслове. Теперь лимит ответа и размер переписки считаются от размера контекста.
 */
export function diaryBudget(
  cfg: { provider: string; numCtx: number; model?: string },
  systemChars: number
): DiaryBudget {
  if (cfg.provider !== 'ollama') {
    // Облачные модели: контекст большой, лимит ответа задаём только токенами.
    // У «размышляющих» моделей (reasoner, R1, o-серия, gpt-5, thinking) лимит делится с рассуждением — даём запас.
    const reasoner = /reasoner|r1|\bo[134]\b|gpt-5|thinking/i.test(cfg.model ?? '')
    return { numCtx: 0, maxTokens: reasoner ? 8000 : 3000, transcriptChars: 24_000 }
  }
  const numCtx = Math.max(Number.isFinite(cfg.numCtx) ? cfg.numCtx : 0, DIARY_MIN_CTX)
  const maxTokens = Math.min(2048, Math.floor(numCtx * 0.3))
  const overhead = 300 // обёртка шаблона чата + вводная фраза + запас
  const inputTokens = numCtx - maxTokens - Math.ceil(systemChars / CHARS_PER_TOKEN) - overhead
  const transcriptChars = Math.max(1500, Math.min(16_000, inputTokens * CHARS_PER_TOKEN))
  return { numCtx, maxTokens, transcriptChars }
}

/* ───────────────────────── Разбор ответа модели ───────────────────────── */

/** Достаёт JSON из ответа: убирает ```-ограждения, чинит хвостовые запятые и обрыв по длине */
export function extractJson(raw: string): unknown | null {
  let s = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '')
  const start = s.indexOf('{')
  if (start < 0) return null
  s = s.slice(start)

  const tryParse = (t: string): unknown | null => {
    try { return JSON.parse(t.replace(/,\s*([}\]])/g, '$1')) } catch { return null }
  }

  const end = s.lastIndexOf('}')
  if (end > 0) {
    const ok = tryParse(s.slice(0, end + 1))
    if (ok !== null) return ok
  }

  // Ответ мог оборваться по лимиту токенов: закрываем строку и скобки
  const stack: string[] = []
  let inStr = false
  let esc = false
  for (const c of s) {
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{') stack.push('}')
    else if (c === '[') stack.push(']')
    else if (c === '}' || c === ']') stack.pop()
  }
  let repaired = s.replace(/,\s*$/, '')
  if (inStr) repaired += '"'
  repaired = repaired.replace(/,\s*"[^"]*"\s*:\s*$/, '').replace(/,\s*$/, '')
  repaired += stack.reverse().join('')
  return tryParse(repaired)
}

export interface NormalizedDiary {
  title: string
  text: string
  mood: { label: EmotionLabel | null; intensity: number | null; summary: string }
  thoughts: DiaryThought[]
  photo: { caption: string; prompt: string }
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** Приводит то, что вернула модель, к безопасной структуре. null — запись непригодна (нет текста). */
export function normalizeDiary(obj: unknown): NormalizedDiary | null {
  if (!obj || typeof obj !== 'object') return null
  const o = obj as Record<string, any>
  const text = str(o.text, 4000)
  if (text.length < 20) return null

  const thoughts: DiaryThought[] = (Array.isArray(o.thoughts) ? o.thoughts : [])
    .map((t: any): DiaryThought | null => {
      const thought = str(t?.thought, 500)
      if (!thought) return null
      return { about: str(t?.about, 200), thought, emotion: isEmotionLabel(t?.emotion) ? t.emotion : 'neutral' }
    })
    .filter((t: DiaryThought | null): t is DiaryThought => !!t)
    .slice(0, 6)

  const intensity = typeof o.mood?.intensity === 'number' && Number.isFinite(o.mood.intensity)
    ? Math.max(0, Math.min(1, o.mood.intensity))
    : null

  return {
    title: str(o.title, 80),
    text,
    mood: {
      label: isEmotionLabel(o.mood?.label) ? o.mood.label : null,
      intensity,
      summary: str(o.mood?.summary, 200),
    },
    thoughts,
    photo: { caption: str(o.photo?.caption, 120), prompt: str(o.photo?.prompt, 400) },
  }
}

/** Запасной вариант, если модель так и не вернула JSON: берём её текст как запись */
export function fallbackFromText(raw: string): NormalizedDiary | null {
  const text = raw
    .replace(/```[a-z]*/gi, '')
    .replace(/[{}"]/g, '')
    .replace(/\b(title|text|mood|thoughts|photo|label|intensity|summary|about|thought|emotion|caption|prompt)\s*:/gi, '')
    .trim()
  if (text.length < 20) return null
  return { title: '', text: text.slice(0, 1500), mood: { label: null, intensity: null, summary: '' }, thoughts: [], photo: { caption: '', prompt: '' } }
}

/* ───────────────────────── Сборка записи ───────────────────────── */

export interface BuildEntryInput {
  id: string
  period: Period
  norm: NormalizedDiary
  source: 'auto' | 'manual'
  model?: string
  now: number
}

const DEFAULT_TITLES: Partial<Record<EmotionLabel, string>> = {
  joy: 'Хороший день', affection: 'Тепло', playful: 'Шалости', smug: 'Я была великолепна',
  embarrassed: 'Ничего я не краснела', annoyed: 'Фыр', sad: 'Тихая грусть', worried: 'Волнуюсь',
  curious: 'Любопытные вещи', sleepy: 'Сонный день', excited: 'Вау!', neutral: 'Обычный день',
}

export function buildEntry({ id, period, norm, source, model, now }: BuildEntryInput): DiaryEntry {
  const tags: EmotionTag[] = period.messages
    .filter((m) => m.role === 'assistant' && m.emotion)
    .map((m) => m.emotion as EmotionTag)
  const dominant = dominantEmotion(tags)

  const label: EmotionLabel = norm.mood.label ?? dominant.label
  const mood: DiaryMood = {
    label,
    intensity: norm.mood.intensity ?? dominant.intensity,
    summary: norm.mood.summary || EMOTIONS[label].ru,
  }

  return {
    id,
    date: localDate(period.from),
    createdAt: now,
    updatedAt: now,
    title: norm.title || DEFAULT_TITLES[label] || 'Запись',
    text: norm.text,
    mood,
    thoughts: norm.thoughts,
    photos: [],
    emotionStats: emotionStats(tags),
    range: { from: period.from, to: period.to },
    messageCount: period.messages.length,
    source,
    model,
  }
}
