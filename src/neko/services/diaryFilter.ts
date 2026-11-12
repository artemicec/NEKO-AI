// src/neko/services/diaryFilter.ts
//
// Поиск и фильтр записей дневника: по тексту и по эмоциям. Чистый модуль.
// Эмоции запроса можно выбрать «чипами» или написать словами: «когда мне было грустно» → чип «грусть» + пустая тема.

import type { DiaryEntry, EmotionLabel } from '@shared/types'
import { emotionScore, parseEmotionQuery, preferStrong } from '@shared/services/emotionQuery'
import { topicWords } from '@shared/services/memoryRecall'

export { emotionScore }

export interface DiaryFilter {
  query: string
  /** Эмоции, выбранные «чипами»; несколько — «любая из» */
  emotions: EmotionLabel[]
}

const lc = (s: string) => s.toLowerCase().replace(/ё/g, 'е')

function textMatches(e: DiaryEntry, q: string): boolean {
  const n = lc(q.trim())
  if (!n) return true
  return (
    lc(e.title ?? '').includes(n) ||
    lc(e.text ?? '').includes(n) ||
    (e.date ?? '').includes(n) ||
    lc(e.mood?.summary ?? '').includes(n) ||
    (e.thoughts ?? []).some((t) => lc(t.about ?? '').includes(n) || lc(t.thought ?? '').includes(n))
  )
}

/** Тема рядом с эмоцией («…грустно из-за работы»): каждое слово темы — по основе, любая форма слова подходит */
function topicMatches(e: DiaryEntry, topic: string): boolean {
  const { stems } = topicWords(topic)
  if (!stems.length) return true // в теме одни служебные слова
  const hay = lc([e.title, e.text, e.mood?.summary, ...(e.thoughts ?? []).flatMap((t) => [t.about, t.thought])].filter(Boolean).join(' '))
  return stems.every((st) => hay.includes(st))
}

/** Какие эмоции реально действуют: чипы + слова из строки поиска */
export function activeEmotions(f: DiaryFilter): { chips: EmotionLabel[]; fromQuery: EmotionLabel[]; all: EmotionLabel[] } {
  const fromQuery = parseEmotionQuery(f.query).emotions
  const all = [...new Set([...f.emotions, ...fromQuery])]
  return { chips: f.emotions, fromQuery, all }
}

export function filterDiary(entries: DiaryEntry[], f: DiaryFilter): DiaryEntry[] {
  const q = f.query.trim()
  const parsed = q ? parseEmotionQuery(q) : null
  const fromQuery = parsed?.emotions ?? []

  const out: { e: DiaryEntry; score: number }[] = []
  for (const e of entries) {
    // чипы — строгий фильтр
    if (f.emotions.length && emotionScore(e, f.emotions) === 0) continue

    let score = f.emotions.length ? emotionScore(e, f.emotions) : 0
    if (q) {
      if (fromQuery.length) {
        // «грустно» в строке: подходит запись про грусть (и с темой, если она названа) — либо просто содержащая эти слова
        const byEmotion = emotionScore(e, fromQuery)
        const topicOk = !parsed!.topic || topicMatches(e, parsed!.topic)
        if (byEmotion > 0 && topicOk) score += byEmotion
        else if (!textMatches(e, q)) continue
      } else if (!textMatches(e, q)) continue
    }
    out.push({ e, score })
  }
  // при выборе по эмоции — сначала самые «про это»; иначе порядок как был (по дате)
  if (f.emotions.length || fromQuery.length) out.sort((a, b) => b.score - a.score) // sort устойчивый: при равенстве остаётся порядок по дате
  // «очень грустно» — сначала только яркие записи (если таких нет, показываем все подходящие)
  const shown = fromQuery.length ? preferStrong(out, (x) => x.score, !!parsed?.intense) : out
  return shown.map((x) => x.e)
}

/** Для «чипов»: по каждой эмоции — в скольких записях она главная или заметная (score > 0). Только ненулевые, по убыванию */
export function emotionCounts(entries: DiaryEntry[], labels: readonly EmotionLabel[]): { label: EmotionLabel; count: number }[] {
  return labels
    .map((label) => ({ label, count: entries.filter((e) => emotionScore(e, [label]) > 0).length }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count)
}
