// src/shared/services/emotion.ts
// Лёгкий (мгновенный, без обращения к модели) определитель эмоции NEKO по её ответу
// и по реплике пользователя. Нужен для: выражения лица аватара, цвета/смайла в дневнике,
// статистики эмоций за день. Саму «глубокую» оценку настроения в дневнике делает LLM.

import type { EmotionLabel, EmotionTag } from '@shared/types'

export interface EmotionMeta {
  emoji: string
  ru: string
  /** Акцентный цвет для карточек дневника */
  color: string
  /** Какие VRM-выражения включать (имена пресетов VRM 1.0) */
  vrm: Partial<Record<'happy' | 'angry' | 'sad' | 'relaxed' | 'surprised' | 'blink', number>>
}

export const EMOTIONS: Record<EmotionLabel, EmotionMeta> = {
  joy:         { emoji: '😊', ru: 'радость',       color: '#f4c95d', vrm: { happy: 0.9 } },
  affection:   { emoji: '💙', ru: 'нежность',      color: '#e8a4c8', vrm: { relaxed: 0.7, happy: 0.3 } },
  playful:     { emoji: '😼', ru: 'игривость',     color: '#9ad0ec', vrm: { happy: 0.55 } },
  smug:        { emoji: '😏', ru: 'самодовольство', color: '#b58be0', vrm: { relaxed: 0.8 } },
  embarrassed: { emoji: '😳', ru: 'смущение',      color: '#f08fa0', vrm: { happy: 0.25, surprised: 0.25 } },
  annoyed:     { emoji: '😠', ru: 'раздражение',   color: '#e0685f', vrm: { angry: 0.7 } },
  sad:         { emoji: '😢', ru: 'грусть',        color: '#6c8fd1', vrm: { sad: 0.8 } },
  worried:     { emoji: '😟', ru: 'тревога',       color: '#8fa6b8', vrm: { sad: 0.4, surprised: 0.2 } },
  curious:     { emoji: '🤔', ru: 'любопытство',   color: '#74c7b8', vrm: { surprised: 0.35 } },
  sleepy:      { emoji: '😴', ru: 'сонливость',    color: '#8d86b8', vrm: { relaxed: 0.5, blink: 0.55 } },
  excited:     { emoji: '🤩', ru: 'восторг',       color: '#ff9f5a', vrm: { happy: 1, surprised: 0.25 } },
  neutral:     { emoji: '🙂', ru: 'спокойствие',   color: '#9b7bb8', vrm: {} },
}

export const EMOTION_LABELS = Object.keys(EMOTIONS) as EmotionLabel[]

export function isEmotionLabel(x: unknown): x is EmotionLabel {
  return typeof x === 'string' && x in EMOTIONS
}

type Rule = { re: RegExp; w: number }

const R = (re: RegExp, w = 1): Rule => ({ re, w })

/**
 * Слова с границами, которые работают и с кириллицей
 * (\\b в JS видит только латиницу, поэтому используем lookbehind/lookahead по \\p{L}).
 * Внутри шаблона \\w заменяется на \\p{L}.
 */
const W = (src: string): RegExp =>
  new RegExp(`(?<![\\p{L}\\p{N}])(?:${src.replace(/\\w/g, '\\p{L}')})(?![\\p{L}\\p{N}])`, 'iu')

const RULES: Record<Exclude<EmotionLabel, 'neutral'>, Rule[]> = {
  joy: [
    R(W('ура|рада|рад|класс|здорово|круто|супер|отлично|замечательно|прекрасно|весело|счастлив\\w*')),
    R(/(ха){2,}|(ах){2,}|хихи|хех/i, 0.8),
    R(/[😊😄😁😀🙂😸😺☺️🥳]/u, 1.2),
  ],
  affection: [
    R(W('люблю|любимый|любимая|милый|милая|дорогой|дорогая|обнима\\w*|скучал\\w*|мурр?\\w*|тепло|нежн\\w*|обожаю')),
    R(/[💙💕💖💗💞❤️🥰😘🫶💜]/u, 1.3),
    R(/(?<![\p{L}])ня+/iu, 0.6),
  ],
  playful: [
    R(W('мяу+|мур|хи-?хи|хе-?хе|подразни\\w*|дразн\\w*|шалю|играем|поиграем')),
    R(/[😏😜😹😼😛😝🐾]/u, 1),
    R(/~/, 0.4),
  ],
  smug: [
    R(W('конечно я|естественно|разумеется|очевидно|ещё бы|еще бы|я же|гений|как и ожидалось|я лучше|признай'), 1.1),
    R(/[😎🤭]/u, 1),
    R(W('фу-?фу-?фу|ха!'), 0.8),
  ],
  embarrassed: [
    R(W('смущ\\w*|краснею|покраснел\\w*|не смотри|ч-?что|н-?не|б-?байка|стесня\\w*|неловко'), 1.2),
    R(/[😳🙈👉]/u, 1.3),
    R(/уш[иеа]\s+прижима\w*|прячу\s+лицо/i, 1.2),
  ],
  annoyed: [
    R(W('бесит|раздража\\w*|злюсь|злая|фыр+|хм+пф|тц+|дурак|глупый|отстань|надоел\\w*|достал\\w*'), 1.2),
    R(/хвост\s+(бьёт|бьет|хлещет|дёргается|дергается)/i, 1.2),
    R(/[😠😡😤🙄😒]/u, 1.2),
  ],
  sad: [
    R(W('груст\\w*|печаль\\w*|жаль|плачу|плакать|одинок\\w*|обидно|тоскую|тоска|расстро\\w*'), 1.2),
    R(/[😢😭🥺😞😔]/u, 1.3),
  ],
  worried: [
    R(W('беспоко\\w*|волнуюсь|переживаю|тревож\\w*|осторожно|всё ли хорошо|все ли хорошо|как ты себя чувствуешь|что случилось'), 1.2),
    R(/[😟😰😧😨]/u, 1.2),
  ],
  curious: [
    R(W('интересно|любопытно|расскажи|а почему|правда\\?|неужели|а как|что это|зачем')),
    R(/[🤔🧐]/u, 1.2),
    R(/\?/, 0.35),
  ],
  sleepy: [
    R(W('спать|спа[тл]ь|сонн\\w*|зеваю|зевает|засыпаю|устал\\w*|ночь|ложись|доброй ночи|спокойной ночи'), 1.1),
    R(/[😴🥱💤]/u, 1.4),
  ],
  excited: [
    R(W('ого+|вау+|ух ты|обалдеть|потрясающе|невероятно|ура+'), 1.3),
    R(/[🎉🤩✨🔥]/u, 1.1),
    R(/!{2,}/, 0.9),
  ],
}

function scoreText(text: string, weight: number, into: Record<string, number>) {
  if (!text) return
  for (const label of Object.keys(RULES) as (keyof typeof RULES)[]) {
    let s = 0
    for (const rule of RULES[label]) if (rule.re.test(text)) s += rule.w
    if (s) into[label] = (into[label] ?? 0) + s * weight
  }
}

/**
 * @param userText  последняя реплика пользователя (влияет слабее)
 * @param replyText ответ NEKO (основной сигнал)
 */
export function analyzeEmotion(userText: string, replyText: string): EmotionTag {
  const scores: Record<string, number> = {}
  scoreText(replyText, 1, scores)
  scoreText(userText, 0.35, scores)

  let best: EmotionLabel = 'neutral'
  let bestScore = 0
  for (const [label, s] of Object.entries(scores)) {
    if (s > bestScore) { best = label as EmotionLabel; bestScore = s }
  }
  if (bestScore < 0.7) return { label: 'neutral', intensity: 0.3 }

  const exclam = (replyText.match(/!/g) ?? []).length
  const caps = /[А-ЯЁA-Z]{4,}/.test(replyText) ? 0.1 : 0
  const intensity = Math.max(0.25, Math.min(1, 0.3 + bestScore * 0.18 + exclam * 0.04 + caps))
  return { label: best, intensity: Math.round(intensity * 100) / 100 }
}

/** Самая частая эмоция в списке (нейтральную учитываем, только если больше ничего нет) */
export function dominantEmotion(tags: EmotionTag[]): EmotionTag {
  const counts = new Map<EmotionLabel, { n: number; sum: number }>()
  for (const t of tags) {
    if (t.label === 'neutral') continue
    const c = counts.get(t.label) ?? { n: 0, sum: 0 }
    c.n++
    c.sum += t.intensity
    counts.set(t.label, c)
  }
  let best: EmotionLabel = 'neutral'
  let bestN = 0
  let bestAvg = 0.3
  for (const [label, c] of counts) {
    if (c.n > bestN) { best = label; bestN = c.n; bestAvg = c.sum / c.n }
  }
  return { label: best, intensity: Math.round(bestAvg * 100) / 100 }
}

export function emotionStats(tags: EmotionTag[]): { label: EmotionLabel; count: number }[] {
  const m = new Map<EmotionLabel, number>()
  for (const t of tags) m.set(t.label, (m.get(t.label) ?? 0) + 1)
  return [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count)
}
