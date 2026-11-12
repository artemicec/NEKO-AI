// src/shared/services/emotionQuery.ts
//
// «Покажи записи, где мне было грустно» → эмоция «грусть» + остаток запроса. Общий разбор для поиска в окне дневника
// и для вопросов о прошлом в чате (memoryRecall). Чистый модуль, без Vue/Electron; слова — по началу (основе),
// чтобы ловились все формы («грустно», «грустила», «грусть»), но не «радио» (≠ «рад»).

import type { DiaryEntry, EmotionLabel } from '@shared/types'

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е')

/** Основы слов по эмоциям. Двусмысленные слова («тепло», «интересно», «хорошо») сюда не входят намеренно */
const STEMS: [EmotionLabel, RegExp][] = [
  ['sad', /^(груст|печал|тоск|плак|слез[ыа]|расстро|уныл|уныни|депресс)/],
  ['joy', /^(радост|радуе|радую|радуй|весел|счастл|ликов)|^рад[аыи]?$/],
  ['affection', /^(нежн|любов|влюбл|ласков|умилен)/],
  ['playful', /^(игрив|шаловл|озорн)/],
  ['smug', /^(самодовол|важнич)/],
  ['embarrassed', /^(смущ|стесн|неловк|застенч)/],
  ['annoyed', /^(раздраж|злил|злост|сердит|недовол|бесил|бесит)|^зл(ой|ая|ые|юсь)$|^зол(а|ы)?$/],
  ['worried', /^(тревож|тревог|волнов|волнуе|волнуюсь|беспоко|страх|страшн|боял|боюсь)/],
  ['curious', /^(любопыт|заинтриг)/],
  ['sleepy', /^(сонн|сонлив|устал|вял[аоы]?$|зевал)/],
  ['excited', /^(восторг|восхищ|предвкуш|ажиотаж)/],
  ['neutral', /^(спокой|безмятеж|умиротвор)/],
]

/** Служебные слова просьбы: после их удаления остаётся «тема» запроса (если она вообще есть) */
const FILLER = new Set(
  norm(
    `покажи покажите показать найди найдите найти поищи ищи записи запись записей запису дневник дневнике дневника дневнику
     где когда мне мне было был была были бывало бывает себя ты я мы нам нас меня тебе все всё дни день дня раз
     там что как какие какая какой про о об в во на по за из и а но или да нет ли бы же ну вот это этот эта эти
     настроение настроении настроения чувствовала чувствовал чувствую чувствовали почему`
  )
    .split(/\s+/)
    .filter(Boolean)
)

/**
 * Слова-усилители: «очень грустно», «сильно расстроилась». Сами по себе темой не являются — раньше «очень» принималось за тему,
 * и запись про грусть «не находилась», потому что слова «очень» в ней нет. Сильные ещё и просят выбирать самые яркие записи.
 */
const STRONG_STEMS = /^(очен|сильн|слишком|чересчур|крайн|жутк|ужасн|безумн|дико$|невероятн|настольк|особенн|максимальн|невыносим|нестерпим|безмерн|чертовск)/
const SOFT_STEMS = /^(немнож|немног|чуть|слегка|капельк|чуточк)/

export type Intensity = 'strong' | 'soft'
export function intensityOfWord(word: string): Intensity | null {
  const w = norm(word)
  if (STRONG_STEMS.test(w)) return 'strong'
  if (SOFT_STEMS.test(w)) return 'soft'
  return null
}

/** С какого балла (см. emotionScore) запись считается «яркой»: настроение дня = 3, мысль = 1 */
export const STRONG_SCORE = 3

/**
 * «Очень грустно» → оставить самые яркие записи. Если ярких нет — не оставлять человека ни с чем: возвращается всё как было.
 */
export function preferStrong<T>(items: readonly T[], score: (x: T) => number, intense: boolean): T[] {
  if (!intense) return [...items]
  const strong = items.filter((x) => score(x) >= STRONG_SCORE)
  return strong.length ? strong : [...items]
}

const tokens = (s: string): string[] => norm(s).split(/[^\p{L}\p{N}-]+/u).filter(Boolean)

export function emotionOfWord(word: string): EmotionLabel | null {
  const w = norm(word)
  for (const [label, re] of STEMS) if (re.test(w)) return label
  return null
}

export interface EmotionQuery {
  /** Какие эмоции названы в запросе (без повторов, в порядке появления) */
  emotions: EmotionLabel[]
  /** Запрос без слов-эмоций (в нижнем регистре) */
  rest: string
  /** То, что осталось после удаления и слов-эмоций, и служебных слов: настоящая «тема» (может быть пустой) */
  topic: string
  /** Есть сильный усилитель («очень», «сильно») — нужны самые яркие записи */
  intense: boolean
}

export function parseEmotionQuery(text: string): EmotionQuery {
  const emotions: EmotionLabel[] = []
  const restWords: string[] = []
  let intense = false
  for (const w of tokens(text)) {
    const e = emotionOfWord(w)
    if (e) { if (!emotions.includes(e)) emotions.push(e) } else restWords.push(w)
  }
  // усилитель считается только рядом с эмоцией: «очень вкусный борщ» — не про эмоции вовсе
  if (emotions.length) intense = restWords.some((w) => intensityOfWord(w) === 'strong')
  return {
    emotions,
    rest: restWords.join(' '),
    topic: restWords.filter((w) => !FILLER.has(w) && !intensityOfWord(w)).join(' '),
    intense,
  }
}

/** Просят ли вспомнить эмоциональное состояние в прошлом («когда мне было грустно», «в какие дни ты радовалась») */
const PAST_FEELING = /(?<![\p{L}\d])(?:было|был|была|были|бывало|бывали|чувствовал\p{L}*|грустил\p{L}*|радовал\p{L}*|волновал\p{L}*|злил\p{L}*|переживал\p{L}*|настроени\p{L}*)(?![\p{L}\d])/iu

export const asksAboutPastFeeling = (text: string): boolean => PAST_FEELING.test(norm(text))

/**
 * Насколько запись дневника про эти эмоции: общее настроение дня — главное (3), мысли с этой эмоцией — по 1,
 * упоминания в статистике — по 0,5. 0 — запись не про это.
 */
export function emotionScore(e: DiaryEntry, labels: readonly EmotionLabel[]): number {
  if (!labels.length) return 0
  let score = 0
  if (e.mood && labels.includes(e.mood.label)) score += 3
  for (const t of e.thoughts ?? []) if (labels.includes(t.emotion)) score += 1
  for (const st of e.emotionStats ?? []) if (st.count > 0 && labels.includes(st.label)) score += 0.5
  return score
}
